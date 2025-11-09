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

export async function importPrivateKeyPem(pem: string): Promise<CryptoKey> {
  const { label, data } = decodePem(pem);
  let pkcs8: Uint8Array;
  if (label === 'PRIVATE KEY') {
    pkcs8 = data;
  } else if (label === 'EC PRIVATE KEY') {
    pkcs8 = ecPrivateKeyToPkcs8(data);
  } else {
    throw new Error(`Unsupported PEM block type: ${label}`);
  }
  return importPrivateKeyRaw(viewToArrayBuffer(pkcs8));
}

export const importPrivateKeyPkcs8 = importPrivateKeyPem;

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

export async function exportPrivateKeyPem(privateKey: CryptoKey): Promise<string> {
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey));
  const sec1 = pkcs8ToEcPrivateKey(pkcs8);
  return arrayBufferToPem('EC PRIVATE KEY', sec1);
}

export const exportPrivateKeyPkcs8 = exportPrivateKeyPem;

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

export async function exportPublicKeyPem(publicKey: CryptoKey): Promise<string> {
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', publicKey));
  return arrayBufferToPem('PUBLIC KEY', spki);
}

export async function exportPublicKeyPemFromPrivate(privateKey: CryptoKey): Promise<string> {
  const raw = await exportPublicKeyFromPrivate(privateKey);
  return publicKeyRawToPem(raw);
}

export async function publicKeyRawToPem(raw: Uint8Array): Promise<string> {
  const publicKey = await crypto.subtle.importKey(
    'raw',
    viewToArrayBuffer(raw),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
  return exportPublicKeyPem(publicKey);
}

export async function publicKeyPemToRaw(pem: string): Promise<Uint8Array> {
  const { label, data } = decodePem(pem);
  if (label !== 'PUBLIC KEY') {
    throw new Error(`Unsupported public key PEM block: ${label}`);
  }
  const publicKey = await crypto.subtle.importKey(
    'spki',
    viewToArrayBuffer(data),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
  return exportPublicKeyRaw(publicKey);
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

function decodePem(pem: string): { label: string; data: Uint8Array } {
  const match = pem.match(/-----BEGIN ([^-]+)-----([\s\S]*?)-----END \1-----/);
  if (!match) {
    throw new Error('Invalid PEM format');
  }
  const label = match[1].trim();
  const body = match[2].replace(/[^A-Za-z0-9+/=]/g, '');
  const raw = atob(body);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return { label, data: bytes };
}

function pkcs8ToEcPrivateKey(pkcs8: Uint8Array): Uint8Array {
  const root = decodeAsn1Element(pkcs8, 0);
  if (root.tag !== 0x30) {
    throw new Error('Invalid PKCS#8 structure');
  }
  let offset = root.contentStart;
  const version = decodeAsn1Element(pkcs8, offset);
  if (version.tag !== 0x02) {
    throw new Error('Invalid PKCS#8 version');
  }
  offset = version.contentEnd;
  const algorithm = decodeAsn1Element(pkcs8, offset);
  if (algorithm.tag !== 0x30) {
    throw new Error('Invalid PKCS#8 algorithm identifier');
  }
  offset = algorithm.contentEnd;
  const privateKey = decodeAsn1Element(pkcs8, offset);
  if (privateKey.tag !== 0x04) {
    throw new Error('Invalid PKCS#8 private key');
  }
  return pkcs8.slice(privateKey.contentStart, privateKey.contentEnd);
}

function ecPrivateKeyToPkcs8(sec1: Uint8Array): Uint8Array {
  const version = encodeAsn1(0x02, new Uint8Array([0x00]));
  const algorithm = encodeAsn1(
    0x30,
    concat(
      encodeAsn1(0x06, OID_EC_PUBLIC_KEY),
      encodeAsn1(0x06, OID_PRIME256V1),
    ),
  );
  const privateKey = encodeAsn1(0x04, sec1);
  return encodeAsn1(0x30, concat(version, algorithm, privateKey));
}

function viewToArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

function encodeAsn1(tag: number, content: Uint8Array): Uint8Array {
  const length = encodeAsn1Length(content.length);
  const out = new Uint8Array(1 + length.length + content.length);
  out[0] = tag;
  out.set(length, 1);
  out.set(content, 1 + length.length);
  return out;
}

function encodeAsn1Length(length: number): Uint8Array {
  if (length < 0x80) {
    return new Uint8Array([length]);
  }
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function decodeAsn1Element(bytes: Uint8Array, offset: number): {
  tag: number;
  length: number;
  headerLength: number;
  contentStart: number;
  contentEnd: number;
  totalLength: number;
} {
  if (offset >= bytes.length) {
    throw new Error('ASN.1 parse error: offset out of range');
  }
  const tag = bytes[offset];
  const { length, lengthBytes } = decodeAsn1Length(bytes, offset + 1);
  const headerLength = 1 + lengthBytes;
  const contentStart = offset + headerLength;
  const contentEnd = contentStart + length;
  if (contentEnd > bytes.length) {
    throw new Error('ASN.1 parse error: length out of range');
  }
  return {
    tag,
    length,
    headerLength,
    contentStart,
    contentEnd,
    totalLength: headerLength + length,
  };
}

function decodeAsn1Length(bytes: Uint8Array, offset: number): { length: number; lengthBytes: number } {
  if (offset >= bytes.length) {
    throw new Error('ASN.1 parse error: missing length');
  }
  const first = bytes[offset];
  if ((first & 0x80) === 0) {
    return { length: first, lengthBytes: 1 };
  }
  const count = first & 0x7f;
  if (count === 0) {
    throw new Error('ASN.1 parse error: indefinite length not supported');
  }
  if (offset + 1 + count > bytes.length) {
    throw new Error('ASN.1 parse error: truncated length');
  }
  let length = 0;
  for (let i = 0; i < count; i += 1) {
    length = (length << 8) | bytes[offset + 1 + i];
  }
  return { length, lengthBytes: 1 + count };
}

const OID_EC_PUBLIC_KEY = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]);
const OID_PRIME256V1 = new Uint8Array([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);

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
