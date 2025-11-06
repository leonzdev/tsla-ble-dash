import { TeslaBleSession, VehicleStateResult } from '../lib/session';
import { StateCategory } from '../lib/protocol';
import {
  generatePrivateKey,
  importPrivateKeyPkcs8,
  exportPrivateKeyPkcs8,
  exportPublicKeyFromPrivate,
} from '../lib/crypto';

const PROFILE_STORAGE_KEY = 'tsla.profiles';

interface StoredProfile {
  id: string;
  name: string;
  privateKeyPem: string;
  publicKeyHex: string;
}

export function initializeApp(root: HTMLElement): void {
  root.classList.add('tsla-app');

  const profileSelect = createSelect('Profile');
  const profileNameInput = createInput('Profile Name', 'text');
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

  const profileButtonsRow = document.createElement('div');
  profileButtonsRow.className = 'tsla-row';
  const saveProfileBtn = createButton('Save Profile');
  const newProfileBtn = createButton('New Profile');
  const deleteProfileBtn = createButton('Delete Profile');
  profileButtonsRow.append(
    saveProfileBtn.button,
    newProfileBtn.button,
    deleteProfileBtn.button,
  );

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
    profileSelect.wrapper,
    profileNameInput.wrapper,
    vinInput.wrapper,
    privateKeyInput.wrapper,
    publicKeyOutput.wrapper,
    profileButtonsRow,
    buttonsRow,
    stateRow,
    logOutput,
  );

  let session: TeslaBleSession | null = null;
  let privateKey: CryptoKey | null = null;
  let profiles = loadStoredProfiles();

  refreshProfileOptions(profileSelect.select, profiles, null);
  updateProfileButtons();

  generateKeyBtn.button.addEventListener('click', async () => {
    try {
      appendLog(logOutput, 'Generating new private key…');
      const keyPair = await generatePrivateKey();
      privateKey = keyPair.privateKey;
      const pem = await exportPrivateKeyPkcs8(privateKey);
      privateKeyInput.textarea.value = pem;
      const publicKey = await exportPublicKeyFromPrivate(privateKey);
      publicKeyOutput.textarea.value = bytesToHex(publicKey);
      profileSelect.select.value = '';
      profileNameInput.input.value = '';
      updateProfileButtons();
      appendLog(logOutput, 'Generated key pair. Remember to enroll the public key using NFC.');
    } catch (error) {
      reportError(logOutput, error, 'Failed to generate key');
    }
  });

  profileSelect.select.addEventListener('change', async () => {
    const selectedId = profileSelect.select.value;
    if (!selectedId) {
      profileNameInput.input.value = '';
      privateKeyInput.textarea.value = '';
      publicKeyOutput.textarea.value = '';
      privateKey = null;
      updateProfileButtons();
      return;
    }
    const profile = profiles.find((item) => item.id === selectedId);
    if (!profile) {
      profileSelect.select.value = '';
      updateProfileButtons();
      return;
    }
    profileNameInput.input.value = profile.name;
    privateKeyInput.textarea.value = profile.privateKeyPem;
    publicKeyOutput.textarea.value = profile.publicKeyHex;
    try {
      const importedKey = await importPrivateKeyPkcs8(profile.privateKeyPem);
      privateKey = importedKey;
      const derivedPublicKey = await exportPublicKeyFromPrivate(importedKey);
      const derivedPublicKeyHex = bytesToHex(derivedPublicKey);
      if (derivedPublicKeyHex !== profile.publicKeyHex) {
        profile.publicKeyHex = derivedPublicKeyHex;
        publicKeyOutput.textarea.value = derivedPublicKeyHex;
        persistProfiles(profiles);
        appendLog(logOutput, `Profile "${profile.name}" public key refreshed.`);
      } else {
        appendLog(logOutput, `Loaded profile "${profile.name}".`);
      }
    } catch (error) {
      privateKey = null;
      reportError(logOutput, error, `Failed to load profile "${profile.name}"`);
    }
    updateProfileButtons();
  });

  newProfileBtn.button.addEventListener('click', () => {
    profileSelect.select.value = '';
    profileNameInput.input.value = '';
    privateKeyInput.textarea.value = '';
    publicKeyOutput.textarea.value = '';
    privateKey = null;
    updateProfileButtons();
  });

  deleteProfileBtn.button.addEventListener('click', () => {
    const selectedId = profileSelect.select.value;
    if (!selectedId) {
      return;
    }
    const profile = profiles.find((item) => item.id === selectedId);
    profiles = profiles.filter((item) => item.id !== selectedId);
    persistProfiles(profiles);
    profileSelect.select.value = '';
    profileNameInput.input.value = '';
    privateKeyInput.textarea.value = '';
    publicKeyOutput.textarea.value = '';
    privateKey = null;
    updateProfileButtons();
    refreshProfileOptions(profileSelect.select, profiles, null);
    if (profile) {
      appendLog(logOutput, `Deleted profile "${profile.name}".`);
    }
  });

  saveProfileBtn.button.addEventListener('click', async () => {
    try {
      const name = profileNameInput.input.value.trim();
      if (!name) {
        throw new Error('Profile name is required');
      }
      const pem = privateKeyInput.textarea.value.trim();
      if (!pem) {
        throw new Error('Provide a private key before saving');
      }
      const importedKey = await importPrivateKeyPkcs8(pem);
      privateKey = importedKey;
      const publicKey = await exportPublicKeyFromPrivate(importedKey);
      const publicKeyHex = bytesToHex(publicKey);
      publicKeyOutput.textarea.value = publicKeyHex;

      const selectedId = profileSelect.select.value;
      let savedProfileId = selectedId;
      const existingProfile = profiles.find((item) => item.id === selectedId);
      if (existingProfile) {
        existingProfile.name = name;
        existingProfile.privateKeyPem = pem;
        existingProfile.publicKeyHex = publicKeyHex;
        appendLog(logOutput, `Updated profile "${name}".`);
      } else {
        const newProfile: StoredProfile = {
          id: createProfileId(),
          name,
          privateKeyPem: pem,
          publicKeyHex,
        };
        profiles = [...profiles, newProfile];
        savedProfileId = newProfile.id;
        appendLog(logOutput, `Saved new profile "${name}".`);
      }
      persistProfiles(profiles);
      refreshProfileOptions(profileSelect.select, profiles, savedProfileId ?? null);
      if (savedProfileId) {
        profileSelect.select.value = savedProfileId;
      }
      updateProfileButtons();
    } catch (error) {
      reportError(logOutput, error, 'Failed to save profile');
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

  privateKeyInput.textarea.addEventListener('input', () => {
    privateKey = null;
  });

  function updateProfileButtons() {
    const hasSelection = Boolean(
      profileSelect.select.value && profiles.some((item) => item.id === profileSelect.select.value),
    );
    deleteProfileBtn.button.disabled = !hasSelection;
  }
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

function createSelect(labelText: string) {
  const wrapper = document.createElement('label');
  wrapper.className = 'tsla-field';
  wrapper.textContent = labelText;
  const select = document.createElement('select');
  select.className = 'tsla-select';
  wrapper.append(select);
  return { wrapper, select };
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

function loadStoredProfiles(): StoredProfile[] {
  const storage = getLocalStorage();
  if (!storage) {
    return [];
  }
  try {
    const raw = storage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => {
        if (
          typeof item === 'object' &&
          item !== null &&
          typeof item.id === 'string' &&
          typeof item.name === 'string' &&
          typeof item.privateKeyPem === 'string' &&
          typeof item.publicKeyHex === 'string'
        ) {
          return {
            id: item.id,
            name: item.name,
            privateKeyPem: item.privateKeyPem,
            publicKeyHex: item.publicKeyHex,
          } satisfies StoredProfile;
        }
        return null;
      })
      .filter((item): item is StoredProfile => item !== null);
  } catch (error) {
    console.warn('Failed to parse stored profiles', error);
    return [];
  }
}

function persistProfiles(profiles: StoredProfile[]): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));
  } catch (error) {
    console.warn('Failed to persist profiles', error);
  }
}

function createProfileId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function refreshProfileOptions(
  select: HTMLSelectElement,
  profiles: StoredProfile[],
  selectedId: string | null,
): void {
  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'New profile…';
  select.append(placeholder);
  profiles.forEach((profile) => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    select.append(option);
  });
  if (selectedId && profiles.some((profile) => profile.id === selectedId)) {
    select.value = selectedId;
  } else {
    select.value = '';
  }
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    return window.localStorage;
  } catch (error) {
    console.warn('Local storage unavailable', error);
    return null;
  }
}
