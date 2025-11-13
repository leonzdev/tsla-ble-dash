type FacingMode = 'environment' | 'user';
type StatusVariant = 'default' | 'success' | 'error';

export interface LatencyPageController {
  key: 'latency';
  label: string;
  element: HTMLElement;
  onHide(): void;
}

export function createLatencyPage(): LatencyPageController {
  const page = document.createElement('section');
  page.className = 'tsla-page tsla-latency';

  const content = document.createElement('div');
  content.className = 'tsla-latency__content';

  const header = document.createElement('div');
  header.className = 'tsla-latency__header';
  const title = document.createElement('h2');
  title.textContent = 'Latency Tools';
  const subtitle = document.createElement('p');
  subtitle.className = 'tsla-latency__description';
  subtitle.textContent =
    'Verify that your browser can access the device camera before running end-to-end latency experiments.';
  header.append(title, subtitle);

  const availabilityCard = document.createElement('div');
  availabilityCard.className = 'tsla-latency__card';
  const availabilityTitle = document.createElement('h3');
  availabilityTitle.className = 'tsla-latency__card-title';
  availabilityTitle.textContent = 'Camera Availability';
  const statusText = document.createElement('p');
  statusText.className = 'tsla-latency__status';
  statusText.textContent = 'Run the check below to confirm access to WebRTC camera APIs.';
  const availabilityActions = document.createElement('div');
  availabilityActions.className = 'tsla-latency__actions';
  const checkButton = createLatencyButton('Check Camera Support');
  availabilityActions.append(checkButton);
  availabilityCard.append(availabilityTitle, statusText, availabilityActions);

  const previewCard = document.createElement('div');
  previewCard.className = 'tsla-latency__card';
  const previewTitle = document.createElement('h3');
  previewTitle.className = 'tsla-latency__card-title';
  previewTitle.textContent = 'Camera Preview';
  const previewDescription = document.createElement('p');
  previewDescription.className = 'tsla-latency__description';
  previewDescription.textContent =
    'Start the preview and point the camera at your display to capture latency footage. Flip cameras to pick the main/back lens on phones.';
  const previewArea = document.createElement('div');
  previewArea.className = 'tsla-latency__preview';
  const previewVideo = document.createElement('video');
  previewVideo.className = 'tsla-latency__video';
  previewVideo.autoplay = true;
  previewVideo.playsInline = true;
  previewVideo.muted = true;
  previewVideo.controls = false;
  const previewPlaceholder = document.createElement('div');
  previewPlaceholder.className = 'tsla-latency__placeholder';
  previewPlaceholder.textContent = 'Camera preview will appear here after you start it.';
  previewArea.append(previewVideo, previewPlaceholder);
  const previewActions = document.createElement('div');
  previewActions.className = 'tsla-latency__actions';
  const previewButton = createLatencyButton('Start Preview', true);
  const flipButton = createLatencyButton('Use Front Camera');
  previewActions.append(previewButton, flipButton);
  previewCard.append(previewTitle, previewDescription, previewArea, previewActions);

  content.append(header, availabilityCard, previewCard);
  page.append(content);

  let currentStream: MediaStream | null = null;
  let currentFacingMode: FacingMode = 'environment';
  let isStartingPreview = false;

  checkButton.addEventListener('click', () => {
    if (isCameraSupported()) {
      setStatus(statusText, 'Camera API is available. Start the preview to verify permissions.', 'success');
    } else {
      setStatus(statusText, 'Camera API is not available in this browser/device.', 'error');
    }
    updatePreviewButton();
    updateFlipButton();
  });

  previewButton.addEventListener('click', () => {
    if (currentStream) {
      stopPreview('Camera preview stopped.');
      return;
    }
    void startPreview();
  });

  flipButton.addEventListener('click', () => {
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    updateFlipButton();
    if (currentStream) {
      void restartPreview();
    }
  });

  function isCameraSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  async function startPreview(): Promise<void> {
    if (!isCameraSupported()) {
      setStatus(statusText, 'Camera API is not available in this browser/device.', 'error');
      updatePreviewButton();
      updateFlipButton();
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
        statusText,
        'Camera stream active. Point it at your instrumented display to capture latency footage.',
        'success',
      );
    } catch (error) {
      releaseStream();
      setStatus(statusText, formatMediaError(error), 'error');
    } finally {
      isStartingPreview = false;
      updatePreviewButton();
    }
  }

  function stopPreview(message?: string): void {
    releaseStream();
    if (message) {
      setStatus(statusText, message, 'default');
    }
    updatePreviewButton();
  }

  async function restartPreview(): Promise<void> {
    stopPreview();
    await startPreview();
  }

  function assignStream(stream: MediaStream): void {
    releaseStream();
    currentStream = stream;
    previewVideo.srcObject = stream;
    updatePlaceholder();
    void previewVideo.play().catch(() => {});
  }

  function releaseStream(): void {
    if (currentStream) {
      currentStream.getTracks().forEach((track) => {
        track.stop();
      });
    }
    currentStream = null;
    previewVideo.srcObject = null;
    updatePlaceholder();
  }

  function updatePreviewButton(): void {
    if (!isCameraSupported()) {
      previewButton.disabled = true;
      previewButton.textContent = 'Camera Not Available';
      return;
    }
    if (isStartingPreview) {
      previewButton.disabled = true;
      previewButton.textContent = 'Starting…';
      return;
    }
    previewButton.disabled = false;
    previewButton.textContent = currentStream ? 'Stop Preview' : 'Start Preview';
  }

  function updateFlipButton(): void {
    flipButton.disabled = !isCameraSupported();
    flipButton.textContent = currentFacingMode === 'environment' ? 'Use Front Camera' : 'Use Rear Camera';
  }

  function updatePlaceholder(): void {
    previewPlaceholder.hidden = Boolean(currentStream);
  }

  updatePreviewButton();
  updateFlipButton();
  updatePlaceholder();

  return {
    key: 'latency',
    label: 'Latency',
    element: page,
    onHide() {
      if (currentStream) {
        stopPreview('Camera preview stopped while the Latency tab is hidden.');
      }
    },
  };
}

function createLatencyButton(label: string, primary = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = primary ? 'tsla-latency__button tsla-latency__button--primary' : 'tsla-latency__button';
  button.textContent = label;
  return button;
}

function createVideoConstraints(facingMode: FacingMode): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = {
    facingMode: { ideal: facingMode },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  };
  return constraints;
}

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
