import {
  SpeedOcrAnalyzer,
  type SpeedOcrResult,
  pixelBufferFromImageData,
  createSpeedDigitCrop,
  type BoundingBox,
} from '../../lib/ocr';
import { SamSegmenter } from '../../lib/sam';

type FacingMode = 'environment' | 'user';
type StatusVariant = 'default' | 'success' | 'error';
type NormalizedRect = { x: number; y: number; width: number; height: number };

const SPEED_SAMPLE_REGION: NormalizedRect = { x: 0.3, y: 0.2, width: 0.4, height: 0.45 };
const SAMPLE_INTERVAL_DEFAULT = 1000;
const SAMPLE_INTERVAL_MIN = 250;
const SAMPLE_INTERVAL_MAX = 5000;

export interface LatencyPageController {
  key: 'latency';
  label: string;
  element: HTMLElement;
  onHide(): void;
}

export function createLatencyPage(): LatencyPageController {
  const page = document.createElement('section');
  page.className = 'tsla-page tsla-latency';

  const speedOcrAnalyzer = new SpeedOcrAnalyzer();

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
  const captureActions = document.createElement('div');
  captureActions.className = 'tsla-latency__actions tsla-latency__actions--stacked';
  const captureRow = document.createElement('div');
  captureRow.className = 'tsla-latency__actions';
  const sampleOnceButton = createLatencyButton('Sample Frame', true);
  const uploadButton = createLatencyButton('Upload Image');
  const uploadInput = document.createElement('input');
  uploadInput.type = 'file';
  uploadInput.accept = 'image/*';
  uploadInput.hidden = true;
  captureRow.append(sampleOnceButton, uploadButton);
  captureActions.append(captureRow);
  captureActions.append(uploadInput);

  const previewActions = document.createElement('div');
  previewActions.className = 'tsla-latency__actions';
  const previewButton = createLatencyButton('Start Preview', true);
  const flipButton = createLatencyButton('Use Front Camera');
  previewActions.append(previewButton, flipButton);
  previewCard.append(previewTitle, previewDescription, previewArea, captureActions, previewActions);

  const ocrCard = document.createElement('div');
  ocrCard.className = 'tsla-latency__card';
  const ocrTitle = document.createElement('h3');
  ocrTitle.className = 'tsla-latency__card-title';
  ocrTitle.textContent = 'Speed OCR';
  const ocrDescription = document.createElement('p');
  ocrDescription.className = 'tsla-latency__description';
  ocrDescription.textContent =
    'Capture a sample from the preview feed and run OCR to estimate the speed reported by the in-car display.';
  const ocrDisplay = document.createElement('div');
  ocrDisplay.className = 'tsla-latency__speed-readout';
  const ocrSpeedValue = document.createElement('div');
  ocrSpeedValue.className = 'tsla-latency__speed-value';
  ocrSpeedValue.textContent = '--';
  const ocrSpeedLabel = document.createElement('div');
  ocrSpeedLabel.className = 'tsla-latency__speed-label';
  ocrSpeedLabel.textContent = 'Detected speed';
  ocrDisplay.append(ocrSpeedValue, ocrSpeedLabel);
  const ocrConfidence = document.createElement('div');
  ocrConfidence.className = 'tsla-latency__caption';
  ocrConfidence.textContent = 'Confidence —';
  const ocrStatus = document.createElement('p');
  ocrStatus.className = 'tsla-latency__status';
  ocrStatus.textContent = 'Start the camera preview, then capture a sample frame.';
  const sampleWrapper = document.createElement('div');
  sampleWrapper.className = 'tsla-latency__sample-wrap';
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.className = 'tsla-latency__sample';
  sampleCanvas.hidden = true;
  const samplePlaceholder = document.createElement('div');
  samplePlaceholder.className = 'tsla-latency__sample-placeholder';
  samplePlaceholder.textContent = 'Sample crop will appear here after you capture a frame.';
  sampleWrapper.append(sampleCanvas, samplePlaceholder);
  const smartCropField = document.createElement('label');
  smartCropField.className = 'tsla-latency__switch';
  const smartCropCheckbox = document.createElement('input');
  smartCropCheckbox.type = 'checkbox';
  const smartCropLabel = document.createElement('span');
  smartCropLabel.textContent = 'Smart Crop (MobileSAM beta)';
  smartCropField.append(smartCropCheckbox, smartCropLabel);
  const smartCropStatus = document.createElement('div');
  smartCropStatus.className = 'tsla-latency__caption';
  smartCropStatus.textContent = 'Smart crop disabled.';
  const ocrActions = document.createElement('div');
  ocrActions.className = 'tsla-latency__actions';
  const autoSampleButton = createLatencyButton('Start Auto Sampling');
  const intervalField = document.createElement('label');
  intervalField.className = 'tsla-latency__inline-field';
  const intervalCaption = document.createElement('span');
  intervalCaption.textContent = 'Interval (ms)';
  const intervalInput = document.createElement('input');
  intervalInput.type = 'number';
  intervalInput.min = String(SAMPLE_INTERVAL_MIN);
  intervalInput.max = String(SAMPLE_INTERVAL_MAX);
  intervalInput.step = '250';
  intervalInput.value = String(SAMPLE_INTERVAL_DEFAULT);
  intervalField.append(intervalCaption, intervalInput);
  ocrActions.append(autoSampleButton, intervalField);
  const ocrRawOutput = document.createElement('pre');
  ocrRawOutput.className = 'tsla-latency__log';
  ocrRawOutput.textContent = 'OCR output will appear here.';
  ocrCard.append(
    ocrTitle,
    ocrDescription,
    ocrDisplay,
    ocrConfidence,
    ocrStatus,
    sampleWrapper,
    smartCropField,
    smartCropStatus,
    ocrActions,
    ocrRawOutput,
  );

  content.append(header, availabilityCard, previewCard, ocrCard);
  page.append(content);

  let currentStream: MediaStream | null = null;
  let currentFacingMode: FacingMode = 'environment';
  let isStartingPreview = false;
  let isSampling = false;
  let autoSampleHandle: number | null = null;
  let isOcrWarm = false;
  let smartCropEnabled = false;
  let samSegmenter: SamSegmenter | null = null;
  let samLoadingPromise: Promise<SamSegmenter> | null = null;

  const captureCanvas = document.createElement('canvas');
  const captureCtx = (() => {
    const context = captureCanvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to acquire 2D rendering context for latency sampling.');
    }
    return context;
  })();
  const sampleCtx = (() => {
    const context = sampleCanvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to acquire 2D rendering context for latency sampling.');
    }
    context.imageSmoothingEnabled = false;
    return context;
  })();

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

  sampleOnceButton.addEventListener('click', () => {
    void captureAndRecognize();
  });

  uploadButton.addEventListener('click', () => {
    uploadInput.click();
  });

  uploadInput.addEventListener('change', () => {
    const file = uploadInput.files?.[0];
    if (!file) {
      return;
    }
    void recognizeFromFile(file);
    uploadInput.value = '';
  });

  autoSampleButton.addEventListener('click', () => {
    if (autoSampleHandle !== null) {
      stopAutoSampling('Auto sampling stopped.');
    } else {
      startAutoSampling();
    }
  });

  smartCropCheckbox.addEventListener('change', () => {
    smartCropEnabled = smartCropCheckbox.checked;
    if (smartCropEnabled) {
      smartCropStatus.textContent = 'Loading MobileSAM (~28 MB)…';
      void ensureSamSegmenter()
        .then(() => {
          smartCropStatus.textContent = 'Smart crop ready.';
        })
        .catch((error) => {
          smartCropEnabled = false;
          smartCropCheckbox.checked = false;
          const message = formatError(error);
          smartCropStatus.textContent = `Smart crop failed: ${message}`;
        });
    } else {
      smartCropStatus.textContent = 'Smart crop disabled.';
    }
  });

  function startAutoSampling() {
    if (!ensurePreviewReady()) {
      setStatus(ocrStatus, 'Start the camera preview before enabling auto sampling.', 'error');
      return;
    }
    const interval = clampNumber(
      Number.parseInt(intervalInput.value, 10) || SAMPLE_INTERVAL_DEFAULT,
      SAMPLE_INTERVAL_MIN,
      SAMPLE_INTERVAL_MAX,
    );
    intervalInput.value = String(interval);
    autoSampleHandle = window.setInterval(() => {
      void captureAndRecognize({ silent: true });
    }, interval);
    autoSampleButton.classList.add('is-active');
    autoSampleButton.textContent = 'Stop Auto Sampling';
    setStatus(ocrStatus, `Sampling every ${interval} ms`, 'default');
  }

  function stopAutoSampling(message?: string) {
    if (autoSampleHandle === null) {
      return;
    }
    window.clearInterval(autoSampleHandle);
    autoSampleHandle = null;
    autoSampleButton.classList.remove('is-active');
    autoSampleButton.textContent = 'Start Auto Sampling';
    if (message) {
      setStatus(ocrStatus, message, 'default');
    }
  }

  async function captureAndRecognize(options: { silent?: boolean } = {}): Promise<void> {
    if (isSampling) {
      return;
    }
    if (!ensurePreviewReady()) {
      if (!options.silent) {
        setStatus(ocrStatus, 'Start the camera preview before sampling frames.', 'error');
      }
      stopAutoSampling();
      return;
    }
    const width = previewVideo.videoWidth;
    const height = previewVideo.videoHeight;
    captureCanvas.width = width;
    captureCanvas.height = height;
    captureCtx.drawImage(previewVideo, 0, 0, width, height);
    const frameData = captureCtx.getImageData(0, 0, width, height);
    const frameBuffer = pixelBufferFromImageData(frameData);
    const bitmapFactory = smartCropEnabled ? () => createImageBitmap(captureCanvas) : undefined;
    isSampling = true;
    setSamplingBusy(true);
    const result = await processFrame(frameBuffer, width, height, bitmapFactory);
    if (!result && !options.silent) {
      setStatus(ocrStatus, 'No digits detected in the sampled frame.', 'error');
    }
    isSampling = false;
    setSamplingBusy(false);
  }

  function ensurePreviewReady(): boolean {
    return Boolean(
      currentStream &&
        previewVideo.videoWidth > 0 &&
        previewVideo.videoHeight > 0 &&
        previewVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
    );
  }

  function getStaticRegion(width: number, height: number): BoundingBox {
    const regionWidth = Math.max(1, Math.round(width * SPEED_SAMPLE_REGION.width));
    const regionHeight = Math.max(1, Math.round(height * SPEED_SAMPLE_REGION.height));
    const regionX = clampNumber(Math.round(width * SPEED_SAMPLE_REGION.x), 0, width - regionWidth);
    const regionY = clampNumber(Math.round(height * SPEED_SAMPLE_REGION.y), 0, height - regionHeight);
    return { x: regionX, y: regionY, width: regionWidth, height: regionHeight };
  }

  function renderSampleBuffer(buffer: { width: number; height: number; data: Uint8ClampedArray }) {
    sampleCanvas.width = buffer.width;
    sampleCanvas.height = buffer.height;
    const imageData = new ImageData(new Uint8ClampedArray(buffer.data), buffer.width, buffer.height);
    sampleCtx.putImageData(imageData, 0, 0);
  }

  function setSamplingBusy(state: boolean) {
    sampleOnceButton.disabled = state;
    if (autoSampleHandle === null) {
      autoSampleButton.disabled = state;
    }
    uploadButton.disabled = state;
  }

  function updateOcrOutputs(result: SpeedOcrResult) {
    if (result.speed != null) {
      ocrSpeedValue.textContent = String(result.speed);
      setStatus(ocrStatus, `Speed updated (${result.speed}) at ${new Date(result.timestamp).toLocaleTimeString()}`, 'success');
    } else {
      ocrSpeedValue.textContent = '--';
      setStatus(ocrStatus, 'No digits detected in the sampled frame.', 'error');
    }
    ocrConfidence.textContent =
      result.confidence > 0 ? `Confidence ${result.confidence.toFixed(1)}%` : 'Confidence —';
    ocrRawOutput.textContent = result.text || '(no text detected)';
  }

  function updateSampleVisibility(hasSample: boolean) {
    sampleCanvas.hidden = !hasSample;
    samplePlaceholder.hidden = hasSample;
  }

  async function ensureSamSegmenter(): Promise<SamSegmenter> {
    if (samSegmenter) {
      return samSegmenter;
    }
    if (!samLoadingPromise) {
      const instance = new SamSegmenter();
      samLoadingPromise = instance.load().then(() => {
        samSegmenter = instance;
        return instance;
      });
    }
    return samLoadingPromise;
  }

  async function getSmartCandidates(
    bitmapFactory: () => Promise<ImageBitmap>,
    width: number,
    height: number,
  ): Promise<BoundingBox[]> {
    let bitmap: ImageBitmap | null = null;
    try {
      smartCropStatus.textContent = 'Running smart crop…';
      const segmenter = await ensureSamSegmenter();
      bitmap = await bitmapFactory();
      const boxes = await segmenter.segment(bitmap, width, height);
      bitmap.close();
      bitmap = null;
      if (!boxes.length) {
        smartCropStatus.textContent = 'Smart crop found no regions.';
      } else {
        smartCropStatus.textContent = `Smart crop found ${boxes.length} region(s).`;
      }
      return boxes;
    } catch (error) {
      const message = formatError(error);
      smartCropStatus.textContent = `Smart crop failed: ${message}`;
      console.error('Smart crop failed', error);
      return [];
    } finally {
      bitmap?.close();
    }
  }

  async function processFrame(
    frameBuffer: ReturnType<typeof pixelBufferFromImageData>,
    width: number,
    height: number,
    bitmapFactory?: () => Promise<ImageBitmap>,
  ): Promise<SpeedOcrResult | null> {
    const smartRegions =
      smartCropEnabled && bitmapFactory ? await getSmartCandidates(bitmapFactory, width, height) : [];
    const regions = dedupeRegions([...smartRegions, getStaticRegion(width, height)]);
    if (!regions.length) {
      return null;
    }
    for (let index = 0; index < regions.length; index += 1) {
      const region = regions[index];
      const crop = createSpeedDigitCrop(frameBuffer, { region });
      if (!crop) {
        continue;
      }
      renderSampleBuffer(crop);
      updateSampleVisibility(true);
      setStatus(ocrStatus, `Running OCR on region ${index + 1}/${regions.length}…`, 'default');
      try {
        const result = await speedOcrAnalyzer.recognize(sampleCanvas);
        isOcrWarm = true;
        updateOcrOutputs(result);
        if (result.speed != null) {
          setStatus(ocrStatus, `Speed updated (${result.speed}).`, 'success');
          return result;
        }
      } catch (error) {
        const message = formatError(error);
        setStatus(ocrStatus, `OCR failed:\n${message}`, 'error');
        console.error('Failed to run speed OCR', error);
      }
    }
    return null;
  }

  function dedupeRegions(regions: BoundingBox[]): BoundingBox[] {
    const seen = new Set<string>();
    const unique: BoundingBox[] = [];
    regions.forEach((region) => {
      const key = `${Math.round(region.x)}-${Math.round(region.y)}-${Math.round(region.width)}-${Math.round(
        region.height,
      )}`;
      if (!seen.has(key) && region.width > 0 && region.height > 0) {
        seen.add(key);
        unique.push(region);
      }
    });
    return unique;
  }

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
    stopAutoSampling('Auto sampling paused because the camera preview stopped.');
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
  updateSampleVisibility(false);

  async function recognizeFromFile(file: File): Promise<void> {
    let bitmap: ImageBitmap | null = null;
    try {
      isSampling = true;
      setStatus(ocrStatus, 'Loading image…', 'default');
      setSamplingBusy(true);
      bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Unable to process the uploaded image.');
      }
      ctx.drawImage(bitmap, 0, 0);
      const frameData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const frameBuffer = pixelBufferFromImageData(frameData);
      const capturedBitmap = bitmap;
      const result = await processFrame(frameBuffer, canvas.width, canvas.height, () =>
        Promise.resolve(capturedBitmap),
      );
      if (!result) {
        setStatus(ocrStatus, 'No digits detected in uploaded image.', 'error');
      }
    } catch (error) {
      const message = formatError(error);
      setStatus(ocrStatus, `OCR failed:\n${message}`, 'error');
      console.error('Failed to run OCR on uploaded image', error);
    } finally {
      bitmap?.close();
      isSampling = false;
      setSamplingBusy(false);
    }
  }

  return {
    key: 'latency',
    label: 'Latency',
    element: page,
    onHide() {
      stopAutoSampling('Auto sampling paused while the Latency tab is hidden.');
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

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
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

function formatError(error: unknown): string {
  if (error instanceof Error && error.stack) {
    return `${error.message}\n${error.stack}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
