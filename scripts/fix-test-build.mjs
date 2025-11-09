import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cryptoPath = resolve(__dirname, '../dist-test/src/lib/crypto.js');

try {
  const source = readFileSync(cryptoPath, 'utf8');
  const patched = source.replace(/from ['"]\.\/constants['"]/g, (match) => {
    return match.includes('"') ? 'from "./constants.js"' : "from './constants.js'";
  });
  if (patched !== source) {
    writeFileSync(cryptoPath, patched);
  }
} catch (error) {
  console.error('Failed to patch generated crypto module for tests:', error);
  process.exitCode = 1;
}
