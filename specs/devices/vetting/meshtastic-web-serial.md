---
origin: third-party
vetting: pending
subject: Meshtastic JavaScript client libraries for Web Serial docking (D-080 rule 3)
recorded: 2026-10-30
recorded-by: KhoaDD (agent run, Claude Opus 5.5)
decision-owner: KhoaDD (leader)
---

# Vetting record: Meshtastic client libraries for Web Serial docking

> Workflow: third-party vetting (inventory, findings, decision, apply plan, record). D-080 rule 3: a
> Meshtastic client library used for Web Serial passes this workflow before it enters `package.json`.
> Status `pending` until the leader rules on the recommendation in §4. Nothing was installed, built or
> run: package metadata was read with `npm view`, source was read from `github.com/meshtastic/web`
> (branch `main`, read 2026-10-30) and firmware facts from `treklink-firmware` at `f062a35`.

## 1. What the counter needs

Four things over one USB serial link to a TrekLink unit (`specs/devices/design.md` §8):

1. Read the unit's `myNodeNum`, its reported firmware version and its build environment.
2. Read the owner names and the primary channel, so the write can keep every other channel setting and
   the result can be read back.
3. Write the owner long and short names (the asset tag, D-080 rule 2).
4. Write the primary channel with the organization's channel key (D-021).

That is the serial framing, a config-only handshake, and four admin messages (`get_owner_request`,
`get_channel_request`, `set_owner`, `set_channel`) on `ADMIN_APP`.

## 2. Inventory

| Candidate | Version on npm | Last publish | Licence | Runtime dependencies | Unpacked size | Maintainers |
|---|---|---|---|---|---|---|
| `@meshtastic/core` | 2.6.7 | 2025-09-11 | GPL-3.0-only | `crc` | 536 791 B | sachaw, dandcodes |
| `@meshtastic/transport-web-serial` | 0.2.5 | 2025-09-11 | GPL-3.0-only | `@meshtastic/core` 2.6.7, `@types/w3c-web-serial` | 44 991 B | sachaw, dandcodes |
| `@meshtastic/js` (older single package) | 2.6.0-0 | 2025-07-08 | GPL-3.0-only | `crc`, `tslog`, `ste-simple-events`, `@bufbuild/protobuf`, `@meshtastic/protobufs` (JSR alias) | 279 239 B | sachaw |
| `@meshtastic/protobufs` | 2.8.0 | 2026-08-30 | `GPLV3` (as declared) | `@bufbuild/protobuf` | 872 277 B | sachaw, dandcodes |
| `@bufbuild/protobuf` | 2.16.0 | 2026-09-29 | Apache-2.0 AND BSD-3-Clause | none | 1 992 103 B | Buf (seven accounts) |

Upstream state, read from GitHub on 2026-10-30:

- `meshtastic/js` is **archived** (last push 2025-07-08). `@meshtastic/js` is a dead end.
- `meshtastic/web` (GPL-3.0, last push 2026-10-25) holds the packages now. `packages/sdk/package.json`
  names `@meshtastic/sdk` 1.0.0, "Replaces @meshtastic/core", and `packages/transport-web-serial` is at
  1.0.0 and depends on it. Neither 1.0.0 is on npm: `npm view @meshtastic/sdk` answers 404 and
  `@meshtastic/transport-web-serial@1.0.0` has no match. The packages publish to JSR as well; the JSR
  pages and `npm.jsr.io` were not reachable from this environment (a bot check and 403), so whether the
  1.0.0 line is on JSR is **unverified**.
- The npm line (`core` 2.6.7, `transport-web-serial` 0.2.5) has had no release for 13 months while the
  source it came from was rewritten.

What the libraries ship and do, from the source (`packages/sdk/src`, `packages/transport-web-serial/src`,
7 946 lines of TypeScript without tests):

| Item | Finding |
|---|---|
| Files installed | `dist/` bundles only; no install scripts in the published manifests (`preinstall` runs `only-allow pnpm` in the workspace, not in the package) |
| Hooks, prompt injection | Not applicable (a runtime library) |
| Network | None: no `fetch`, `XMLHttpRequest`, `WebSocket` or `sendBeacon` in the source |
| Persistence | None in `sdk` or the transport; `localStorage` is only read for a `mesh-debug` flag (`core/logging/logger.ts`) |
| Credentials | Holds the channels read from the unit, including the PSK, in its in-memory signal stores; an admin session passkey cache per node (`features/device/infrastructure/AdminSession.ts`) |
| Logging | `tslog` to the console; the sampled statements describe packets (port, node number), none sampled prints a payload |
| Web Serial connection | `navigator.serial.requestPort()`, `port.open({ baudRate: 115200 })` with four retries, wake bytes `0x94 0x94 0x94 0x94`, frames `0x94 0xC3` plus a 16-bit big-endian length, frames above 512 bytes treated as noise (`transport-web-serial/src/transport.ts`, `core/packet-codec/toDevice.ts`, `fromDevice.ts`) |
| Handshake | Two stages with the firmware's special nonces 69420 (config only) and 69421 (node database only) (`core/client/handshake.ts`) |
| `myNodeNum` | Dispatched by `onMyNodeInfo` from the `myInfo` frame (`core/packet-codec/decodePacket.ts`) |
| Owner names | `setOwner(user)` sends `AdminMessage.set_owner` (`shim/legacyMeshDevice.ts:198`) |
| Channel key | `setChannel(channel)` sends `AdminMessage.set_channel` with the whole `Channel` (`legacyMeshDevice.ts:202`) |
| Session passkey | Stamped on every admin write when cached, refreshed once on `ADMIN_BAD_SESSION_KEY` (`AdminMessageSender.ts`); needed for remote nodes only, see §3.2 |

## 3. Findings

### 3.1 Licence

Every Meshtastic JavaScript package, the protobuf stubs included, is GPL-3.0. Bundling one into the
frontend makes the served bundle a combined work under GPL-3.0, so TrekLink would have to offer the
frontend's source under the same licence to everyone it serves the page to. `treklink-web` declares no
licence (no `LICENSE` file, no `license` field), and D-046 treats TrekLink's own software as licensed and
non-redistributable. That is a licensing decision for the leader, not a technical one, and no library is
worth taking it implicitly. Code generated from the GPL `.proto` files carries the same question.
(inferred, not legal advice) Protobuf field numbers and the frame header are the wire interface the
firmware already publishes; writing an encoder from them is reimplementing an interface, which is the
route that avoids copying the libraries' expression.

`@bufbuild/protobuf` is Apache-2.0 and BSD-3-Clause, compatible with any licence choice.

### 3.2 Admin authorization on our firmware (2.7.19)

The fork is Meshtastic 2.7.19 (`treklink-firmware/version.properties`). A client on the serial port
needs **no session passkey and no admin key**:

- `MeshService::handleToRadio` sets `p.from = 0` on every packet a client sends
  (`src/mesh/MeshService.cpp:186`).
- `AdminModule::handleReceivedProtobuf` accepts a payload with `from == 0` unless
  `config.security.is_managed` is set (`src/modules/AdminModule.cpp:85-89`), and checks the session
  passkey only when `mp.from != 0` (`:132-138`). TrekLink sets neither `is_managed` nor `admin_key`.
- The serial API runs only while `config.security.serial_enabled` (`src/SerialConsole.cpp:129`), which
  defaults to true (`src/mesh/NodeDB.cpp:669`).
- `handleSetOwner` and `handleSetChannel` save without a reboot (`AdminModule.cpp:594-626`,
  `:1015-1022`, `saveChanges(SEGMENT_CHANNELS, false)`), and `handleGetChannel` returns the channel with
  its PSK to the local client (`:1323-1336`), so the counter can read back what it wrote.

The libraries' passkey machinery is therefore unused on this path.

### 3.3 Firmware blocker that no library removes

The stock v2 image answers nothing on its USB port: the v2 env uses board `esp32-s3-devkitc-1` without
`ARDUINO_USB_CDC_ON_BOOT`, so `Serial` is UART0 on GPIO 43/44 (`04-firmware-ground-truth.md` §5, measured
2026-10-29). `variants/esp32s3/treklink_v2_0/platformio.ini:19-28` has no `-DARDUINO_USB_CDC_ON_BOOT=1`.
v3 (USB to UART bridge) and v4 (`boards/tbeam-s3-core.json:10` sets the flag) are not affected. Docking a
v2 needs that build flag in the v2 env (no source change), a flash of every v2 unit and a hardware run
under D-077.

### 3.4 Fit and cost

- The counter uses four admin messages and one handshake. `core` brings chat, nodes, telemetry, position,
  traceroute, files, XMODEM, a heartbeat service and the full protobuf set; the npm `core` is 537 KB
  unpacked before tree-shaking. The bundle impact was not measured (nothing was installed).
- Adopting the npm line means a package its maintainers have replaced; adopting the 1.0.0 line means a
  package not on npm, with a JSR availability we could not confirm, still changing (four `fix(sdk)`
  commits on 2026-10-18).
- The libraries hold the unit's PSKs in long-lived reactive stores. REQ-UBI-03 and the counter rule
  "nothing stored in the browser" are easier to show with a small client that keeps the key in one local
  variable for the length of one write.

### 3.5 What an in-house client costs

Framing, a varint and length-delimited protobuf codec for the subset of §1, a Web Serial link and the
docking flow: about 450 lines of TypeScript plus tests (estimate, design §8.7). Field numbers come from
the firmware's generated headers (`src/mesh/generated/meshtastic/*.pb.h`, design §8.2), which match the
unit we flash. `@bufbuild/protobuf/wire` (`BinaryReader`, `BinaryWriter`) would replace the hand-written
varint code with a maintained, permissively licensed one, at the cost of one more dependency; the subset
is small enough that zero dependencies is the simpler choice.

## 4. Decision (leader approval gate)

| Candidate | Recommendation | Reason |
|---|---|---|
| `@meshtastic/core` with `@meshtastic/transport-web-serial` | **Reject** | GPL-3.0 in the frontend bundle without a licence ruling; npm line abandoned by upstream; far larger than the need |
| `@meshtastic/js` | **Reject** | Repository archived |
| `@meshtastic/protobufs` with generated code | **Reject** | GPL-3.0; 872 KB for nine messages |
| `@bufbuild/protobuf` | **Not needed**; acceptable if the leader prefers a maintained codec | Apache-2.0, maintained, no dependencies |
| The practices above (framing, wake bytes, 115200 baud, config-only nonce 69420, 512-byte frame cap, PSK kept for one write) | **Extract and re-author** | Written fresh as `frontend/src/shared/lib/meshtastic/`, in-house code, no vetting fields needed |

**Recommendation: extract and re-author, add no dependency.** If the leader instead rules that
`treklink-web` is GPL-3.0, adopting `@meshtastic/core` and `@meshtastic/transport-web-serial` 0.2.5 is
technically workable for the four calls, and this record is updated to `passed` for those two packages
only.

## 5. Apply plan (after approval)

- Add: `frontend/src/shared/lib/meshtastic/` (framing, codec, serial link) and
  `frontend/src/features/dock-device/` (docking service and hook), with tests, per `design.md` §8.
- Change: none in `package.json` and none in either lock file.
- Remove: nothing.
- Backup and rollback: the work lands on its own branch and pull request; reverting the PR removes it.
- Record: re-authored code carries no `origin` front matter. This file moves to `vetting: passed` with
  the decision date if a package is adopted, or stays as the record of the rejection with
  `vetting: rejected` for the rejected packages once the leader rules.
