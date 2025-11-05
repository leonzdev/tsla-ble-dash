import { DEFAULT_TTL_SECONDS } from './constants';

export interface TeslaSessionKeys {
  sharedSecret: Uint8Array;
  aesKey: CryptoKey;
  aesKeyBytes: Uint8Array;
  sessionInfoKey: Uint8Array;
}

export async function generatePrivateKey(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveBits', 'deriveKey'],
  );
}

export async function importPrivateKeyPkcs8(pem: string): Promise<CryptoKey> {
  const raw = pemToArrayBuffer(pem);
  return crypto.subtle.importKey(
    'pkcs8',
    raw,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits', 'deriveKey'],
  );
}

export async function importPrivateKeyRaw(raw: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    raw,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits', 'deriveKey'],
  );
}

export async function exportPublicKeyRaw(key: CryptoKey): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(raw);
}

export async function exportPrivateKeyPkcs8(privateKey: CryptoKey): Promise<string> {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
  return arrayBufferToPem('PRIVATE KEY', new Uint8Array(pkcs8));
}

export async function exportPublicKeyFromPrivate(privateKey: CryptoKey): Promise<Uint8Array> {
  const jwk = await crypto.subtle.exportKey('jwk', privateKey);
  if (typeof jwk !== 'object' || !('x' in jwk) || !('y' in jwk) || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') {
    throw new Error('Unable to extract public key from private key');
  }
  const x = base64UrlToUint8(jwk.x);
  const y = base64UrlToUint8(jwk.y);
  const out = new Uint8Array(1 + x.length + y.length);
  out[0] = 0x04; // Uncompressed form indicator
  out.set(x, 1);
  out.set(y, 1 + x.length);
  return out;
}

export async function deriveSessionKeys(opts: {
  privateKey: CryptoKey;
  peerPublicKey: Uint8Array;
}): Promise<TeslaSessionKeys> {
  const { privateKey, peerPublicKey } = opts;
  const peer = await crypto.subtle.importKey(
    'raw',
    viewToArrayBuffer(peerPublicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = await crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: peer,
    },
    privateKey,
    256,
  );
  const sharedBytes = new Uint8Array(shared);

  const sha1 = new Uint8Array(await crypto.subtle.digest('SHA-1', viewToArrayBuffer(sharedBytes)));
  const aesKeyBytes = sha1.slice(0, 16);
  const aesKey = await crypto.subtle.importKey(
    'raw',
    aesKeyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
  const sessionInfoKey = await hmacSha256(aesKeyBytes, new TextEncoder().encode('session info'));

  return {
    sharedSecret: sharedBytes,
    aesKey,
    aesKeyBytes,
    sessionInfoKey,
  };
}

export async function encryptAesGcm(
  key: CryptoKey,
  iv: Uint8Array,
  plaintext: Uint8Array,
  additionalData?: Uint8Array,
): Promise<Uint8Array> {
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: viewToArrayBuffer(iv),
      additionalData: additionalData ? viewToArrayBuffer(additionalData) : undefined,
    },
    key,
    viewToArrayBuffer(plaintext),
  );
  return new Uint8Array(ciphertext);
}

export async function decryptAesGcm(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  additionalData?: Uint8Array,
): Promise<Uint8Array> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: viewToArrayBuffer(iv),
      additionalData: additionalData ? viewToArrayBuffer(additionalData) : undefined,
    },
    key,
    viewToArrayBuffer(ciphertext),
  );
  return new Uint8Array(plaintext);
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', viewToArrayBuffer(data));
  return new Uint8Array(digest);
}

export async function hmacSha256(keyBytes: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    viewToArrayBuffer(keyBytes),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, viewToArrayBuffer(message));
  return new Uint8Array(signature);
}

export async function verifyHmacSha256(
  keyBytes: Uint8Array,
  message: Uint8Array,
  expected: Uint8Array,
): Promise<boolean> {
  const actual = await hmacSha256(keyBytes, message);
  return timingSafeEqual(actual, expected);
}

export function randomBytes(length: number): Uint8Array {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return array;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export interface CommandMetadata {
  vin: string;
  epoch: Uint8Array;
  counter: number;
  expiresAt?: number;
}

export function encodeMetadata(metadata: CommandMetadata): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  chunks.push(new Uint8Array([metadata.counter & 0xff, (metadata.counter >> 8) & 0xff, (metadata.counter >> 16) & 0xff, (metadata.counter >> 24) & 0xff]));
  chunks.push(metadata.epoch);
  chunks.push(encoder.encode(metadata.vin));
  return concat(...chunks);
}

export function defaultExpiry(clockSeconds: number): number {
  return clockSeconds + DEFAULT_TTL_SECONDS;
}

export function concat(...arrays: Uint8Array[]): Uint8Array {
  const length = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const array of arrays) {
    out.set(array, offset);
    offset += array.length;
  }
  return out;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem.replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const raw = atob(cleaned);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes.buffer;
}

function viewToArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

function arrayBufferToPem(label: string, data: Uint8Array): string {
  let base64 = '';
  for (let i = 0; i < data.length; i += 1) {
    base64 += String.fromCharCode(data[i]);
  }
  const encoded = btoa(base64);
  const formatted = encoded.replace(/(.{64})/g, '$1\n');
  return `-----BEGIN ${label}-----\n${formatted}\n-----END ${label}-----`;
}

function base64UrlToUint8(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = normalized + (pad === 2 ? '==' : pad === 3 ? '=' : '');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
