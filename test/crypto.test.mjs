import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';

const cryptoModulePromise = import('../dist-test/src/lib/crypto.js');

const PRIVATE_KEY_PEM = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEINZdhJ6HWfr6w7oaAhTQp6eVJg1rjfNZodqORXnmdQfQoAoGCCqGSM49
AwEHoUQDQgAE6/aarL1fdQ1SiyvYrz43+Eb+uTf10/q8vf0h5CF+dCcdHJmDKXIR
cOhrPlskRYLvzW8cqZ/oMJ1uObFWSMJU/Q==
-----END EC PRIVATE KEY-----`;

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE6/aarL1fdQ1SiyvYrz43+Eb+uTf1
0/q8vf0h5CF+dCcdHJmDKXIRcOhrPlskRYLvzW8cqZ/oMJ1uObFWSMJU/Q==
-----END PUBLIC KEY-----`;

function normalizePem(value) {
  return value.trim().replace(/\r\n/g, '\n');
}

test('public key PEM derived from private key matches known reference', async () => {
  const { importPrivateKeyPem, exportPublicKeyPemFromPrivate } = await cryptoModulePromise;
  const privateKey = await importPrivateKeyPem(PRIVATE_KEY_PEM);
  const derivedPem = await exportPublicKeyPemFromPrivate(privateKey);
  assert.equal(normalizePem(derivedPem), normalizePem(PUBLIC_KEY_PEM));
});

test('public key PEM converts to raw bytes compatible with derived public key', async () => {
  const { importPrivateKeyPem, exportPublicKeyFromPrivate, publicKeyPemToRaw } = await cryptoModulePromise;
  const privateKey = await importPrivateKeyPem(PRIVATE_KEY_PEM);
  const rawFromPrivate = await exportPublicKeyFromPrivate(privateKey);
  const rawFromPem = await publicKeyPemToRaw(PUBLIC_KEY_PEM);
  assert.deepEqual(Buffer.from(rawFromPem), Buffer.from(rawFromPrivate));
});

test('raw public key can round-trip back to PEM', async () => {
  const { publicKeyPemToRaw, publicKeyRawToPem } = await cryptoModulePromise;
  const raw = await publicKeyPemToRaw(PUBLIC_KEY_PEM);
  const pem = await publicKeyRawToPem(raw);
  assert.equal(normalizePem(pem), normalizePem(PUBLIC_KEY_PEM));
});
