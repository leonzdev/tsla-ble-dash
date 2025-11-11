import { copyFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const moduleFiles = [
  resolve(__dirname, '../dist-test/src/lib/crypto.js'),
  resolve(__dirname, '../dist-test/src/lib/bluetooth.js'),
];
const protosSrc = resolve(__dirname, '../src/lib/protos.json');
const protosDst = resolve(__dirname, '../dist-test/src/lib/protos.json');

for (const filePath of moduleFiles) {
  try {
    const source = readFileSync(filePath, 'utf8');
    const patched = source.replace(/from ['"]\.\/constants['"]/g, (match) => {
      return match.includes('"') ? 'from "./constants.js"' : "from './constants.js'";
    });
    if (patched !== source) {
      writeFileSync(filePath, patched);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Failed to patch generated module ${filePath}:`, error);
      process.exitCode = 1;
    }
  }
}

try {
  mkdirSync(dirname(protosDst), { recursive: true });
  copyFileSync(protosSrc, protosDst);
} catch (error) {
  console.error('Failed to copy protos.json for tests:', error);
  process.exitCode = 1;
}
