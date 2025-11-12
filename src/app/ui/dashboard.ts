import { VehicleStateResult } from '../../lib/session';

export interface DashboardPageOptions {
  onAutoRefreshToggle?: () => void;
}

export interface DashboardPageController {
  key: 'dashboard';
  label: string;
  element: HTMLElement;
  setVin(value: string | null): void;
  setKeyLoaded(hasKey: boolean): void;
  updateDriveState(result: VehicleStateResult | null): void;
  setAutoRefreshState(active: boolean): void;
}

export function createDashboardPage(options: DashboardPageOptions = {}): DashboardPageController {
  const { onAutoRefreshToggle = () => {} } = options;

  const page = document.createElement('section');
  page.className = 'tsla-page tsla-dashboard';

  const display = document.createElement('div');
  display.className = 'tsla-dashboard__display';
  const speedValue = document.createElement('div');
  speedValue.className = 'tsla-dashboard__speed';
  speedValue.textContent = DEFAULT_SPEED_DISPLAY;
  const gearValue = document.createElement('div');
  gearValue.className = 'tsla-dashboard__gear';
  gearValue.textContent = DEFAULT_GEAR_DISPLAY;
  display.append(speedValue, gearValue);

  const status = document.createElement('div');
  status.className = 'tsla-dashboard__status';
  const vinDisplay = document.createElement('div');
  vinDisplay.className = 'tsla-dashboard__status-item';
  const keyDisplay = document.createElement('div');
  keyDisplay.className = 'tsla-dashboard__status-item';
  status.append(vinDisplay, keyDisplay);

  const controls = document.createElement('div');
  controls.className = 'tsla-dashboard__controls';
  const orientationButton = document.createElement('button');
  orientationButton.type = 'button';
  orientationButton.className = 'tsla-dashboard__button';
  const autoRefreshButton = document.createElement('button');
  autoRefreshButton.type = 'button';
  autoRefreshButton.className = 'tsla-dashboard__button tsla-dashboard__button--primary';
  controls.append(orientationButton, autoRefreshButton);

  page.append(display, status, controls);

  let isLandscape = false;
  let autoRefreshActive = false;

  const updateOrientationButton = () => {
    orientationButton.textContent = isLandscape ? 'Portrait Layout' : 'Landscape Layout';
    orientationButton.setAttribute('aria-pressed', isLandscape ? 'true' : 'false');
  };

  orientationButton.addEventListener('click', () => {
    isLandscape = !isLandscape;
    page.classList.toggle('tsla-dashboard--landscape', isLandscape);
    updateOrientationButton();
  });

  autoRefreshButton.addEventListener('click', () => {
    onAutoRefreshToggle();
  });

  updateOrientationButton();
  setVinText(vinDisplay, null);
  setKeyText(keyDisplay, false);
  updateAutoRefreshButton(autoRefreshButton, autoRefreshActive);

  return {
    key: 'dashboard',
    label: 'Dashboard',
    element: page,
    setVin(value) {
      setVinText(vinDisplay, value);
    },
    setKeyLoaded(hasKey) {
      setKeyText(keyDisplay, hasKey);
    },
    updateDriveState(result) {
      const driveState = result?.vehicleData?.driveState ?? result?.vehicleData?.drive_state ?? null;
      const speed = parseVehicleSpeed(driveState);
      speedValue.textContent = formatSpeedDisplay(speed);
      const shiftRaw = driveState?.shiftState ?? driveState?.shift_state;
      gearValue.textContent = formatShiftState(shiftRaw);
    },
    setAutoRefreshState(active) {
      autoRefreshActive = active;
      updateAutoRefreshButton(autoRefreshButton, active);
    },
  };
}

function setVinText(target: HTMLElement, value: string | null) {
  target.textContent = value ? `VIN: ${value}` : 'VIN: —';
}

function setKeyText(target: HTMLElement, hasKey: boolean) {
  target.textContent = hasKey ? 'Key: Loaded' : 'Key: Not loaded';
}

function updateAutoRefreshButton(button: HTMLButtonElement, active: boolean) {
  button.textContent = active ? 'Stop Auto Refresh' : 'Start Auto Refresh';
  button.classList.toggle('is-active', active);
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
}

function parseVehicleSpeed(driveState: any): number | null {
  if (!driveState || typeof driveState !== 'object') {
    return null;
  }
  const candidates = [
    driveState.speedFloat,
    driveState.speed_float,
    driveState.speed,
    driveState.optionalSpeedFloat,
    driveState.optional_speed_float,
    driveState.optionalSpeed,
    driveState.optional_speed,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
    if (candidate && typeof candidate === 'object') {
      const nested = candidate.speedFloat ?? candidate.speed_float ?? candidate.speed;
      if (typeof nested === 'number' && Number.isFinite(nested)) {
        return nested;
      }
    }
  }
  return null;
}

function formatSpeedDisplay(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return DEFAULT_SPEED_DISPLAY;
  }
  const rounded = Math.max(0, Math.round(value));
  return String(rounded);
}

function formatShiftState(raw: any): string {
  if (!raw) {
    return DEFAULT_GEAR_DISPLAY;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return DEFAULT_GEAR_DISPLAY;
    }
    if (trimmed.length === 1) {
      return trimmed.toUpperCase();
    }
    const match = trimmed.match(/[PRND]/i);
    if (match) {
      return match[0].toUpperCase();
    }
    return trimmed.toUpperCase();
  }
  if (typeof raw === 'object') {
    for (const key of ['P', 'R', 'N', 'D']) {
      if (raw[key] != null || raw[key.toLowerCase()] != null) {
        return key;
      }
    }
    if (raw.Invalid != null || raw.invalid != null) {
      return DEFAULT_GEAR_DISPLAY;
    }
    if (typeof raw.type === 'string') {
      return formatShiftState(raw.type);
    }
  }
  return DEFAULT_GEAR_DISPLAY;
}

const DEFAULT_SPEED_DISPLAY = '--';
const DEFAULT_GEAR_DISPLAY = '—';
