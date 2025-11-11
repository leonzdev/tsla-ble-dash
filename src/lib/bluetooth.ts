import {
  TESLA_SERVICE_UUID,
  TESLA_TX_CHAR_UUID,
  TESLA_RX_CHAR_UUID,
  HEADER_SIZE,
  DEFAULT_MAX_MESSAGE_SIZE,
  DEFAULT_RX_TIMEOUT_MS,
  WEB_BLUETOOTH_DEFAULT_BLOCK,
} from './constants';

const MIN_BLOCK_LENGTH = 20; // 23 (ATT default MTU) - 3 byte length header
type WriteMode = 'with-response' | 'without-response';

export type TransportMessageEvent = CustomEvent<Uint8Array>;

export interface TeslaBleTransportOptions {
  vin?: string;
  preferredBlockLength?: number;
  deviceDiscoveryMode?: DeviceDiscoveryMode;
}

export const MESSAGE_EVENT = 'message';
export const DISCONNECT_EVENT = 'disconnect';

export enum DeviceDiscoveryMode {
  VinPrefixPromptFilter = 'vin-prefix-prompt-filter',
  VinPrefixValidation = 'vin-prefix-validation',
  Unfiltered = 'unfiltered',
}

export class TeslaBleTransport extends EventTarget {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private txChar: BluetoothRemoteGATTCharacteristic | null = null;
  private rxChar: BluetoothRemoteGATTCharacteristic | null = null;
  private buffer: Uint8Array = new Uint8Array(0);
  private lastNotification = 0;
  private blockLength = WEB_BLUETOOTH_DEFAULT_BLOCK;
  private writeChain: Promise<void> = Promise.resolve();
  private writeMode: WriteMode = 'with-response';

  constructor(private readonly options: TeslaBleTransportOptions = {}) {
    super();
  }

  get connected(): boolean {
    return Boolean(this.server?.connected);
  }

  get bluetoothDevice(): BluetoothDevice | null {
    return this.device;
  }

  async requestDevice(): Promise<BluetoothDevice> {
    const services: BluetoothServiceUUID[] = [TESLA_SERVICE_UUID];
    const mode = this.options.deviceDiscoveryMode ?? DeviceDiscoveryMode.VinPrefixValidation;
    const expectedPrefix = this.options.vin ? await this.vinToLocalName(this.options.vin) : null;

    let requestOptions: RequestDeviceOptions;
    if (mode === DeviceDiscoveryMode.VinPrefixPromptFilter && expectedPrefix) {
      requestOptions = {
        filters: [{ 
          namePrefix: expectedPrefix,         
          services,
        }],
      };
    } else {
      requestOptions = {
        // acceptAllDevices: true,
        filters: [{
          services
        }],
      };
    }

    const device = await navigator.bluetooth.requestDevice(requestOptions);
    if (
      mode === DeviceDiscoveryMode.VinPrefixValidation &&
      expectedPrefix &&
      device.name &&
      !device.name.startsWith(expectedPrefix)
    ) {
      const msg = `Selected device name "${device.name}" does not match expected VIN beacon prefix ${expectedPrefix}. Please select a different device.`;
      console.warn(msg);
      throw new Error(msg);
    }
    if (mode === DeviceDiscoveryMode.VinPrefixValidation && expectedPrefix && !device.name) {
      console.warn('Selected device is missing a name; unable to verify VIN prefix.');
    }
    return device;
  }

  async connect(existing?: BluetoothDevice): Promise<void> {
    this.device = existing ?? (await this.requestDevice());
    this.device.addEventListener('gattserverdisconnected', () => {
      this.dispatchEvent(new Event(DISCONNECT_EVENT));
    });

    this.server = await this.device.gatt?.connect() ?? null;
    if (!this.server) {
      throw new Error('Failed to open GATT server');
    }

    const service = await this.server.getPrimaryService(TESLA_SERVICE_UUID);
    this.txChar = await service.getCharacteristic(TESLA_TX_CHAR_UUID);
    this.rxChar = await service.getCharacteristic(TESLA_RX_CHAR_UUID);
    this.writeMode = this.determineWriteMode();

    // Compute conservative block length based on characteristic properties.
    this.blockLength = Math.max(MIN_BLOCK_LENGTH, this.options.preferredBlockLength ?? WEB_BLUETOOTH_DEFAULT_BLOCK);

    await this.rxChar.startNotifications();
    this.rxChar.addEventListener('characteristicvaluechanged', (event: Event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;
      const chunk = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      this.onNotification(chunk);
    });
  }

  async disconnect(): Promise<void> {
    try {
      await this.rxChar?.stopNotifications();
    } catch (err) {
      console.warn('Failed stopping notifications', err);
    }
    this.rxChar = null;
    this.txChar = null;
    if (this.server?.connected) {
      this.server.disconnect();
    }
    this.server = null;
    this.device = null;
    this.buffer = new Uint8Array(0);
    this.writeMode = 'with-response';
  }

  async send(payload: Uint8Array): Promise<void> {
    if (!this.txChar) {
      throw new Error('TX characteristic not ready');
    }
    if (payload.length > DEFAULT_MAX_MESSAGE_SIZE) {
      throw new Error(`Payload too large (${payload.length})`);
    }
    const packet = new Uint8Array(HEADER_SIZE + payload.length);
    packet[0] = (payload.length >> 8) & 0xff;
    packet[1] = payload.length & 0xff;
    packet.set(payload, HEADER_SIZE);

    const task = this.writeChain.then(() => this.writePacket(packet));
    this.writeChain = task.catch(() => { /* swallow to keep chain alive */ });
    await task;
  }

  addMessageListener(listener: (event: TransportMessageEvent) => void): void {
    this.addEventListener(MESSAGE_EVENT, listener as EventListener);
  }

  removeMessageListener(listener: (event: TransportMessageEvent) => void): void {
    this.removeEventListener(MESSAGE_EVENT, listener as EventListener);
  }

  addDisconnectListener(listener: EventListener): void {
    this.addEventListener(DISCONNECT_EVENT, listener);
  }

  removeDisconnectListener(listener: EventListener): void {
    this.removeEventListener(DISCONNECT_EVENT, listener);
  }

  private onNotification(chunk: Uint8Array) {
    if (!chunk.length) return;
    const now = performance.now();
    if (now - this.lastNotification > DEFAULT_RX_TIMEOUT_MS) {
      this.buffer = new Uint8Array(0);
    }
    this.lastNotification = now;
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;
    this.flush();
  }

  private flush(): void {
    while (this.buffer.length >= HEADER_SIZE) {
      const length = (this.buffer[0] << 8) | this.buffer[1];
      if (length > DEFAULT_MAX_MESSAGE_SIZE) {
        console.error('Received message exceeding maximum size, resetting buffer');
        this.buffer = new Uint8Array(0);
        return;
      }
      if (this.buffer.length < HEADER_SIZE + length) {
        return; // wait for more data
      }
      const message = this.buffer.slice(HEADER_SIZE, HEADER_SIZE + length);
      this.buffer = this.buffer.slice(HEADER_SIZE + length);
      const event = new CustomEvent<Uint8Array>(MESSAGE_EVENT, { detail: message });
      this.dispatchEvent(event);
    }
  }

  private async writePacket(packet: Uint8Array): Promise<void> {
    while (true) {
      try {
        await this.writePacketOnce(packet);
        return;
      } catch (error) {
        if (!this.handleWriteError(error)) {
          throw error;
        }
      }
    }
  }

  private async writePacketOnce(packet: Uint8Array): Promise<void> {
    if (!this.txChar) {
      throw new Error('TX characteristic not ready');
    }
    for (let offset = 0; offset < packet.length; offset += this.blockLength) {
      const block = packet.subarray(offset, Math.min(offset + this.blockLength, packet.length));
      await this.writeChunk(block);
    }
  }

  private handleWriteError(error: unknown): boolean {
    if (!(error instanceof DOMException)) {
      return false;
    }
    if (error.name === 'DataError') {
      if (this.blockLength <= MIN_BLOCK_LENGTH) {
        return false;
      }
      console.warn(
        `BLE write failed with DataError using block length ${this.blockLength}; falling back to ${MIN_BLOCK_LENGTH}`,
      );
      this.blockLength = MIN_BLOCK_LENGTH;
      return true;
    }
    if (error.name === 'NotSupportedError') {
      return this.tryFallbackWriteMode();
    }
    return false;
  }

  private determineWriteMode(): WriteMode {
    const props = this.txChar?.properties;
    if (props?.write || this.supportsWriteWithResponse()) {
      return 'with-response';
    }
    if (props?.writeWithoutResponse || this.supportsWriteWithoutResponse()) {
      return 'without-response';
    }
    return 'with-response';
  }

  private async writeChunk(block: Uint8Array): Promise<void> {
    const chunk = block as unknown as BufferSource;
    if (!this.txChar) {
      throw new Error('TX characteristic not ready');
    }
    if (this.writeMode === 'with-response' && typeof this.txChar.writeValueWithResponse === 'function') {
      await this.txChar.writeValueWithResponse(chunk);
      return;
    }
    if (this.writeMode === 'without-response' && typeof this.txChar.writeValueWithoutResponse === 'function') {
      await this.txChar.writeValueWithoutResponse(chunk);
      return;
    }
    // Fallback if the chosen mode is unavailable at runtime.
    if (this.tryFallbackWriteMode()) {
      await this.writeChunk(block);
      return;
    }
    if (typeof (this.txChar as any).writeValue === 'function') {
      await (this.txChar as any).writeValue(chunk);
      return;
    }
    throw new Error('TX characteristic does not support writes');
  }

  private tryFallbackWriteMode(): boolean {
    if (!this.txChar) {
      return false;
    }
    if (this.writeMode === 'with-response' && this.supportsWriteWithoutResponse()) {
      console.warn('GATT writeValueWithResponse unsupported; switching to writeValueWithoutResponse.');
      this.writeMode = 'without-response';
      return true;
    }
    if (this.writeMode === 'without-response' && this.supportsWriteWithResponse()) {
      console.warn('GATT writeValueWithoutResponse unsupported; switching to writeValueWithResponse.');
      this.writeMode = 'with-response';
      return true;
    }
    return false;
  }

  private supportsWriteWithoutResponse(): boolean {
    if (!this.txChar) return false;
    const props = this.txChar.properties;
    if (props && 'writeWithoutResponse' in props) {
      if (!props.writeWithoutResponse) {
        return false;
      }
    }
    return typeof this.txChar.writeValueWithoutResponse === 'function';
  }

  private supportsWriteWithResponse(): boolean {
    if (!this.txChar) return false;
    const props = this.txChar.properties;
    if (props && 'write' in props) {
      if (!props.write) {
        return false;
      }
    }
    return typeof this.txChar.writeValueWithResponse === 'function';
  }

  private async vinToLocalName(vin: string): Promise<string> {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-1', encoder.encode(vin));
    const hash = new Uint8Array(hashBuffer.slice(0, 8));
    const hex = Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `S${hex}C`;
  }
}
