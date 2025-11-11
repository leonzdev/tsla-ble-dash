import test from 'node:test';
import assert from 'node:assert/strict';

const bluetoothModulePromise = import('../dist-test/src/lib/bluetooth.js');

function bufferSourceToArray(bufferSource) {
  if (bufferSource instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(bufferSource));
  }
  if (ArrayBuffer.isView(bufferSource)) {
    return Array.from(new Uint8Array(bufferSource.buffer, bufferSource.byteOffset, bufferSource.byteLength));
  }
  throw new TypeError('Unsupported buffer source');
}

function createDomException(message, name) {
  try {
    return new DOMException(message, name);
  } catch {
    const err = new Error(message);
    err.name = name;
    return err;
  }
}

test('TeslaBleTransport falls back to writeWithoutResponse when writeWithResponse is unsupported', async () => {
  const { TeslaBleTransport } = await bluetoothModulePromise;
  const transport = new TeslaBleTransport();
  const writes = [];
  let withResponseAttempts = 0;
  const characteristic = {
    properties: { write: false, writeWithoutResponse: true },
    async writeValueWithResponse(chunk) {
      withResponseAttempts += 1;
      throw createDomException('not supported', 'NotSupportedError');
    },
    async writeValueWithoutResponse(chunk) {
      writes.push(bufferSourceToArray(chunk));
    },
  };
  transport.txChar = characteristic;
  transport.writeMode = 'with-response';
  transport.blockLength = 64;

  await transport.send(new Uint8Array([1]));

  assert.equal(withResponseAttempts, 1);
  assert.equal(transport.writeMode, 'without-response');
  assert.deepEqual(writes, [[0, 1, 1]]);
});

test('TeslaBleTransport clamps block length to 20 bytes after DataError', async () => {
  const { TeslaBleTransport } = await bluetoothModulePromise;
  const transport = new TeslaBleTransport();
  const writes = [];
  let attempts = 0;
  const characteristic = {
    properties: { writeWithoutResponse: true },
    async writeValueWithoutResponse(chunk) {
      attempts += 1;
      if (attempts === 1) {
        throw createDomException('mtu exceeded', 'DataError');
      }
      writes.push(bufferSourceToArray(chunk));
    },
  };
  transport.txChar = characteristic;
  transport.writeMode = 'without-response';
  transport.blockLength = 64;

  await transport.send(new Uint8Array([1, 2, 3]));

  assert.equal(transport.blockLength, 20);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], [0, 3, 1, 2, 3]);
});
