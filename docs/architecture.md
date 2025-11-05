# Tesla BLE Browser Port - Architecture Notes

## Goals

- Provide a browser-compatible library exposing Tesla vehicle BLE primitives via the Web Bluetooth API.
- Support key management (import/generate), secure session negotiation, message encryption, and command routing modeled after teslamotors/vehicle-command.
- Ship a minimal PWA that uses the library to connect, establish a session, and dump raw vehicle state categories.

## High-Level Structure

```
./docs/architecture.md
./proto/                      # Protobuf definitions copied from reference repo
./src/
  lib/
    bluetooth.ts              # Web Bluetooth device discovery + GATT characteristic helpers
    crypto.ts                 # Key import/generation, ECDH, AES-GCM, counter management
    protocol.ts               # Protobufjs loaders + message builders, state enums, helpers
    session.ts                # TeslaBleSession orchestrating handshake + encrypted transport
    state.ts                  # Convenience APIs for GetState and state decoding
  app/
    ui.ts                     # DOM-driven UI wiring for minimal PWA
  main.ts                     # Entry point bootstrapping UI once DOM ready
./public/
  index.html
  manifest.webmanifest
  icons/
./package.json
```

- Library code (`src/lib/…`) is framework-agnostic and can be published as `@tsla/ble-core` style package later.
- UI code (`src/app/…`) depends only on browser APIs and the library.

## Session Lifecycle (Browser)

1. **Device Selection** – User triggers `navigator.bluetooth.requestDevice({ filters: [{ services: [TESLA_SERVICE_UUID] }] })`. Web Bluetooth requires user gesture; we cache `BluetoothDevice` for reconnect attempts.
2. **GATT Setup** – `TeslaBleSession.connect()` opens GATT server, obtains TX (`00000212-b2d1-43f0-9b88-960cebf8b91e`) and RX (`00000213-b2d1-43f0-9b88-960cebf8b91e`) characteristics, starts notifications, negotiates effective MTU based on browser (Chrome currently 517 max for WebUSB stack).
3. **Handshake** –
   - Load/import ECDH private key (P-256). Allow generation via WebCrypto, but note that resulting key must be enrolled via NFC before it can command a vehicle.
   - Send `SessionInfoRequest` containing public key & challenge (UUID) to domain(s) required for state queries (typically `DOMAIN_INFOTAINMENT`).
   - Receive `SessionInfo` payload, verify HMAC tag, derive AES-128-GCM key as per reference implementation (`SHA1(ECDH shared secret)` truncated → `K`, derive session info key, verify tag).
   - Cache session context (counters, epoch, clock skew) in `localStorage` (encrypted) to speed up reconnects.
4. **Encrypted Messaging** –
   - Wrap commands as `universal.RoutableMessage`, include metadata (domain, routing address, counters, TTL).
   - Encrypt using AES-GCM with derived key and per-message IV (12 bytes) + authentication tag appended.
   - Chunk payload to BLE block size (MTU - 3, default 244) and write to TX characteristic.
   - Reassemble responses from RX notifications using leading length prefix.
5. **State Retrieval** – Use `carserver.GetVehicleData` with specific `StateCategory`. Responses decoded and returned as typed objects.

## Key Management

- Support importing private key material exported by `tesla-keygen` (`SEC1` / `PKCS#8` PEM). Provide helper to parse PEM → `CryptoKey` via WebCrypto.
- Provide key export flow for generating new key: generate P-256 key pair, export public key as Tesla expected format (X9.62 uncompressed) for enrollment, allow user to download private key backup.
- Store references only if user opts-in; default require re-import each session for security.

## Web Bluetooth Constraints & Mitigations

- Requires user gesture to select device; cannot automatically scan like CLI. UI will keep VIN input to derive expected advertised name and validate selection.
- Background execution limited; rely on visibility state to pause/resume notifications.
- PWA offline mode limited because BLE requires active page; service worker only caches assets.

## Library API Sketch

```ts
export interface TeslaBleOptions {
  vin: string;
  domains?: UniversalMessage.Domain[];
  preferredMtu?: number;
}

export class TeslaBleSession {
  constructor(opts: TeslaBleOptions);
  connect(device?: BluetoothDevice): Promise<void>;
  ensureSession(key: CryptoKey, domains?: Domain[]): Promise<void>;
  sendCommand(payload: Uint8Array, opts?: SendOptions): Promise<Uint8Array>;
  getState(category: StateCategory): Promise<StateResponse>;
  disconnect(): Promise<void>;
}
```

- `sendCommand` automatically handles encryption, counters, and retries.
- `StateResponse` provides typed wrappers with raw protobuf accessible for advanced usage.

## PWA UI Flow

- Landing screen: fields for VIN, private key (file input/paste), buttons `Generate Key`, `Select Vehicle`, `Connect`, `Fetch State`.
- After connection + session, drop-down for state categories, results rendered as JSON.
- Provide log panel for debug events (connection status, errors).

## Future Enhancements

- Session cache encryption via WebCrypto "wrapped" key tied to `navigator.credentials.get` (WebAuthn) or passphrase.
- Progressive decode/render of state categories into friendly UI.
- Additional commands (lock/unlock, climate, trunk), VCSEC flows, key enrollment UI with NFC approval instructions.

## Known Unknowns

- Web Bluetooth MTU negotiation is browser-specific; we stub fallback to 186 unless `getPreferredPhy` available.
- Some Tesla BLE commands may rely on low-level features (e.g., precise timing) not exposed on Web Bluetooth; wrap with defensive error handling.
- Without actual vehicle, functional testing limited to protocol-level unit tests using captured fixtures.
