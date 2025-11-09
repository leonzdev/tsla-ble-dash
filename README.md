# Tesla BLE Dashboard (Web)

This project experiments with running a subset of the Tesla BLE command stack inside a web browser / PWA. It ports the critical pieces of the [`teslamotors/vehicle-command`](https://github.com/teslamotors/vehicle-command) repository to TypeScript so that they can execute on top of the Web Bluetooth and Web Crypto APIs.

## Project Structure

- `src/lib/` – Core browser-compatible library covering BLE transport, cryptography, protobuf handling, and command/session orchestration.
- `src/app/ui.ts` – Minimal DOM-driven UI that wires the library into a simple dashboard.
- `proto/` – `.proto` files copied from the upstream Go repository. They are compiled into `src/lib/protos.json` via `protobufjs-cli`.
- `docs/architecture.md` – High-level architecture notes and future work ideas.

## Getting Started

```bash
# install dependencies (requires Node ≥ 18; this repo vendors Node 20.11.1 locally during the setup above)
npm install

# type-check
npm run lint

# start dev server
npm run dev

# build for production
npm run build
```

Open the dev server in a Chromium-based browser that supports Web Bluetooth (e.g. Chrome, Edge, Android Chrome, PWAs on desktop). Safari currently lacks the required APIs.

## Using the demo UI

1. **Generate or import a key**
   - Use the `Generate Key` button to create a P-256 ECDH key pair in the browser. The private key (SEC1 `EC PRIVATE KEY` PEM) matches the output of tools such as `openssl ecparam -genkey -name prime256v1 -noout`.
   - The public key is emitted as a PEM block (`PUBLIC KEY`), matching the format produced by `tesla-keygen`. You can enroll it directly from the dashboard via **Enroll Key**, or with external tooling (e.g. `tesla-control add-key-request`) before approving it over NFC.
   - Alternatively, paste an existing SEC1 `EC PRIVATE KEY` generated via `openssl` or exported by `tesla-keygen` into the textarea.
2. **Select a vehicle**
   - Enter your VIN and click `Select Vehicle`. A Web Bluetooth picker appears. Choose the entry whose local name matches the Tesla BLE pattern (`SXXXXXXXXXXXXXXXC`).
3. **Establish a session**
   - Click `Connect`. The app performs the BLE handshake, verifies the session info HMAC, derives the AES-GCM session keys, and caches session state for the page lifetime.
4. **Fetch state**
   - Pick a state category (charge, climate, closures, …) and click `Fetch State`. The raw `CarServer.VehicleData` protobuf is decrypted and rendered as JSON in the log panel.

## Implementation Notes

- **Protobufs** – The build uses `protobufjs-cli` to generate `src/lib/protos.json`, which is loaded at runtime. No code generation step is required beyond the `pbjs` invocation executed during setup.
- **Cryptography** – All crypto operations rely on `crypto.subtle`, following the protocol specification:
  - ECDH (P-256) to derive the shared secret.
  - SHA-1 to truncate the shared secret into a 128-bit AES-GCM key.
  - HMAC-SHA256 to authenticate session info and metadata.
  - AES-GCM with SHA-256(metadata) as AAD for command payloads and responses.
- **Metadata serialization** mirrors the TLV format (`Signatures.Tag`) used by the Go implementation.
- **Transport** – Web Bluetooth requires the user to explicitly choose the target device. The transport class handles the MTU-sized chunking required by the protocol and reassembles messages from the length-prefixed stream.

## Limitations & TODOs

- The implementation is based on documentation and code inspection; it has not been validated against a live vehicle. Expect adjustments once tested on real hardware.
- Web Bluetooth imposes UX constraints: manual device selection, no background execution, and platform-specific MTU limits.
- Session caching is in-memory only. A production PWA should persist an encrypted session cache in IndexedDB.
- Error handling is rudimentary; additional validation (e.g. counter rollovers, session refresh) should mirror the full Go dispatcher logic.
- Only the BLE + infotainment domain is implemented. VCSEC and Fleet API support would require more protobuf plumbing.
- UI is intentionally spartan. Future work could include richer state visualization, connection diagnostics, and key management workflows.

## Regenerating protobuf JSON

Whenever files in `proto/` change, regenerate the bundled definitions:

```bash
npx --yes protobufjs-cli pbjs \
  -t json \
  -p proto \
  -p node_modules/protobufjs \
  -o src/lib/protos.json \
  proto/universal_message.proto proto/signatures.proto proto/car_server.proto \
  proto/vehicle.proto proto/common.proto proto/managed_charging.proto \
  proto/vcsec.proto proto/keys.proto proto/errors.proto
```

## References

- Tesla Motors: [vehicle-command](https://github.com/teslamotors/vehicle-command)
- Tesla protocol specification: [`pkg/protocol/protocol.md`](https://github.com/teslamotors/vehicle-command/blob/main/pkg/protocol/protocol.md)
