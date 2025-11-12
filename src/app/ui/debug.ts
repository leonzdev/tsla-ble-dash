import {
  TeslaBleSession,
  VehicleStateResult,
  DeviceDiscoveryMode,
  SelectedDeviceInfo,
} from '../../lib/session';
import { StateCategory, KeyRole, KeyFormFactor } from '../../lib/protocol';
import {
  generatePrivateKey,
  importPrivateKeyPem,
  exportPrivateKeyPem,
  exportPublicKeyFromPrivate,
  exportPublicKeyPem,
  exportPublicKeyPemFromPrivate,
  publicKeyPemToRaw,
} from '../../lib/crypto';

const PROFILE_STORAGE_KEY = 'tsla.profiles';
const VIN_STORAGE_KEY = 'tsla.vin';
const REFRESH_INTERVAL_STORAGE_KEY = 'tsla.stateRefreshIntervalMs';
const DEFAULT_REFRESH_INTERVAL_MS = 1000;
const MIN_REFRESH_INTERVAL_MS = 0;
const MAX_REFRESH_INTERVAL_MS = 60_000;

interface StoredProfile {
  id: string;
  name: string;
  privateKeyPem: string;
  publicKeyPem: string;
}

export interface DebugPageOptions {
  onVinChange?(vin: string | null): void;
  onKeyStatusChange?(hasKey: boolean): void;
  onVehicleState?(category: StateCategory, result: VehicleStateResult | null, latencyMs: number | null): void;
  onAutoRefreshStateChange?(active: boolean): void;
}

export interface DebugPageController {
  key: 'debug';
  label: string;
  element: HTMLElement;
  initialize(): Promise<void>;
  handleAutoRefreshToggleRequest(): void;
}

export function createDebugPage(options: DebugPageOptions = {}): DebugPageController {
  const {
    onVinChange = () => {},
    onKeyStatusChange = () => {},
    onVehicleState = () => {},
    onAutoRefreshStateChange = () => {},
  } = options;

  const page = document.createElement('section');
  page.className = 'tsla-page tsla-debug';
  const debugContent = document.createElement('div');
  debugContent.className = 'tsla-debug__content';
  page.append(debugContent);

  const profileSelect = createSelect('Profile');
  const profileNameInput = createInput('Profile Name', 'text');
  const vinInput = createInput('VIN', 'text');
  vinInput.input.placeholder = '5YJ3E1EA7JF000000';
  const discoveryModeSelect = createSelect('Device Discovery Mode');
  discoveryModeSelect.select.append(
    option('VIN prefix filter in prompt', DeviceDiscoveryMode.VinPrefixPromptFilter),
    option('VIN prefix validation after selection', DeviceDiscoveryMode.VinPrefixValidation),
    option('No VIN prefix checks (default)', DeviceDiscoveryMode.Unfiltered),
  );
  discoveryModeSelect.select.value = DeviceDiscoveryMode.Unfiltered;

  const privateKeyInput = createTextarea('Private key (PEM)');
  privateKeyInput.textarea.placeholder = 'Paste EC PRIVATE KEY generated via tesla-keygen…';
  privateKeyInput.textarea.rows = 6;

  const publicKeyOutput = createTextarea('Public key (PEM, share with vehicle)');
  publicKeyOutput.textarea.readOnly = true;
  publicKeyOutput.textarea.rows = 6;

  const stateSelect = document.createElement('select');
  stateSelect.className = 'tsla-select';
  Object.values(StateCategory).forEach((value) => {
    const stateOption = document.createElement('option');
    stateOption.value = value;
    stateOption.textContent = prettyLabel(value);
    stateSelect.append(stateOption);
  });
  stateSelect.value = StateCategory.Drive;

  const refreshIntervalInput = createInput('Refresh Interval (ms)', 'number');
  refreshIntervalInput.input.min = String(MIN_REFRESH_INTERVAL_MS);
  refreshIntervalInput.input.step = '100';

  const autoRefreshField = document.createElement('label');
  autoRefreshField.className = 'tsla-field';
  autoRefreshField.textContent = 'Auto Refresh';
  const autoRefreshToggle = document.createElement('input');
  autoRefreshToggle.type = 'checkbox';
  autoRefreshField.append(autoRefreshToggle);

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

  const enrollRow = document.createElement('div');
  enrollRow.className = 'tsla-row';
  const roleLabel = document.createElement('label');
  roleLabel.textContent = 'Key Role';
  const roleSelect = document.createElement('select');
  roleSelect.className = 'tsla-select';
  roleSelect.append(option('Driver', String(KeyRole.ROLE_DRIVER)));
  roleSelect.append(option('Owner', String(KeyRole.ROLE_OWNER)));
  roleSelect.append(option('Vehicle Monitor', String(KeyRole.ROLE_VEHICLE_MONITOR)));
  roleLabel.append(roleSelect);

  const formLabel = document.createElement('label');
  formLabel.textContent = 'Form Factor';
  const formSelect = document.createElement('select');
  formSelect.className = 'tsla-select';
  formSelect.append(option('iOS Device', String(KeyFormFactor.KEY_FORM_FACTOR_IOS_DEVICE)));
  formSelect.append(option('Android Device', String(KeyFormFactor.KEY_FORM_FACTOR_ANDROID_DEVICE)));
  formSelect.append(option('NFC Card', String(KeyFormFactor.KEY_FORM_FACTOR_NFC_CARD)));
  formSelect.append(option('Cloud Key', String(KeyFormFactor.KEY_FORM_FACTOR_CLOUD_KEY)));
  formLabel.append(formSelect);

  const enrollBtn = createButton('Enroll Key');
  const verifyEnrollBtn = createButton('Verify Enrollment');
  enrollRow.append(roleLabel, formLabel, enrollBtn.button, verifyEnrollBtn.button);

  const stateRow = document.createElement('div');
  stateRow.className = 'tsla-row';
  const stateLabel = document.createElement('label');
  stateLabel.textContent = 'State Category';
  stateLabel.append(stateSelect);
  stateRow.append(stateLabel);

  const autoRefreshRow = document.createElement('div');
  autoRefreshRow.className = 'tsla-row';
  autoRefreshRow.append(refreshIntervalInput.wrapper, autoRefreshField);

  const stateResultOutput = document.createElement('pre');
  stateResultOutput.className = 'tsla-log tsla-log--state';
  stateResultOutput.textContent = 'Vehicle state output will appear here.';

  const logOutput = document.createElement('pre');
  logOutput.className = 'tsla-log';

  debugContent.append(
    profileSelect.wrapper,
    profileNameInput.wrapper,
    vinInput.wrapper,
    discoveryModeSelect.wrapper,
    privateKeyInput.wrapper,
    publicKeyOutput.wrapper,
    profileButtonsRow,
    buttonsRow,
    enrollRow,
    stateRow,
    autoRefreshRow,
    stateResultOutput,
    logOutput,
  );

  let session: TeslaBleSession | null = null;
  let privateKey: CryptoKey | null = null;
  let autoRefreshTimer: number | null = null;
  let autoRefreshActive = false;
  let profiles: StoredProfile[] = [];
  let currentVin = '';
  let selectedProfileId: string | null = null;

  const initialize = async () => {
    profiles = await loadStoredProfiles();
    currentVin = loadStoredVin();
    if (currentVin) {
      vinInput.input.value = currentVin;
    }
    const storedRefreshInterval = loadStoredRefreshInterval();
    refreshIntervalInput.input.value = String(storedRefreshInterval);
    refreshProfileOptions(profileSelect.select, profiles, selectedProfileId);
    updateProfileButtons();
    updateAutoRefreshUi();
    onVinChange(currentVin || null);
    onKeyStatusChange(Boolean(privateKey));
  };

  const handleRefreshIntervalChange = () => {
    const sanitized = sanitizeRefreshInterval(refreshIntervalInput.input.value);
    refreshIntervalInput.input.value = String(sanitized);
    persistRefreshInterval(sanitized);
    restartAutoRefreshTimer();
  };

  refreshIntervalInput.input.addEventListener('change', handleRefreshIntervalChange);
  refreshIntervalInput.input.addEventListener('blur', handleRefreshIntervalChange);

  vinInput.input.addEventListener('change', () => {
    const normalized = normalizeVin(vinInput.input.value);
    vinInput.input.value = normalized;
    currentVin = normalized;
    persistVin(normalized);
    onVinChange(normalized || null);
  });

  autoRefreshToggle.addEventListener('change', () => {
    if (autoRefreshToggle.checked) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });

  generateKeyBtn.button.addEventListener('click', async () => {
    try {
      appendLog(logOutput, 'Generating new private key…');
      const keyPair = await generatePrivateKey();
      assignPrivateKey(keyPair.privateKey);
      const pem = await exportPrivateKeyPem(keyPair.privateKey);
      privateKeyInput.textarea.value = pem;
      const publicKeyPem = await exportPublicKeyPem(keyPair.publicKey);
      publicKeyOutput.textarea.value = publicKeyPem;
      profileSelect.select.value = '';
      selectedProfileId = null;
      profileNameInput.input.value = '';
      updateProfileButtons();
      appendLog(logOutput, 'Generated key pair. Remember to enroll the public key using NFC.');
    } catch (error) {
      reportError(logOutput, error, 'Failed to generate key');
    }
  });

  profileSelect.select.addEventListener('change', async () => {
    const selectedId = profileSelect.select.value;
    selectedProfileId = selectedId || null;
    if (!selectedId) {
      profileNameInput.input.value = '';
      privateKeyInput.textarea.value = '';
      publicKeyOutput.textarea.value = '';
      assignPrivateKey(null);
      updateProfileButtons();
      return;
    }
    const profile = profiles.find((item) => item.id === selectedId);
    if (!profile) {
      profileSelect.select.value = '';
      selectedProfileId = null;
      updateProfileButtons();
      return;
    }
    profileNameInput.input.value = profile.name;
    privateKeyInput.textarea.value = profile.privateKeyPem;
    publicKeyOutput.textarea.value = profile.publicKeyPem;
    try {
      const importedKey = await importPrivateKeyPem(profile.privateKeyPem);
      assignPrivateKey(importedKey);
      const derivedPublicKeyPem = await exportPublicKeyPemFromPrivate(importedKey);
      if (!pemEquals(derivedPublicKeyPem, profile.publicKeyPem)) {
        profile.publicKeyPem = derivedPublicKeyPem;
        publicKeyOutput.textarea.value = derivedPublicKeyPem;
        persistProfiles(profiles);
        appendLog(logOutput, `Profile "${profile.name}" public key refreshed.`);
      } else {
        appendLog(logOutput, `Loaded profile "${profile.name}".`);
      }
    } catch (error) {
      assignPrivateKey(null);
      reportError(logOutput, error, `Failed to load profile "${profile.name}"`);
    }
    updateProfileButtons();
  });

  newProfileBtn.button.addEventListener('click', () => {
    profileSelect.select.value = '';
    selectedProfileId = null;
    profileNameInput.input.value = '';
    privateKeyInput.textarea.value = '';
    publicKeyOutput.textarea.value = '';
    assignPrivateKey(null);
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
    selectedProfileId = null;
    profileNameInput.input.value = '';
    privateKeyInput.textarea.value = '';
    publicKeyOutput.textarea.value = '';
    assignPrivateKey(null);
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
      const importedKey = await importPrivateKeyPem(pem);
      assignPrivateKey(importedKey);
      const publicKeyPem = await exportPublicKeyPemFromPrivate(importedKey);
      publicKeyOutput.textarea.value = publicKeyPem;

      const selectedId = profileSelect.select.value;
      let savedProfileId = selectedId;
      const existingProfile = profiles.find((item) => item.id === selectedId);
      if (existingProfile) {
        existingProfile.name = name;
        existingProfile.privateKeyPem = pem;
        existingProfile.publicKeyPem = publicKeyPem;
        appendLog(logOutput, `Updated profile "${name}".`);
      } else {
        const newProfile: StoredProfile = {
          id: createProfileId(),
          name,
          privateKeyPem: pem,
          publicKeyPem,
        };
        profiles = [...profiles, newProfile];
        savedProfileId = newProfile.id;
        appendLog(logOutput, `Saved new profile "${name}".`);
      }
      persistProfiles(profiles);
      refreshProfileOptions(profileSelect.select, profiles, savedProfileId ?? null);
      if (savedProfileId) {
        profileSelect.select.value = savedProfileId;
        selectedProfileId = savedProfileId;
      }
      updateProfileButtons();
    } catch (error) {
      reportError(logOutput, error, 'Failed to save profile');
    }
  });

  selectDeviceBtn.button.addEventListener('click', async () => {
    try {
      const vin = normalizeVin(vinInput.input.value);
      if (!vin) {
        throw new Error('VIN is required');
      }
      vinInput.input.value = vin;
      currentVin = vin;
      persistVin(vin);
      onVinChange(vin);
      const discoveryMode = parseDiscoveryMode(discoveryModeSelect.select.value);
      const wasAutoRefreshing = autoRefreshActive;
      if (wasAutoRefreshing) {
        stopAutoRefresh({ silent: true });
        appendLog(logOutput, 'Auto refresh disabled while selecting a new vehicle.');
      }
      session = new TeslaBleSession({ vin, deviceDiscoveryMode: discoveryMode });
      await session.connect();
      appendLog(logOutput, 'Bluetooth device selected and GATT connected.');
      const deviceInfo = session.getSelectedDeviceInfo();
      if (deviceInfo) {
        appendLog(logOutput, `Selected device info: ${formatDeviceInfo(deviceInfo)}.`);
      } else {
        appendLog(logOutput, 'Selected device info: unavailable (no Bluetooth device reference).');
      }
    } catch (error) {
      reportError(logOutput, error, 'Failed to select device');
      if (error instanceof Error && /VIN beacon prefix/.test(error.message)) {
        appendLog(logOutput, 'Tip: Click "Select Vehicle" again and choose the device whose name matches your VIN beacon (SxxxxxxxC).');
      }
    }
  });

  connectBtn.button.addEventListener('click', async () => {
    try {
      if (!session) {
        throw new Error('Select a vehicle first');
      }
      const key = assignPrivateKey(await ensurePrivateKey(privateKeyInput.textarea.value.trim(), privateKey));
      if (!key) {
        throw new Error('Private key unavailable');
      }
      await session.ensureSession(key);
      appendLog(logOutput, 'Session established successfully.');
    } catch (error) {
      reportError(logOutput, error, 'Handshake failed');
    }
  });

  fetchStateBtn.button.addEventListener('click', async () => {
    try {
      await performVehicleStateFetch('manual');
    } catch (error) {
      reportError(logOutput, error, 'Failed to fetch state');
    }
  });

  enrollBtn.button.addEventListener('click', async () => {
    try {
      if (!session) {
        throw new Error('Select a vehicle first');
      }
      let publicKeyRaw: Uint8Array | null = null;
      const publicKeyText = publicKeyOutput.textarea.value.trim();
      if (publicKeyText) {
        publicKeyRaw = await parsePublicKeyInput(publicKeyText);
      } else if (privateKey) {
        publicKeyRaw = await exportPublicKeyFromPrivate(privateKey);
      }
      if (!publicKeyRaw || publicKeyRaw.length === 0) {
        throw new Error('No public key available. Generate/import a key first.');
      }
      const role = parseInt(roleSelect.value, 10);
      const formFactor = parseInt(formSelect.value, 10);
      appendLog(logOutput, 'Sending add-key request over BLE…');
      await session.sendAddKeyRequest({ publicKeyRaw, role, formFactor });
      appendLog(logOutput, 'Request sent. Tap your NFC card on the console and confirm on the vehicle UI to approve.');
      appendLog(logOutput, 'After approval, click Connect to verify session can be established.');
    } catch (error) {
      reportError(logOutput, error, 'Failed to enroll key');
    }
  });

  verifyEnrollBtn.button.addEventListener('click', async () => {
    try {
      if (!session) {
        throw new Error('Select a vehicle first');
      }
      const pem = privateKeyInput.textarea.value.trim();
      const key = assignPrivateKey(await ensurePrivateKey(pem, privateKey));
      if (!key) {
        throw new Error('Private key unavailable');
      }
      verifyEnrollBtn.button.disabled = true;
      enrollBtn.button.disabled = true;
      appendLog(logOutput, 'Verifying enrollment by establishing a session…');
      const maxAttempts = 12;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          await session.ensureSession(key);
          appendLog(logOutput, `Verification successful on attempt ${attempt}. Session established.`);
          return;
        } catch (err) {
          if (attempt === maxAttempts) {
            throw err;
          }
          appendLog(logOutput, `Attempt ${attempt} failed. Waiting 5s before retry…`);
          await sleep(5000);
        }
      }
    } catch (error) {
      reportError(logOutput, error, 'Enrollment verification failed');
    } finally {
      verifyEnrollBtn.button.disabled = false;
      enrollBtn.button.disabled = false;
    }
  });

  privateKeyInput.textarea.addEventListener('input', () => {
    assignPrivateKey(null);
  });

  async function performVehicleStateFetch(mode: 'manual' | 'auto'): Promise<void> {
    if (!session) {
      throw new Error('No session available');
    }
    assignPrivateKey(await ensurePrivateKey(privateKeyInput.textarea.value.trim(), privateKey));
    const selectedCategory = stateSelect.value as StateCategory;
    await fetchCategory(selectedCategory, { log: mode === 'manual', render: true });
    if (mode === 'auto' && selectedCategory !== StateCategory.Drive) {
      await fetchCategory(StateCategory.Drive, { log: false, render: false });
    }
  }

  async function fetchCategory(
    category: StateCategory,
    opts: { log?: boolean; render?: boolean } = {},
  ): Promise<void> {
    if (!session) {
      throw new Error('No session available');
    }
    const key = privateKey;
    if (!key) {
      throw new Error('No private key available');
    }
    const shouldLog = opts.log ?? false;
    const shouldRender = opts.render ?? category === (stateSelect.value as StateCategory);
    if (shouldLog) {
      appendLog(logOutput, `Requesting vehicle state: ${category}…`);
    }
    const startedAt = performance.now();
    const result = await session.getState(category, key);
    const latencyMs = Math.round(performance.now() - startedAt);
    if (shouldRender && category === (stateSelect.value as StateCategory)) {
      renderState(stateResultOutput, result, latencyMs);
    }
    handleVehicleStateResult(category, result, latencyMs);
    if (shouldLog) {
      appendLog(logOutput, `Vehicle state updated at ${formatTimestamp(new Date())} (latency ${latencyMs} ms).`);
    }
  }

  function startAutoRefresh(): void {
    if (autoRefreshActive) {
      return;
    }
    autoRefreshActive = true;
    const currentInterval = getCurrentRefreshInterval();
    persistRefreshInterval(currentInterval);
    appendLog(logOutput, 'Auto refresh enabled.');
    updateAutoRefreshUi();
    void runAutoRefreshCycle();
  }

  function stopAutoRefresh(options?: { silent?: boolean }): void {
    const wasActive = autoRefreshActive;
    autoRefreshActive = false;
    if (autoRefreshTimer !== null) {
      window.clearTimeout(autoRefreshTimer);
      autoRefreshTimer = null;
    }
    updateAutoRefreshUi();
    if (wasActive && !options?.silent) {
      appendLog(logOutput, 'Auto refresh disabled.');
    }
  }

  async function runAutoRefreshCycle(): Promise<void> {
    if (!autoRefreshActive) {
      return;
    }
    try {
      await performVehicleStateFetch('auto');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      appendLog(logOutput, `Auto refresh failed: ${detail}`);
      console.error('Auto refresh error', error);
      const wasActive = autoRefreshActive;
      stopAutoRefresh({ silent: true });
      if (wasActive) {
        appendLog(logOutput, 'Auto refresh stopped due to error.');
      }
      return;
    }
    scheduleNextAutoRefresh();
  }

  function scheduleNextAutoRefresh(): void {
    if (!autoRefreshActive) {
      return;
    }
    const delay = getCurrentRefreshInterval();
    autoRefreshTimer = window.setTimeout(() => {
      void runAutoRefreshCycle();
    }, delay);
  }

  function restartAutoRefreshTimer(): void {
    if (!autoRefreshActive) {
      return;
    }
    if (autoRefreshTimer !== null) {
      window.clearTimeout(autoRefreshTimer);
      autoRefreshTimer = null;
    }
    scheduleNextAutoRefresh();
  }

  function getCurrentRefreshInterval(): number {
    const sanitized = sanitizeRefreshInterval(refreshIntervalInput.input.value);
    if (refreshIntervalInput.input.value !== String(sanitized)) {
      refreshIntervalInput.input.value = String(sanitized);
    }
    return sanitized;
  }

  function assignPrivateKey(value: CryptoKey | null): CryptoKey | null {
    privateKey = value;
    onKeyStatusChange(Boolean(value));
    if (!value) {
      onVehicleState(StateCategory.Drive, null, null);
    }
    return value;
  }

  function handleVehicleStateResult(category: StateCategory, result: VehicleStateResult, latencyMs: number) {
    onVehicleState(category, result, latencyMs);
  }

  function updateAutoRefreshUi() {
    autoRefreshToggle.checked = autoRefreshActive;
    onAutoRefreshStateChange(autoRefreshActive);
  }

  function updateProfileButtons() {
    const hasSelection = Boolean(
      profileSelect.select.value && profiles.some((item) => item.id === profileSelect.select.value),
    );
    deleteProfileBtn.button.disabled = !hasSelection;
  }

  return {
    key: 'debug',
    label: 'Debug',
    element: page,
    async initialize() {
      await initialize();
    },
    handleAutoRefreshToggleRequest() {
      if (autoRefreshActive) {
        stopAutoRefresh();
      } else {
        startAutoRefresh();
      }
    },
  };
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
  return importPrivateKeyPem(text);
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

function renderState(target: HTMLElement, result: VehicleStateResult, latencyMs: number): void {
  const timestamp = formatTimestamp(new Date());
  const payload = JSON.stringify(result.vehicleData, null, 2);
  target.textContent = `Last update (${timestamp}) — Category: ${result.category} — Latency: ${latencyMs} ms\n${payload}`;
}

function normalizePem(value: string): string {
  return value.trim().replace(/\r\n/g, '\n');
}

function pemEquals(a: string, b: string): boolean {
  return normalizePem(a) === normalizePem(b);
}

async function parsePublicKeyInput(text: string): Promise<Uint8Array> {
  if (/-----BEGIN [^-]+-----/.test(text)) {
    return publicKeyPemToRaw(text);
  }
  const clean = text.replace(/\s+/g, '');
  if (/^[0-9a-fA-F]+$/.test(clean) && clean.length > 0) {
    return hexToBytes(clean);
  }
  throw new Error('Public key must be provided as PEM or hexadecimal.');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length % 2 !== 0) {
    throw new Error('Invalid hex string length');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

function formatTimestamp(date: Date): string {
  return date.toLocaleString();
}

function formatDeviceId(id: string): string {
  try {
    const normalized = id.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    if (!binary) {
      return id;
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
  } catch (error) {
    console.warn('Failed to decode device id as base64, leaving as-is.', error);
    return id;
  }
}

function formatDeviceInfo(info: SelectedDeviceInfo): string {
  const uuidList = info.uuids && info.uuids.length
    ? info.uuids
        .map((uuid) => (typeof uuid === 'number' ? `0x${uuid.toString(16)}` : String(uuid)))
        .join(', ')
    : '(none)';
  const parts = [
    `name=${info.name ?? '(none)'}`,
    `id=${formatDeviceId(info.id)}`,
    `uuids=${uuidList}`,
    `gattConnected=${info.gattConnected}`,
    `watchAdvertisementsSupported=${info.watchAdvertisementsSupported}`,
  ];
  return parts.join(', ');
}

function option(label: string, value: string) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

function parseDiscoveryMode(value: string): DeviceDiscoveryMode {
  switch (value) {
    case DeviceDiscoveryMode.VinPrefixPromptFilter:
    case DeviceDiscoveryMode.VinPrefixValidation:
    case DeviceDiscoveryMode.Unfiltered:
      return value;
    default:
      console.warn('Unknown discovery mode value, defaulting to VIN prefix validation.', value);
      return DeviceDiscoveryMode.VinPrefixValidation;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeVin(value: string): string {
  return value.trim().toUpperCase();
}

function loadStoredVin(): string {
  const storage = getLocalStorage();
  if (!storage) {
    return '';
  }
  try {
    return storage.getItem(VIN_STORAGE_KEY) ?? '';
  } catch (error) {
    console.warn('Failed to load stored VIN', error);
    return '';
  }
}

function persistVin(value: string): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  const normalized = normalizeVin(value);
  try {
    if (normalized) {
      storage.setItem(VIN_STORAGE_KEY, normalized);
    } else {
      storage.removeItem(VIN_STORAGE_KEY);
    }
  } catch (error) {
    console.warn('Failed to persist VIN', error);
  }
}

function loadStoredRefreshInterval(): number {
  const storage = getLocalStorage();
  if (!storage) {
    return DEFAULT_REFRESH_INTERVAL_MS;
  }
  try {
    const storedValue = storage.getItem(REFRESH_INTERVAL_STORAGE_KEY);
    if (!storedValue) {
      return DEFAULT_REFRESH_INTERVAL_MS;
    }
    return sanitizeRefreshInterval(storedValue);
  } catch (error) {
    console.warn('Failed to load refresh interval', error);
    return DEFAULT_REFRESH_INTERVAL_MS;
  }
}

function persistRefreshInterval(value: number): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(REFRESH_INTERVAL_STORAGE_KEY, String(value));
  } catch (error) {
    console.warn('Failed to persist refresh interval', error);
  }
}

async function loadStoredProfiles(): Promise<StoredProfile[]> {
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
    return parsed.filter((item): item is StoredProfile => Boolean(item && item.id && item.privateKeyPem));
  } catch (error) {
    console.warn('Failed to load profiles', error);
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
    const opt = document.createElement('option');
    opt.value = profile.id;
    opt.textContent = profile.name;
    select.append(opt);
  });
  if (selectedId && profiles.some((profile) => profile.id === selectedId)) {
    select.value = selectedId;
  } else {
    select.value = '';
  }
}

function sanitizeRefreshInterval(value: string | number | null | undefined): number {
  const numeric = typeof value === 'number'
    ? value
    : Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_REFRESH_INTERVAL_MS;
  }
  const rounded = Math.round(numeric);
  return Math.min(MAX_REFRESH_INTERVAL_MS, Math.max(MIN_REFRESH_INTERVAL_MS, rounded));
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
