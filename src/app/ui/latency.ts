import { VehicleStateResult } from '../../lib/session';

type FacingMode = 'environment' | 'user';

const DEFAULT_SPEED_DISPLAY = '--';
const DEFAULT_GEAR_DISPLAY = '—';

export interface LatencyPageController {
  key: 'latency';
  label: string;
  element: HTMLElement;
  onHide(): void;
  setVehicleState(result: VehicleStateResult | null): void;
  setAutoRefreshState(active: boolean): void;
}

export function createLatencyPage(): LatencyPageController {
  const page = document.createElement('section');
  page.className = 'tsla-page tsla-latency';

  const content = document.createElement('div');
  content.className = 'tsla-latency__content';

  const header = document.createElement('div');
  header.className = 'tsla-latency__header';
  const title = document.createElement('h2');
  title.textContent = 'Latency Capture Workspace';
  const subtitle = document.createElement('p');
  subtitle.className = 'tsla-latency__description';
  subtitle.textContent =
    'Aim your phone camera at the Tesla display while the BLE speed replicates on the right. Record this layout to analyze latency offline.';
  header.append(title, subtitle);

  const previewCard = createPreviewCard();
  const telemetryCard = createTelemetryCard();

  const layout = document.createElement('div');
  layout.className = 'tsla-latency__grid';
  layout.append(previewCard.element, telemetryCard.element);

  content.append(header, layout);
  page.append(content);

  let currentStream: MediaStream | null = null;
  let currentFacingMode: FacingMode = 'environment';
  let isStartingPreview = false;

  previewCard.startButton.addEventListener('click', () => {
    if (currentStream) {
      stopPreview();
    } else {
      void startPreview();
    }
  });

  previewCard.flipButton.addEventListener('click', () => {
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    previewCard.flipButton.textContent =
      currentFacingMode === 'environment' ? 'Use Front Camera' : 'Use Rear Camera';
    if (currentStream) {
      void restartPreview();
    }
  });

  previewCard.checkButton.addEventListener('click', () => {
    if (isCameraSupported()) {
      setStatus(previewCard.statusText, 'Camera API is available.', 'success');
    } else {
      setStatus(previewCard.statusText, 'Camera API is not available on this device.', 'error');
    }
  });

  async function startPreview(): Promise<void> {
    if (!isCameraSupported()) {
      setStatus(previewCard.statusText, 'Camera API is not available on this device.', 'error');
      updatePreviewButton();
      return;
    }
    if (isStartingPreview) {
      return;
    }
    isStartingPreview = true;
    updatePreviewButton();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: createVideoConstraints(currentFacingMode),
      });
      assignStream(stream);
      setStatus(
        previewCard.statusText,
        'Camera stream active. Use the preview to aim before recording.',
        'success',
      );
    } catch (error) {
      releaseStream();
      setStatus(previewCard.statusText, formatMediaError(error), 'error');
    } finally {
      isStartingPreview = false;
      updatePreviewButton();
    }
  }

  function stopPreview() {
    releaseStream();
    setStatus(previewCard.statusText, 'Camera preview stopped.', 'default');
    updatePreviewButton();
  }

  async function restartPreview() {
    stopPreview();
    await startPreview();
  }

  function assignStream(stream: MediaStream) {
    releaseStream();
    currentStream = stream;
    previewCard.video.srcObject = stream;
  updatePreviewState();
    void previewCard.video.play().catch(() => {});
  }

  function releaseStream() {
    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
    }
    currentStream = null;
    previewCard.video.srcObject = null;
    updatePreviewState();
  }

  function updatePreviewState() {
    previewCard.video.classList.toggle('is-idle', !currentStream);
  }

  function updatePreviewButton() {
    if (!isCameraSupported()) {
      previewCard.startButton.disabled = true;
      previewCard.startButton.textContent = 'Camera Not Available';
      return;
    }
    if (isStartingPreview) {
      previewCard.startButton.disabled = true;
      previewCard.startButton.textContent = 'Starting…';
      return;
    }
    previewCard.startButton.disabled = false;
    previewCard.startButton.textContent = currentStream ? 'Stop Preview' : 'Start Preview';
  }

  function setVehicleState(result: VehicleStateResult | null) {
    const { speed, gear } = extractDriveInsights(result);
    telemetryCard.speedValue.textContent =
      speed !== null && Number.isFinite(speed) ? String(Math.round(speed)) : DEFAULT_SPEED_DISPLAY;
    telemetryCard.gearValue.textContent = gear ?? DEFAULT_GEAR_DISPLAY;
  }

  function setAutoRefreshState(active: boolean) {
    telemetryCard.refreshBadge.textContent = active ? 'Auto refresh on' : 'Auto refresh off';
    telemetryCard.refreshBadge.classList.toggle('is-active', active);
  }

  function onHide() {
    stopPreview();
  }

  return {
    key: 'latency',
    label: 'Latency',
    element: page,
    onHide,
    setVehicleState,
    setAutoRefreshState,
  };
}

function createPreviewCard() {
  const card = document.createElement('div');
  card.className = 'tsla-latency__card';
  const title = document.createElement('h3');
  title.className = 'tsla-latency__card-title';
  title.textContent = 'Camera Preview';
  const description = document.createElement('p');
  description.className = 'tsla-latency__description';
  description.textContent = 'Keep the Tesla display centered and tap Start Preview before recording.';

  const previewArea = document.createElement('div');
  previewArea.className = 'tsla-latency__preview';
  const video = document.createElement('video');
  video.className = 'tsla-latency__video is-idle';
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.controls = false;
  previewArea.append(video);

  const actions = document.createElement('div');
  actions.className = 'tsla-latency__actions';
  const startButton = createLatencyButton('Start Preview', true);
  const flipButton = createLatencyButton('Use Front Camera');
  const checkButton = createLatencyButton('Check Camera Support');
  actions.append(startButton, flipButton, checkButton);

  const statusText = document.createElement('p');
  statusText.className = 'tsla-latency__status';
  statusText.textContent = 'Camera idle.';

  card.append(title, description, previewArea, actions, statusText);
  return { element: card, previewArea, video, startButton, flipButton, checkButton, statusText };
}

function createTelemetryCard() {
  const card = document.createElement('div');
  card.className = 'tsla-latency__card tsla-latency__telemetry';
  const title = document.createElement('h3');
  title.className = 'tsla-latency__card-title';
  title.textContent = 'BLE Speed Mirror';
  const description = document.createElement('p');
  description.className = 'tsla-latency__description';
  description.textContent =
    'The BLE stack feeds this display using the same auto-refresh cycle as the dashboard.';

  const speedRow = document.createElement('div');
  speedRow.className = 'tsla-latency__speed-row';
  const speedValue = document.createElement('div');
  speedValue.className = 'tsla-latency__speed-value';
  speedValue.textContent = DEFAULT_SPEED_DISPLAY;
  const speedLabel = document.createElement('div');
  speedLabel.className = 'tsla-latency__speed-label';
  speedLabel.textContent = 'Vehicle speed (mph)';
  speedRow.append(speedValue, speedLabel);

  const secondaryRow = document.createElement('div');
  secondaryRow.className = 'tsla-latency__secondary-row';
  const gearLabel = document.createElement('div');
  gearLabel.className = 'tsla-latency__gear-label';
  gearLabel.textContent = 'Gear';
  const gearValue = document.createElement('div');
  gearValue.className = 'tsla-latency__gear-value';
  gearValue.textContent = DEFAULT_GEAR_DISPLAY;
  const refreshBadge = document.createElement('span');
  refreshBadge.className = 'tsla-latency__badge';
  refreshBadge.textContent = 'Auto refresh off';
  secondaryRow.append(gearLabel, gearValue, refreshBadge);

  card.append(title, description, speedRow, secondaryRow);
  return { element: card, speedValue, gearValue, refreshBadge };
}

function createLatencyButton(label: string, primary = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = primary ? 'tsla-latency__button tsla-latency__button--primary' : 'tsla-latency__button';
  button.textContent = label;
  return button;
}

function createVideoConstraints(facingMode: FacingMode): MediaTrackConstraints {
  return {
    facingMode: { ideal: facingMode },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  };
}

function isCameraSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

function extractDriveInsights(result: VehicleStateResult | null) {
  const driveState = result?.vehicleData?.driveState ?? result?.vehicleData?.drive_state ?? null;
  return {
    speed: parseVehicleSpeed(driveState),
    gear: parseShiftState(driveState?.shiftState ?? driveState?.shift_state),
  };
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

function parseShiftState(raw: any): string | null {
  if (!raw) {
    return null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return null;
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
    if (typeof raw.type === 'string') {
      return parseShiftState(raw.type);
    }
  }
  return null;
}

type StatusVariant = 'default' | 'success' | 'error';

function setStatus(target: HTMLElement, message: string, variant: StatusVariant): void {
  target.textContent = message;
  target.classList.remove('is-success', 'is-error');
  if (variant === 'success') {
    target.classList.add('is-success');
  } else if (variant === 'error') {
    target.classList.add('is-error');
  }
}

function formatMediaError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return 'Camera permission denied. Please allow access and try again.';
    }
    if (error.name === 'NotFoundError') {
      return 'Unable to find a camera that matches the requested facing mode.';
    }
    if (error.message) {
      return error.message;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Unable to start the camera preview.';
}
