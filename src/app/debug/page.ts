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
  publicKeyRawToPem,
} from '../../lib/crypto';
import { createButton, createInput, createOption, createSelect, createTextarea } from '../elements';

const PROFILE_STORAGE_KEY = 'tsla.profiles';
const VIN_STORAGE_KEY = 'tsla.vin';
const REFRESH_INTERVAL_STORAGE_KEY = 'tsla.stateRefreshIntervalMs';
const DEFAULT_REFRESH_INTERVAL_MS = 1000;
const MIN_REFRESH_INTERVAL_MS = 0;
const MAX_REFRESH_INTERVAL_MS = 60_000;

export interface DashboardBridge {
  setSpeed(value: string | null): void;
  setGear(value: string | null): void;
  setLastUpdate(text: string): void;
  setVin(value: string | null): void;
  setKeyLoaded(loaded: boolean): void;
  setAutoRefresh(active: boolean, intervalMs: number): void;
}

export interface DebugPageHooks {
  dashboard: DashboardBridge;
}

export interface DebugPageController {
  element: HTMLElement;
  toggleAutoRefreshFromDashboard(): void;
}

export async function createDebugPage(
  container: HTMLElement,
  hooks: DebugPageHooks,
): Promise<DebugPageController> {
  const dashboard = hooks.dashboard;

  const debugContent = document.createElement('div');
  debugContent.className = 'tsla-debug';
  container.append(debugContent);

  const profileSelect = createSelect('Profile');
  const profileNameInput = createInput('Profile Name', 'text');
  const vinInput = createInput('VIN', 'text');
  vinInput.input.placeholder = '5YJ3E1EA7JF000000';

  const storedVin = loadStoredVin();
  if (storedVin) {
    vinInput.input.value = storedVin;
  }
  updateVinDisplay();
  vinInput.input.addEventListener('change', () => {
    const normalized = normalizeVin(vinInput.input.value);
    vinInput.input.value = normalized;
    persistVin(normalized);
    updateVinDisplay();
  });
  vinInput.input.addEventListener('input', () => {
    updateVinDisplay();
  });

  const discoveryModeSelect = createSelect('Device Discovery Mode');
  discoveryModeSelect.select.append(
    createOption('VIN prefix filter in prompt', DeviceDiscoveryMode.VinPrefixPromptFilter),
    createOption('VIN prefix validation after selection', DeviceDiscoveryMode.VinPrefixValidation),
    createOption('No VIN prefix checks (default)', DeviceDiscoveryMode.Unfiltered),
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
    const option = document.createElement('option');
    option.value = value;
    option.textContent = prettyLabel(value);
    stateSelect.append(option);
  });
  stateSelect.value = StateCategory.Drive;

  const refreshIntervalInput = createInput('Refresh Interval (ms)', 'number');
  refreshIntervalInput.input.min = String(MIN_REFRESH_INTERVAL_MS);
  refreshIntervalInput.input.step = '100';
  refreshIntervalInput.input.value = String(loadStoredRefreshInterval());

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
  roleSelect.append(createOption('Driver', String(KeyRole.ROLE_DRIVER)));
  roleSelect.append(createOption('Owner', String(KeyRole.ROLE_OWNER)));
  roleSelect.append(createOption('Vehicle Monitor', String(KeyRole.ROLE_VEHICLE_MONITOR)));
  roleLabel.append(roleSelect);

  const formLabel = document.createElement('label');
  formLabel.textContent = 'Form Factor';
  const formSelect = document.createElement('select');
  formSelect.className = 'tsla-select';
  formSelect.append(createOption('iOS Device', String(KeyFormFactor.KEY_FORM_FACTOR_IOS_DEVICE)));
  formSelect.append(createOption('Android Device', String(KeyFormFactor.KEY_FORM_FACTOR_ANDROID_DEVICE)));
  formSelect.append(createOption('NFC Card', String(KeyFormFactor.KEY_FORM_FACTOR_NFC_CARD)));
  formSelect.append(createOption('Cloud Key', String(KeyFormFactor.KEY_FORM_FACTOR_CLOUD_KEY)));
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
  let profiles = await loadStoredProfiles();
  let autoRefreshTimer: number | null = null;
  let autoRefreshActive = false;

  dashboard.setVin(storedVin || null);
  dashboard.setKeyLoaded(false);
  dashboard.setSpeed(null);
  dashboard.setGear(null);
  dashboard.setLastUpdate('Last update: --');
  dashboard.setAutoRefresh(autoRefreshActive, getCurrentRefreshInterval());

  function updateVinDisplay(): void {
    const vin = normalizeVin(vinInput.input.value);
    dashboard.setVin(vin || null);
  }

  function updateKeyStatus(): void {
    dashboard.setKeyLoaded(Boolean(privateKey));
  }

  function updateAutoRefreshUi(): void {
    const interval = getCurrentRefreshInterval();
    autoRefreshToggle.checked = autoRefreshActive;
    dashboard.setAutoRefresh(autoRefreshActive, interval);
  }

  function updateDashboardTelemetry(result: VehicleStateResult, latencyMs: number): void {
    const driveState = extractDriveState(result.vehicleData);
    const timestamp = new Date();
    if (!driveState) {
      if (result.category === StateCategory.Drive) {
        dashboard.setSpeed(null);
        dashboard.setGear(null);
        dashboard.setLastUpdate(formatLastUpdate(timestamp, latencyMs));
      }
      return;
    }
    const speedValue = getSpeedDisplayValue(driveState);
    dashboard.setSpeed(speedValue);
    dashboard.setGear(formatShiftStateLabel(driveState.shiftState));
    dashboard.setLastUpdate(formatLastUpdate(timestamp, latencyMs));
  }

  refreshProfileOptions(profileSelect.select, profiles, null);
  updateProfileButtons();

  const handleRefreshIntervalChange = () => {
    const sanitized = sanitizeRefreshInterval(refreshIntervalInput.input.value);
    refreshIntervalInput.input.value = String(sanitized);
    persistRefreshInterval(sanitized);
    restartAutoRefreshTimer();
    updateAutoRefreshUi();
  };
  refreshIntervalInput.input.addEventListener('change', handleRefreshIntervalChange);
  refreshIntervalInput.input.addEventListener('blur', handleRefreshIntervalChange);

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
      privateKey = keyPair.privateKey;
      updateKeyStatus();
      const pem = await exportPrivateKeyPem(privateKey);
      privateKeyInput.textarea.value = pem;
      const publicKeyPem = await exportPublicKeyPem(keyPair.publicKey);
      publicKeyOutput.textarea.value = publicKeyPem;
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
      updateKeyStatus();
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
    publicKeyOutput.textarea.value = profile.publicKeyPem;
    try {
      const importedKey = await importPrivateKeyPem(profile.privateKeyPem);
      privateKey = importedKey;
      updateKeyStatus();
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
      privateKey = null;
      updateKeyStatus();
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
    updateKeyStatus();
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
    updateKeyStatus();
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
      const key = await importPrivateKeyPem(pem);
      privateKey = key;
      updateKeyStatus();
      const publicKeyPem = await exportPublicKeyPemFromPrivate(key);
      publicKeyOutput.textarea.value = publicKeyPem;
      let profile = profiles.find((item) => item.id === profileSelect.select.value);
      if (!profile) {
        profile = {
          id: createProfileId(),
          name,
          privateKeyPem: pem,
          publicKeyPem,
        };
        profiles = [...profiles, profile];
        appendLog(logOutput, `Created new profile "${name}".`);
      } else {
        profile.name = name;
        profile.privateKeyPem = pem;
        profile.publicKeyPem = publicKeyPem;
        appendLog(logOutput, `Updated profile "${name}".`);
      }
      persistProfiles(profiles);
      refreshProfileOptions(profileSelect.select, profiles, profile.id);
      profileSelect.select.value = profile.id;
      updateProfileButtons();
    } catch (error) {
      reportError(logOutput, error, 'Failed to save profile');
    }
  });

  privateKeyInput.textarea.addEventListener('input', () => {
    privateKey = null;
    updateKeyStatus();
  });

  privateKeyInput.textarea.addEventListener('blur', async () => {
    if (!privateKeyInput.textarea.value.trim()) {
      privateKey = null;
      updateKeyStatus();
      return;
    }
    try {
      const imported = await importPrivateKeyPem(privateKeyInput.textarea.value);
      privateKey = imported;
      updateKeyStatus();
      const publicKeyPem = await exportPublicKeyPemFromPrivate(imported);
      publicKeyOutput.textarea.value = publicKeyPem;
    } catch (error) {
      privateKey = null;
      updateKeyStatus();
      reportError(logOutput, error, 'Failed to parse private key');
    }
  });

  publicKeyOutput.textarea.addEventListener('focus', () => {
    publicKeyOutput.textarea.select();
  });

  selectDeviceBtn.button.addEventListener('click', async () => {
    try {
      const vin = normalizeVin(vinInput.input.value);
      if (!vin) {
        throw new Error('VIN is required');
      }
      vinInput.input.value = vin;
      persistVin(vin);
      updateVinDisplay();
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
        appendLog(
          logOutput,
          'Tip: Click "Select Vehicle" again and choose the device whose name matches your VIN beacon (SxxxxxxxC).',
        );
      }
    }
  });

  connectBtn.button.addEventListener('click', async () => {
    try {
      if (!session) {
        throw new Error('Select a vehicle first');
      }
      privateKey = await ensurePrivateKey(privateKeyInput.textarea.value.trim(), privateKey);
      updateKeyStatus();
      await session.ensureSession(privateKey);
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
      privateKey = await ensurePrivateKey(pem, privateKey);
      updateKeyStatus();
      verifyEnrollBtn.button.disabled = true;
      enrollBtn.button.disabled = true;
      appendLog(logOutput, 'Verifying enrollment by establishing a session…');
      const maxAttempts = 12; // ~1 minute with 5s interval
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          await session.ensureSession(privateKey);
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

  updateKeyStatus();
  updateAutoRefreshUi();

  async function performVehicleStateFetch(mode: 'manual' | 'auto'): Promise<void> {
    if (!session) {
      throw new Error('No session available');
    }
    privateKey = await ensurePrivateKey(privateKeyInput.textarea.value.trim(), privateKey);
    updateKeyStatus();
    const category = stateSelect.value as StateCategory;
    if (mode === 'manual') {
      appendLog(logOutput, `Requesting vehicle state: ${category}…`);
    }
    const startedAt = performance.now();
    const result = await session.getState(category, privateKey);
    const latencyMs = Math.round(performance.now() - startedAt);
    renderState(stateResultOutput, result, latencyMs);
    updateDashboardTelemetry(result, latencyMs);
    if (mode === 'manual') {
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

  function updateProfileButtons() {
    const hasSelection = Boolean(
      profileSelect.select.value && profiles.some((item) => item.id === profileSelect.select.value),
    );
    deleteProfileBtn.button.disabled = !hasSelection;
  }

  return {
    element: container,
    toggleAutoRefreshFromDashboard() {
      if (autoRefreshActive) {
        stopAutoRefresh();
      } else {
        startAutoRefresh();
      }
    },
  } satisfies DebugPageController;
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

function formatLastUpdate(date: Date, latencyMs?: number | null): string {
  if (typeof latencyMs === 'number' && Number.isFinite(latencyMs)) {
    return `Last update: ${formatTimestamp(date)} (${latencyMs} ms)`;
  }
  return `Last update: ${formatTimestamp(date)}`;
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
    const raw = storage.getItem(REFRESH_INTERVAL_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_REFRESH_INTERVAL_MS;
    }
    return sanitizeRefreshInterval(raw);
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
    storage.setItem(REFRESH_INTERVAL_STORAGE_KEY, String(sanitizeRefreshInterval(value)));
  } catch (error) {
    console.warn('Failed to persist refresh interval', error);
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
    const results: StoredProfile[] = [];
    let mutated = false;
    for (const item of parsed) {
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.privateKeyPem === 'string'
      ) {
        let publicKeyPem = typeof item.publicKeyPem === 'string' ? item.publicKeyPem : null;
        if (!publicKeyPem && typeof item.publicKeyHex === 'string') {
          try {
            const rawKey = hexToBytes(item.publicKeyHex);
            publicKeyPem = await publicKeyRawToPem(rawKey);
            mutated = true;
          } catch (error) {
            console.warn('Failed to convert stored public key hex to PEM', error);
          }
        }
        if (!publicKeyPem) {
          try {
            const imported = await importPrivateKeyPem(item.privateKeyPem);
            publicKeyPem = await exportPublicKeyPemFromPrivate(imported);
            mutated = true;
          } catch (error) {
            console.warn('Failed to derive public key PEM from private key', error);
            continue;
          }
        }
        results.push({
          id: item.id,
          name: item.name,
          privateKeyPem: item.privateKeyPem,
          publicKeyPem,
        });
      }
    }
    if (mutated) {
      persistProfiles(results);
    }
    return results;
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

function extractDriveState(vehicleData: any): any | null {
  if (!vehicleData || typeof vehicleData !== 'object') {
    return null;
  }
  if (vehicleData.driveState && typeof vehicleData.driveState === 'object') {
    return vehicleData.driveState;
  }
  if (vehicleData.drive && typeof vehicleData.drive === 'object') {
    return vehicleData.drive;
  }
  const key = Object.keys(vehicleData).find((item) => item.toLowerCase() === 'drivestate');
  if (key) {
    const value = (vehicleData as Record<string, unknown>)[key];
    if (value && typeof value === 'object') {
      return value;
    }
  }
  return null;
}

function getSpeedDisplayValue(state: any): string | null {
  const floatValue = typeof state.speedFloat === 'number' ? state.speedFloat : null;
  if (floatValue !== null && Number.isFinite(floatValue)) {
    return Math.round(floatValue).toString();
  }
  const intValue = typeof state.speed === 'number' ? state.speed : null;
  if (intValue !== null && Number.isFinite(intValue)) {
    return Math.round(intValue).toString();
  }
  return null;
}

function formatShiftStateLabel(value: unknown): string {
  if (!value) {
    return '--';
  }
  if (typeof value === 'string') {
    return normalizeShiftLabel(value);
  }
  if (typeof value === 'number') {
    return shiftStateFromNumber(value);
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.type === 'string') {
      return normalizeShiftLabel(record.type);
    }
    const candidate = Object.keys(record).find((key) => key !== 'type' && record[key] !== undefined);
    if (candidate) {
      return normalizeShiftLabel(candidate);
    }
  }
  return '--';
}

function shiftStateFromNumber(index: number): string {
  const mapping = ['--', 'P', 'R', 'N', 'D', '—'];
  return mapping[index] ?? '--';
}

function normalizeShiftLabel(label: string): string {
  const normalized = label.toUpperCase();
  if (normalized === 'INVALID') {
    return '--';
  }
  if (normalized === 'SNA') {
    return '—';
  }
  return normalized.length > 0 ? normalized[0] : '--';
}

interface StoredProfile {
  id: string;
  name: string;
  privateKeyPem: string;
  publicKeyPem: string;
}
