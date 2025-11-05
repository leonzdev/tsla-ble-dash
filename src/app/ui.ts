import { TeslaBleSession, VehicleStateResult } from '../lib/session';
import { StateCategory } from '../lib/protocol';
import {
  generatePrivateKey,
  importPrivateKeyPkcs8,
  exportPrivateKeyPkcs8,
  exportPublicKeyFromPrivate,
} from '../lib/crypto';

export function initializeApp(root: HTMLElement): void {
  root.classList.add('tsla-app');

  const vinInput = createInput('VIN', 'text');
  vinInput.input.placeholder = '5YJ3E1EA7JF000000';

  const privateKeyInput = createTextarea('Private key (PEM)');
  privateKeyInput.textarea.placeholder = 'Paste PKCS#8 private key generated via tesla-keygen…';
  privateKeyInput.textarea.rows = 6;

  const publicKeyOutput = createTextarea('Public key (hex, share with vehicle)');
  publicKeyOutput.textarea.readOnly = true;
  publicKeyOutput.textarea.rows = 3;

  const stateSelect = document.createElement('select');
  stateSelect.className = 'tsla-select';
  Object.values(StateCategory).forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = prettyLabel(value);
    stateSelect.append(option);
  });

  const buttonsRow = document.createElement('div');
  buttonsRow.className = 'tsla-row';

  const generateKeyBtn = createButton('Generate Key');
  const selectDeviceBtn = createButton('Select Vehicle');
  const connectBtn = createButton('Connect');
  const fetchStateBtn = createButton('Fetch State');

  buttonsRow.append(generateKeyBtn.button, selectDeviceBtn.button, connectBtn.button, fetchStateBtn.button);

  const stateRow = document.createElement('div');
  stateRow.className = 'tsla-row';
  const stateLabel = document.createElement('label');
  stateLabel.textContent = 'State Category';
  stateLabel.append(stateSelect);
  stateRow.append(stateLabel);

  const logOutput = document.createElement('pre');
  logOutput.className = 'tsla-log';

  root.append(
    vinInput.wrapper,
    privateKeyInput.wrapper,
    publicKeyOutput.wrapper,
    buttonsRow,
    stateRow,
    logOutput,
  );

  let session: TeslaBleSession | null = null;
  let privateKey: CryptoKey | null = null;

  generateKeyBtn.button.addEventListener('click', async () => {
    try {
      appendLog(logOutput, 'Generating new private key…');
      const keyPair = await generatePrivateKey();
      privateKey = keyPair.privateKey;
      const pem = await exportPrivateKeyPkcs8(privateKey);
      privateKeyInput.textarea.value = pem;
      const publicKey = await exportPublicKeyFromPrivate(privateKey);
      publicKeyOutput.textarea.value = bytesToHex(publicKey);
      appendLog(logOutput, 'Generated key pair. Remember to enroll the public key using NFC.');
    } catch (error) {
      reportError(logOutput, error, 'Failed to generate key');
    }
  });

  selectDeviceBtn.button.addEventListener('click', async () => {
    try {
      const vin = vinInput.input.value.trim();
      if (!vin) {
        throw new Error('VIN is required');
      }
      session = new TeslaBleSession({ vin });
      await session.connect();
      appendLog(logOutput, 'Bluetooth device selected and GATT connected.');
    } catch (error) {
      reportError(logOutput, error, 'Failed to select device');
    }
  });

  connectBtn.button.addEventListener('click', async () => {
    try {
      if (!session) {
        throw new Error('Select a vehicle first');
      }
      privateKey = await ensurePrivateKey(privateKeyInput.textarea.value.trim(), privateKey);
      await session.ensureSession(privateKey);
      appendLog(logOutput, 'Session established successfully.');
    } catch (error) {
      reportError(logOutput, error, 'Handshake failed');
    }
  });

  fetchStateBtn.button.addEventListener('click', async () => {
    try {
      if (!session) {
        throw new Error('No session available');
      }
      privateKey = await ensurePrivateKey(privateKeyInput.textarea.value.trim(), privateKey);
      const category = stateSelect.value as StateCategory;
      appendLog(logOutput, `Requesting vehicle state: ${category}…`);
      const result = await session.getState(category, privateKey);
      renderState(logOutput, result);
    } catch (error) {
      reportError(logOutput, error, 'Failed to fetch state');
    }
  });
}

function createInput(labelText: string, type: string) {
  const wrapper = document.createElement('label');
  wrapper.className = 'tsla-field';
  wrapper.textContent = labelText;
  const input = document.createElement('input');
  input.type = type;
  input.className = 'tsla-input';
  wrapper.append(input);
  return { wrapper, input };
}

function createTextarea(labelText: string) {
  const wrapper = document.createElement('label');
  wrapper.className = 'tsla-field';
  wrapper.textContent = labelText;
  const textarea = document.createElement('textarea');
  textarea.className = 'tsla-textarea';
  wrapper.append(textarea);
  return { wrapper, textarea };
}

function createButton(text: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tsla-button';
  button.textContent = text;
  return { button };
}

function prettyLabel(value: string): string {
  return value.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

async function ensurePrivateKey(text: string, cached: CryptoKey | null): Promise<CryptoKey> {
  if (cached) {
    return cached;
  }
  if (!text) {
    throw new Error('Provide a private key first');
  }
  return importPrivateKeyPkcs8(text);
}

function appendLog(target: HTMLElement, message: string): void {
  target.textContent = `${target.textContent || ''}${message}\n`;
  target.scrollTop = target.scrollHeight;
}

function reportError(target: HTMLElement, error: unknown, prefix: string): void {
  const detail = error instanceof Error ? error.message : String(error);
  appendLog(target, `${prefix}: ${detail}`);
  console.error(prefix, error);
}

function renderState(log: HTMLElement, result: VehicleStateResult): void {
  appendLog(log, `State result:\n${JSON.stringify(result.vehicleData, null, 2)}`);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
