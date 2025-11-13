import { createWorker, PSM, type Worker, type WorkerOptions } from 'tesseract.js';

type ImageLike = Parameters<Worker['recognize']>[0];

const TESSERACT_VERSION = '6.0.1';
const TESSERACT_CORE_VERSION = '6.0.0';

const WORKER_PATH = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`;
const CORE_PATH = `https://cdn.jsdelivr.net/npm/tesseract.js-core@${TESSERACT_CORE_VERSION}/`;
const LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0/';
const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

const WORKER_OPTIONS: Partial<WorkerOptions> = IS_BROWSER
  ? {
      workerPath: WORKER_PATH,
      corePath: CORE_PATH,
      langPath: LANG_PATH,
    }
  : {
      langPath: LANG_PATH,
    };

const SPEED_MIN = 1;
const SPEED_MAX = 200;

const DEFAULT_THRESHOLD = 180;
const DEFAULT_MARGIN_RATIO = 0.12;
const DEFAULT_MIN_WIDTH = 400;
const DEFAULT_TARGET_WIDTH = 980;
const DEFAULT_MAX_SCALE = 6;

const DEFAULT_DETECTION_OPTIONS = {
  focusLeftRatio: 0.6,
  focusTopRatio: 0.5,
  thresholdBias: 0.55,
  searchRegion: { x: 0.05, y: 0.04, width: 0.35, height: 0.3 },
};

export interface SpeedOcrResult {
  /** Raw text returned by Tesseract. */
  text: string;
  /** Parsed numeric speed (in mph/kph depending on UI source), if detected. */
  speed: number | null;
  /** Confidence score reported by Tesseract (0-100). */
  confidence: number;
  /** Timestamp when the OCR pass finished. */
  timestamp: number;
}

export interface PixelBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DigitDetectionOptions {
  focusLeftRatio: number;
  focusTopRatio: number;
  thresholdBias: number;
  searchRegion: NormalizedRect;
}

export interface SpeedCropOptions {
  marginRatio?: number;
  threshold?: number;
  minWidth?: number;
  targetWidth?: number;
  maxScale?: number;
  region?: BoundingBox | null;
  fallbackRegion?: BoundingBox | null;
  detectionOptions?: Partial<DigitDetectionOptions>;
}

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class SpeedOcrAnalyzer {
  private workerPromise: Promise<Worker> | null = null;

  async recognize(source: ImageLike): Promise<SpeedOcrResult> {
    const worker = await this.getWorker();
    const result = await worker.recognize(source, { rotateAuto: true });
    const text = (result.data?.text ?? '').trim();
    const speed = extractSpeedValue(text);
    const confidence =
      typeof result.data?.confidence === 'number' && Number.isFinite(result.data.confidence)
        ? result.data.confidence
        : 0;
    return {
      text,
      speed,
      confidence,
      timestamp: Date.now(),
    };
  }

  async terminate(): Promise<void> {
    if (!this.workerPromise) {
      return;
    }
    const worker = await this.workerPromise;
    await worker.terminate();
    this.workerPromise = null;
  }

  private async getWorker(): Promise<Worker> {
    if (!this.workerPromise) {
      this.workerPromise = (async () => {
        const worker = await createWorker('eng', 1, WORKER_OPTIONS);
        await worker.setParameters({
          tessedit_char_whitelist: '0123456789',
          tessedit_pageseg_mode: PSM.SINGLE_LINE,
          classify_bln_numeric_mode: '1',
        });
        return worker;
      })();
    }
    return this.workerPromise;
  }
}

export function extractSpeedValue(text: string): number | null {
  if (!text) {
    return null;
  }
  const matches = text.replace(/[^0-9\s]/g, ' ').match(/\d{1,3}/g);
  if (!matches) {
    return null;
  }
  for (const token of matches) {
    const value = Number.parseInt(token, 10);
    if (Number.isFinite(value) && value >= SPEED_MIN && value <= SPEED_MAX) {
      return value;
    }
  }
  return null;
}

export function createPixelBuffer(
  width: number,
  height: number,
  data: Uint8ClampedArray | null = null,
): PixelBuffer {
  const requiredLength = width * height * 4;
  let bufferData: Uint8ClampedArray | null = data;
  if (bufferData && bufferData.length !== requiredLength) {
    bufferData = null;
  }
  return {
    width,
    height,
    data: bufferData ?? new Uint8ClampedArray(requiredLength),
  };
}

export function pixelBufferFromImageData(image: { width: number; height: number; data: Uint8ClampedArray }): PixelBuffer {
  return {
    width: image.width,
    height: image.height,
    data: image.data,
  };
}

export function detectDominantDigitRegion(
  buffer: PixelBuffer,
  options: Partial<DigitDetectionOptions> = {},
): BoundingBox | null {
  const config = { ...DEFAULT_DETECTION_OPTIONS, ...options };
  const { width, height, data } = buffer;
  const totalPixels = width * height;
  if (!totalPixels || data.length < totalPixels * 4) {
    return null;
  }
  const luminance = new Uint8Array(totalPixels);
  let min = 255;
  let max = 0;
  let sum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const value = Math.trunc(data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722);
    luminance[p] = value;
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
    sum += value;
  }
  const mean = sum / totalPixels;
  const threshold = clampNumber(min + (mean - min) * config.thresholdBias, min, mean);
  const searchRect = normalizedToBoundingBox(config.searchRegion, width, height);
  const projection = detectUsingProjections(buffer, luminance, searchRect, threshold);
  if (projection) {
    return projection;
  }
  return null;
}

export function createSpeedDigitCrop(
  buffer: PixelBuffer,
  options: SpeedCropOptions = {},
): PixelBuffer | null {
  const {
    marginRatio = DEFAULT_MARGIN_RATIO,
    threshold = DEFAULT_THRESHOLD,
    minWidth = DEFAULT_MIN_WIDTH,
    targetWidth = DEFAULT_TARGET_WIDTH,
    maxScale = DEFAULT_MAX_SCALE,
    region: regionOverride = null,
    fallbackRegion = null,
    detectionOptions = {},
  } = options;

  const detectedRegion = regionOverride ?? detectDominantDigitRegion(buffer, detectionOptions);
  const region = detectedRegion ?? fallbackRegion;
  if (!region) {
    return null;
  }
  const expanded = expandBoundingBox(region, buffer.width, buffer.height, marginRatio);
  const crop = extractRegion(buffer, expanded);
  applyBinaryThreshold(crop.data, threshold);
  const scale = determineScale(crop.width, minWidth, targetWidth, maxScale);
  if (scale > 1) {
    return scalePixelBuffer(crop, scale);
  }
  return crop;
}

export function applyBinaryThreshold(data: Uint8ClampedArray, _threshold: number): void {
  const pixelCount = data.length / 4;
  const luminance = new Float32Array(pixelCount);
  let min = 255;
  let max = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const value = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
    luminance[p] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const range = Math.max(1, max - min);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const normalized = (luminance[p] - min) / range;
    const value = Math.round(normalized * 255);
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
}

export function scalePixelBuffer(buffer: PixelBuffer, scale: number): PixelBuffer {
  const outputWidth = Math.max(1, Math.round(buffer.width * scale));
  const outputHeight = Math.max(1, Math.round(buffer.height * scale));
  const data = new Uint8ClampedArray(outputWidth * outputHeight * 4);
  for (let y = 0; y < outputHeight; y += 1) {
    const srcY = Math.min(buffer.height - 1, Math.floor(y / scale));
    for (let x = 0; x < outputWidth; x += 1) {
      const srcX = Math.min(buffer.width - 1, Math.floor(x / scale));
      const srcIdx = (srcY * buffer.width + srcX) * 4;
      const dstIdx = (y * outputWidth + x) * 4;
      data[dstIdx] = buffer.data[srcIdx];
      data[dstIdx + 1] = buffer.data[srcIdx + 1];
      data[dstIdx + 2] = buffer.data[srcIdx + 2];
      data[dstIdx + 3] = buffer.data[srcIdx + 3];
    }
  }
  return { width: outputWidth, height: outputHeight, data };
}

function expandBoundingBox(
  box: BoundingBox,
  width: number,
  height: number,
  marginRatio: number,
): BoundingBox {
  const marginX = Math.round(box.width * marginRatio);
  const marginY = Math.round(box.height * marginRatio);
  const x1 = clampNumber(box.x - marginX, 0, width - 1);
  const y1 = clampNumber(box.y - marginY, 0, height - 1);
  const x2 = clampNumber(box.x + box.width + marginX, x1 + 1, width);
  const y2 = clampNumber(box.y + box.height + marginY, y1 + 1, height);
  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
  };
}

function extractRegion(buffer: PixelBuffer, region: BoundingBox): PixelBuffer {
  const { width, height } = region;
  const data = new Uint8ClampedArray(width * height * 4);
  const sourceStride = buffer.width * 4;
  const destStride = width * 4;
  for (let row = 0; row < height; row += 1) {
    const srcOffset = ((region.y + row) * buffer.width + region.x) * 4;
    const destOffset = row * destStride;
    data.set(buffer.data.subarray(srcOffset, srcOffset + destStride), destOffset);
  }
  return { width, height, data };
}

function determineScale(
  currentWidth: number,
  minWidth: number,
  targetWidth: number,
  maxScale: number,
): number {
  let scale = 1;
  if (currentWidth < minWidth) {
    scale = Math.max(scale, Math.min(maxScale, Math.ceil(minWidth / currentWidth)));
  }
  if (currentWidth * scale < targetWidth) {
    scale = Math.max(scale, Math.min(maxScale, Math.ceil(targetWidth / currentWidth)));
  }
  return Math.max(1, Math.min(maxScale, scale));
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function detectUsingProjections(
  buffer: PixelBuffer,
  luminance: Uint8Array,
  region: BoundingBox,
  threshold: number,
): BoundingBox | null {
  const columnScores = new Float32Array(region.width);
  const rowScores = new Float32Array(region.height);
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const globalX = region.x + x;
      const globalY = region.y + y;
      const idx = globalY * buffer.width + globalX;
      const darkness = Math.max(0, threshold - luminance[idx]);
      if (darkness <= 0) {
        continue;
      }
      columnScores[x] += darkness;
      rowScores[y] += darkness;
    }
  }
  const xRange = findDominantRange(columnScores);
  const yRange = findDominantRange(rowScores);
  if (!xRange || !yRange) {
    return null;
  }
  const regionWidth = xRange.end - xRange.start + 1;
  const regionHeight = yRange.end - yRange.start + 1;
  const marginX = Math.max(4, Math.round(regionWidth * 0.4));
  const marginY = Math.max(4, Math.round(regionHeight * 0.6));
  const x1 = clampNumber(region.x + xRange.start - marginX, 0, buffer.width - 1);
  const y1 = clampNumber(region.y + yRange.start - marginY, 0, buffer.height - 1);
  const x2 = clampNumber(region.x + xRange.end + marginX, x1 + 1, buffer.width);
  const y2 = clampNumber(region.y + yRange.end + marginY, y1 + 1, buffer.height);
  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
  };
}

function findDominantRange(scores: Float32Array): { start: number; end: number } | null {
  let max = 0;
  let sum = 0;
  for (let i = 0; i < scores.length; i += 1) {
    const value = scores[i];
    sum += value;
    if (value > max) {
      max = value;
    }
  }
  if (max === 0) {
    return null;
  }
  const mean = sum / scores.length;
  const threshold = mean + (max - mean) * 0.35;
  let start = -1;
  let end = -1;
  for (let i = 0; i < scores.length; i += 1) {
    if (scores[i] >= threshold) {
      if (start === -1) {
        start = i;
      }
      end = i;
    }
  }
  if (start === -1 || end === -1) {
    const bestIndex = scores.findIndex((value) => value === max);
    if (bestIndex === -1) {
      return null;
    }
    return { start: bestIndex, end: bestIndex };
  }
  return { start, end };
}

function normalizedToBoundingBox(rect: NormalizedRect, width: number, height: number): BoundingBox {
  const boxWidth = clampNumber(Math.round(width * rect.width), 1, width);
  const boxHeight = clampNumber(Math.round(height * rect.height), 1, height);
  const x = clampNumber(Math.round(width * rect.x), 0, width - boxWidth);
  const y = clampNumber(Math.round(height * rect.y), 0, height - boxHeight);
  return { x, y, width: boxWidth, height: boxHeight };
}
