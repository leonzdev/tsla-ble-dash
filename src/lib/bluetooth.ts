import {
  TESLA_SERVICE_UUID,
  TESLA_TX_CHAR_UUID,
  TESLA_RX_CHAR_UUID,
  HEADER_SIZE,
  DEFAULT_MAX_MESSAGE_SIZE,
  DEFAULT_RX_TIMEOUT_MS,
  WEB_BLUETOOTH_DEFAULT_BLOCK,
} from './constants';

export type TransportMessageEvent = CustomEvent<Uint8Array>;

export interface TeslaBleTransportOptions {
  vin?: string;
  preferredBlockLength?: number;
}

export const MESSAGE_EVENT = 'message';
export const DISCONNECT_EVENT = 'disconnect';

export class TeslaBleTransport extends EventTarget {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private txChar: BluetoothRemoteGATTCharacteristic | null = null;
  private rxChar: BluetoothRemoteGATTCharacteristic | null = null;
  private buffer: Uint8Array = new Uint8Array(0);
  private lastNotification = 0;
  private blockLength = WEB_BLUETOOTH_DEFAULT_BLOCK;

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
    const options: RequestDeviceOptions = {
      acceptAllDevices: true,
      optionalServices: [TESLA_SERVICE_UUID],
    } as RequestDeviceOptions;

    const device = await navigator.bluetooth.requestDevice(options);
    if (this.options.vin) {
      const expectedPrefix = await this.vinToLocalName(this.options.vin);
      if (device.name && expectedPrefix && !device.name.startsWith(expectedPrefix)) {
        const msg = `Selected device name "${device.name}" does not match expected VIN beacon prefix ${expectedPrefix}. Please select a different device.`;
        console.warn(msg);
        throw new Error(msg);
      }
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

    // Compute conservative block length based on characteristic properties.
    this.blockLength = Math.max(20, this.options.preferredBlockLength ?? WEB_BLUETOOTH_DEFAULT_BLOCK);

    await this.rxChar.startNotifications();
    this.rxChar.addEventListener('characteristicvaluechanged', (event) => {
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

    for (let offset = 0; offset < packet.length; offset += this.blockLength) {
      const block = packet.subarray(offset, Math.min(offset + this.blockLength, packet.length));
      if (typeof this.txChar.writeValueWithResponse === 'function') {
        await this.txChar.writeValueWithResponse(block);
      } else if (typeof this.txChar.writeValueWithoutResponse === 'function') {
        await this.txChar.writeValueWithoutResponse(block);
      } else {
        await (this.txChar as any).writeValue(block);
      }
    }
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

  private async vinToLocalName(vin: string): Promise<string> {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-1', encoder.encode(vin));
    const hash = new Uint8Array(hashBuffer.slice(0, 8));
    const hex = Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `S${hex}C`;
  }
}
