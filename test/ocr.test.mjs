import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PNG } from 'pngjs';

const ocrModulePromise = import('../dist-test/src/lib/ocr.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_IMAGE_PATH = path.join(__dirname, 'assets/ocr-sample.png');
const FALLBACK_REGION = { x: 0.1, y: 0.1, width: 0.4, height: 0.4 };

test(
  'speed OCR detects primary speed from sample image',
  { timeout: 180_000 },
  async () => {
    const { SpeedOcrAnalyzer, createSpeedDigitCrop, createPixelBuffer } = await ocrModulePromise;
    const analyzer = new SpeedOcrAnalyzer();
    const ocrInput = await buildOcrInput(createSpeedDigitCrop, createPixelBuffer, SAMPLE_IMAGE_PATH);
    const result = await analyzer.recognize(ocrInput);
    await analyzer.terminate();
    assert.equal(result.speed, 40);
    assert.ok(result.confidence > 0, `confidence too low (${result.confidence})`);
  },
);

async function buildOcrInput(createSpeedDigitCrop, createPixelBuffer, filePath) {
  const buffer = await readFile(filePath);
  const png = PNG.sync.read(buffer);
  const rgba = Uint8ClampedArray.from(png.data);
  const pixelBuffer = createPixelBuffer(png.width, png.height, rgba);
  const fallbackRegion = toBoundingBox(png.width, png.height, FALLBACK_REGION);
  const cropBuffer = createSpeedDigitCrop(pixelBuffer, { fallbackRegion });
  if (!cropBuffer) {
    throw new Error('Failed to generate OCR crop for sample image.');
  }
  const output = new PNG({ width: cropBuffer.width, height: cropBuffer.height });
  output.data = Buffer.from(cropBuffer.data);
  return PNG.sync.write(output);
}

function toBoundingBox(width, height, rect) {
  const boxWidth = clamp(Math.round(width * rect.width), 1, width);
  const boxHeight = clamp(Math.round(height * rect.height), 1, height);
  const x = clamp(Math.round(width * rect.x), 0, width - boxWidth);
  const y = clamp(Math.round(height * rect.y), 0, height - boxHeight);
  return { x, y, width: boxWidth, height: boxHeight };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
