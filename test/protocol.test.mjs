import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const require = createRequire(import.meta.url);
const { Root } = require('protobufjs');

const root = Root.fromJSON(
  JSON.parse(readFileSync(resolve(__dirname, '../src/lib/protos.json'), 'utf8')),
);
const ToVcsecMessage = root.lookupType('VCSEC.ToVCSECMessage');
const UnsignedMessage = root.lookupType('VCSEC.UnsignedMessage');

const protocolModulePromise = import('../dist-test/src/lib/protocol.js');

test('encodeVcsecAddKeyRequest encodes whitelist payload with raw key bytes', async () => {
  const { encodeVcsecAddKeyRequest } = await protocolModulePromise;
  const rawKey = Uint8Array.from({ length: 65 }, (_, idx) => (idx + 17) & 0xff);
  const payload = encodeVcsecAddKeyRequest({
    publicKeyRaw: rawKey,
    role: 3,
    formFactor: 7,
  });

  const envelope = ToVcsecMessage.decode(payload);
  assert.equal(envelope.signedMessage?.signatureType, 2, 'expected PRESENT_KEY signature type');

  const unsigned = UnsignedMessage.decode(envelope.signedMessage.protobufMessageAsBytes ?? new Uint8Array());
  const whitelistOp = unsigned.WhitelistOperation;
  assert.ok(whitelistOp, 'missing whitelist operation');
  const permissionChange = whitelistOp.addKeyToWhitelistAndAddPermissions;
  assert.ok(permissionChange, 'missing permission change payload');
  assert.equal(permissionChange.keyRole, 3);
  const encodedKey = permissionChange.key ?? {};
  const keyBytes = encodedKey.PublicKeyRaw ?? encodedKey.publicKeyRaw ?? [];
  const normalizedKey = keyBytes instanceof Uint8Array ? keyBytes : Uint8Array.from(keyBytes);
  assert.deepEqual(Array.from(normalizedKey), Array.from(rawKey), 'public key bytes mismatch');
  assert.equal(whitelistOp.metadataForKey?.keyFormFactor, 7);
});
