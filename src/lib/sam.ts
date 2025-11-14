import * as ort from 'onnxruntime-web';

const ORT_WASM_PATH = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/';
ort.env.wasm.wasmPaths = {
  'ort-wasm.wasm': `${ORT_WASM_PATH}ort-wasm.wasm`,
  'ort-wasm-simd.wasm': `${ORT_WASM_PATH}ort-wasm-simd.wasm`,
  'ort-wasm-threaded.wasm': `${ORT_WASM_PATH}ort-wasm-threaded.wasm`,
  'ort-wasm-simd-threaded.wasm': `${ORT_WASM_PATH}ort-wasm-simd-threaded.wasm`,
};
ort.env.wasm.numThreads = 1;
import type { BoundingBox } from './ocr';

const SAM_ENCODER_URL = 'https://huggingface.co/spaces/Akbartus/projects/resolve/main/mobilesam.encoder.onnx';
const SAM_DECODER_URL =
  'https://cdn.jsdelivr.net/gh/akbartus/MobileSAM-in-the-Browser@main/models/mobilesam.decoder.quant.onnx';

const RESIZE_WIDTH = 1024;
const RESIZE_HEIGHT = 684;
const MASK_SIZE = 256;
const MAX_BOXES = 6;

interface SegmentResult {
  box: BoundingBox;
  score: number;
}

export class SamSegmenter {
  private encoderSession: ort.InferenceSession | null = null;
  private decoderSession: ort.InferenceSession | null = null;
  private loadingPromise: Promise<void> | null = null;

  async load(): Promise<void> {
    if (this.encoderSession && this.decoderSession) {
      return;
    }
    if (!this.loadingPromise) {
      this.loadingPromise = (async () => {
        this.encoderSession = await ort.InferenceSession.create(SAM_ENCODER_URL, {
          executionProviders: ['wasm'],
        });
        this.decoderSession = await ort.InferenceSession.create(SAM_DECODER_URL, {
          executionProviders: ['wasm'],
        });
      })();
    }
    await this.loadingPromise;
  }

  async segment(image: ImageBitmap, originalWidth: number, originalHeight: number): Promise<BoundingBox[]> {
    await this.load();
    if (!this.encoderSession || !this.decoderSession) {
      return [];
    }
    const canvas = document.createElement('canvas');
    canvas.width = RESIZE_WIDTH;
    canvas.height = RESIZE_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return [];
    }
    ctx.drawImage(image, 0, 0, RESIZE_WIDTH, RESIZE_HEIGHT);
    const imageData = ctx.getImageData(0, 0, RESIZE_WIDTH, RESIZE_HEIGHT);
    const inputTensor = imageDataToTensor(imageData);
    const feeds: Record<string, ort.Tensor> = {
      input_image: inputTensor,
    };
    const encoderOutput = await this.encoderSession.run(feeds);
    const imageEmbeddings = encoderOutput.image_embeddings;
    if (!imageEmbeddings) {
      return [];
    }
    const pointGrid = generatePointGrid(RESIZE_WIDTH, RESIZE_HEIGHT);
    const maskInput = new ort.Tensor('float32', new Float32Array(MASK_SIZE * MASK_SIZE), [1, 1, MASK_SIZE, MASK_SIZE]);
    const hasMask = new ort.Tensor('float32', new Float32Array([0]), [1]);
    const origSize = new ort.Tensor('float32', new Float32Array([RESIZE_HEIGHT, RESIZE_WIDTH]), [2]);
    const boxes: SegmentResult[] = [];
    for (const point of pointGrid) {
      const pointCoords = new ort.Tensor('float32', new Float32Array([point.x, point.y, 0, 0]), [1, 2, 2]);
      const pointLabels = new ort.Tensor('float32', new Float32Array([1, -1]), [1, 2]);
      const decoderFeeds = {
        image_embeddings: imageEmbeddings,
        point_coords: pointCoords,
        point_labels: pointLabels,
        mask_input: maskInput,
        has_mask_input: hasMask,
        orig_im_size: origSize,
      };
      try {
        const result = await this.decoderSession.run(decoderFeeds);
        const maskTensor = result.masks;
        if (!maskTensor) {
          continue;
        }
        const box = maskToBoundingBox(maskTensor, originalWidth, originalHeight);
        if (box) {
          boxes.push({
            box,
            score: box.width * box.height,
          });
        }
      } catch (error) {
        console.warn('SAM decoder failed', error);
      }
      if (boxes.length >= MAX_BOXES) {
        break;
      }
    }
    boxes.sort((a, b) => b.score - a.score);
    return boxes.map((entry) => entry.box);
  }
}

function imageDataToTensor(imageData: ImageData): ort.Tensor {
  const { width, height, data } = imageData;
  const size = width * height;
  const tensorData = new Float32Array(3 * size);
  for (let i = 0; i < size; i += 1) {
    const offset = i * 4;
    const pixelIndex = Math.floor(i);
    tensorData[pixelIndex] = data[offset];
    tensorData[size + pixelIndex] = data[offset + 1];
    tensorData[size * 2 + pixelIndex] = data[offset + 2];
  }
  return new ort.Tensor('float32', tensorData, [1, 3, height, width]);
}

function maskToBoundingBox(maskTensor: ort.Tensor, originalWidth: number, originalHeight: number): BoundingBox | null {
  const maskData = maskTensor.data as Float32Array;
  const dims = maskTensor.dims;
  const maskWidth = dims[dims.length - 1] ?? MASK_SIZE;
  const maskHeight = dims[dims.length - 2] ?? MASK_SIZE;
  let minX = maskWidth;
  let minY = maskHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < maskHeight; y += 1) {
    for (let x = 0; x < maskWidth; x += 1) {
      const value = maskData[y * maskWidth + x];
      if (value > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    return null;
  }
  const scaleX = originalWidth / maskWidth;
  const scaleY = originalHeight / maskHeight;
  const x = Math.max(0, Math.round(minX * scaleX));
  const y = Math.max(0, Math.round(minY * scaleY));
  const width = Math.min(originalWidth - x, Math.round((maxX - minX) * scaleX));
  const height = Math.min(originalHeight - y, Math.round((maxY - minY) * scaleY));
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
}

function generatePointGrid(width: number, height: number) {
  const cols = 4;
  const rows = 3;
  const results: Array<{ x: number; y: number }> = [];
  const verticalStart = height * 0.1;
  const verticalEnd = height * 0.65;
  for (let row = 0; row < rows; row += 1) {
    const y = verticalStart + (row / Math.max(1, rows - 1)) * (verticalEnd - verticalStart);
    for (let col = 0; col < cols; col += 1) {
      const x = (col / Math.max(1, cols - 1)) * width;
      results.push({ x, y });
    }
  }
  return results;
}
