import { createButton } from '../elements';

export type DashboardOrientation = 'portrait' | 'landscape';

export interface DashboardPage {
  element: HTMLElement;
  setSpeed(value: string | null): void;
  setGear(value: string | null): void;
  setLastUpdate(text: string): void;
  setVin(value: string | null): void;
  setKeyLoaded(loaded: boolean): void;
  setAutoRefresh(active: boolean, intervalMs: number): void;
  onAutoRefreshToggle(handler: () => void): void;
}

export function createDashboardPage(container: HTMLElement): DashboardPage {
  const dashboardContent = document.createElement('div');
  dashboardContent.className = 'tsla-dashboard';
  container.append(dashboardContent);

  const speedWrapper = document.createElement('div');
  speedWrapper.className = 'tsla-dashboard__speed-wrapper';
  const speedDisplay = document.createElement('div');
  speedDisplay.className = 'tsla-dashboard__speed';
  speedDisplay.textContent = '--';
  const speedUnit = document.createElement('div');
  speedUnit.className = 'tsla-dashboard__speed-unit';
  speedUnit.textContent = 'mph';
  speedWrapper.append(speedDisplay, speedUnit);

  const gearDisplay = document.createElement('div');
  gearDisplay.className = 'tsla-dashboard__gear';
  gearDisplay.textContent = '--';

  const telemetryWrapper = document.createElement('div');
  telemetryWrapper.className = 'tsla-dashboard__telemetry';
  telemetryWrapper.append(speedWrapper, gearDisplay);

  const controls = document.createElement('div');
  controls.className = 'tsla-dashboard__controls';
  const orientationToggleBtn = createButton('Switch to Landscape');
  orientationToggleBtn.button.classList.add('tsla-button--outline');
  const autoRefreshBtn = createButton('Start Auto Refresh');
  autoRefreshBtn.button.classList.add('tsla-button--accent');
  controls.append(orientationToggleBtn.button, autoRefreshBtn.button);

  const meta = document.createElement('div');
  meta.className = 'tsla-dashboard__meta';
  const lastUpdate = document.createElement('div');
  lastUpdate.textContent = 'Last update: --';
  const autoRefreshStatus = document.createElement('div');
  autoRefreshStatus.textContent = 'Auto refresh: Off';
  const vinStatus = document.createElement('div');
  vinStatus.textContent = 'VIN: --';
  const keyStatus = document.createElement('div');
  keyStatus.textContent = 'Key: Not loaded';
  meta.append(lastUpdate, autoRefreshStatus, vinStatus, keyStatus);

  dashboardContent.append(telemetryWrapper, controls, meta);

  let orientation: DashboardOrientation = 'portrait';
  orientationToggleBtn.button.addEventListener('click', () => {
    orientation = orientation === 'portrait' ? 'landscape' : 'portrait';
    updateOrientationUi();
  });

  function updateOrientationUi(): void {
    container.classList.toggle('tsla-page--dashboard-landscape', orientation === 'landscape');
    orientationToggleBtn.button.textContent =
      orientation === 'landscape' ? 'Switch to Portrait' : 'Switch to Landscape';
  }

  function setAutoRefreshButtonState(active: boolean): void {
    autoRefreshBtn.button.textContent = active ? 'Stop Auto Refresh' : 'Start Auto Refresh';
    autoRefreshBtn.button.classList.toggle('tsla-button--danger', active);
    autoRefreshBtn.button.classList.toggle('tsla-button--accent', !active);
  }

  updateOrientationUi();

  return {
    element: container,
    setSpeed(value) {
      speedDisplay.textContent = value && value.length > 0 ? value : '--';
    },
    setGear(value) {
      gearDisplay.textContent = value && value.length > 0 ? value : '--';
    },
    setLastUpdate(text) {
      lastUpdate.textContent = text;
    },
    setVin(value) {
      vinStatus.textContent = value ? `VIN: ${value}` : 'VIN: --';
    },
    setKeyLoaded(loaded) {
      keyStatus.textContent = loaded ? 'Key: Loaded' : 'Key: Not loaded';
    },
    setAutoRefresh(active, intervalMs) {
      setAutoRefreshButtonState(active);
      const intervalLabel = `${intervalMs.toLocaleString()} ms`;
      autoRefreshStatus.textContent = active
        ? `Auto refresh: On (${intervalLabel})`
        : `Auto refresh: Off (${intervalLabel})`;
    },
    onAutoRefreshToggle(handler) {
      autoRefreshBtn.button.addEventListener('click', () => {
        handler();
      });
    },
  } satisfies DashboardPage;
}
