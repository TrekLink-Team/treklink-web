# Requirements Specification: gateway-sync

**User Story**: As a **Staff member coordinating an active trek**, I want field events from TrekLink mesh nodes to reach the platform exactly once and in priority order, so that an SOS raises exactly one Incident I can act on, and no position or telemetry reading is silently lost.
**Story ID**: US-101 | **Story Points**: 13 | **Priority**: High | **Sprint/Milestone**: TP1–TP2 (Wk 1–6)

> **Authority**: written against **D-005** (staged topology), **D-006** (split `eventId`), **D-007** (canonical envelope + Strategy normalizer) in `treklink-docs/_docs/00-project-context/03-decisions-and-risk-register.md`. Where this document and `01-conventions/04-architecture-conventions.md` §3 disagree on the `eventId` formula, **D-006 wins**. §3 was brought in line in Session 3 and the risk row is closed; the sentence is kept so an old copy of §3 is recognised as stale.

---

## 1. Domain Context & Scope

`gateway-sync` is the ingestion boundary between the LoRa mesh and the platform. It terminates the transport, normalizes heterogeneous Meshtastic packets into one internal event type, enforces idempotency, persists an immutable event ledger, and hands correlated SOS episodes to `incidents`.

### Staging (D-005, retopologized by **D-018**)

| Stage | Where the buffer lives | Ingress | Buffering | Status |
|---|---|---|---|---|
| **A** | nowhere | Guide's node publishes JSON to Mosquitto over its own Wi-Fi | the stock 16-entry RAM FIFO, i.e. **effectively none** | **Exists, pure configuration** |
| **B** | **on the device (firmware)** | unchanged, same topics, same payloads | priority-ordered, flash-backed, reboot-proof | **Built now.** Spec: [`treklink-firmware/specs/onboard-queue/`](../../../treklink-firmware/specs/onboard-queue/requirements.md) |
| **C** | basecamp gateway (laptop/phone) | node tethered via serial or BLE; browser-first per **D-020** | the large central queue, aggregating the local mesh | Specified, deferred until after B |

> ⚠️ **Renaming notice (D-018).** What earlier revisions of this document called *"Stage B, the basecamp bridge with the SQLite queue"* is **now Stage C**. Stage B is the new on-device queue. Every requirement below previously tagged `[B]` for the basecamp bridge has been **retagged `[C]`**; `[B]` now means the firmware queue. Do not reconcile this file against a pre-Session-7 copy.

Requirements below are tagged `[A]`, `[B]`, `[C]`, or untagged (all stages).

**What Stage B changes for this module: almost nothing, deliberately.** Per **D-019 §3** the device keeps publishing the same `ServiceEnvelope` on the same `<root>/2/e/…` and `<root>/2/json/…` topics. The queue changes *which event arrives next and whether it survived a reboot*, never what it looks like on the wire. The normalizer, the `eventId` derivation and the ingestion transaction are all untouched. The module's only new obligation is to consume the on-device queue-health report (REQ-EVT-12).

> **Do not assume the device's tier reaches the backend.** The on-device classification exists to order the *flush*; it is internal queue state and is deliberately **not** put on the wire, because doing so would change the payload and violate D-019 §3. The JSON envelope still omits `MeshPacket.priority` (D-007), so REQ-EVT-08's backward-grace-window inference stays exactly as it is. What Stage B improves is **which events survive and in what order they arrive**, not what the backend can read from any single one of them.

- **In-Scope**:
  - MQTT subscription, JSON envelope decoding, and mesh-packet normalization `[A]`
  - Canonical `TrekLinkEvent` contract and the PortNum Strategy registry
  - `eventId` derivation and transactional idempotency enforcement
  - `GatewayEvent` ledger (accepted payloads) and `SyncAuditLog` (every attempt, including rejects)
  - SOS detection, episode correlation, and Incident hand-off
  - Device current-state projection (`lastSeenAt`, `batteryPct`, latest position)
  - Gateway/node liveness and health reporting
  - Consuming the on-device queue-health report and deriving a **buffering** device state `[B]`
  - Serial frame ingestion and SQLite priority queue flush `[C]`
- **Out-of-Scope**:
  - The Incident 5-state FSM itself, owned by `incidents`; this module only creates/appends
  - WebSocket fan-out to browsers, owned by `monitoring`; this module emits an in-process domain event
  - Firmware *redesign* (charter §2 "Explicitly out of scope"). **Note the change**: per **D-008** the firmware is editable this term, so targeted firmware fixes are available and are tracked in the risk register, but they are out of scope *for this module's spec*, which is written to work against firmware as it stands today. Where a firmware fix would supersede a platform-side mitigation here, it is called out inline.
  - **Mesh-range packet loss.** A node out of LoRa range of any relay drops packets at source. Not solvable at this layer and not claimed, see D-005 scoping note.
  - Downlink (cloud → node) command-and-control
  - Meshtastic channel decryption, avoided by `encryption_enabled = false` (D-007, reaffirmed by **D-021**). Note that the *LoRa channel* PSK is a separate switch: it currently uses Meshtastic's published default key, and provisioning a custom per-fleet PSK is owned by `specs/devices/`, not here.
- **Depends on**: `devices` (node-number to Device resolution and the current-state projection, exported `DevicesService`); `incidents` (episode lookup, creation, append, reopen and suspected episodes, exported `IncidentsService`). Both via NestJS DI per `04-architecture-conventions.md` §1.1, never a direct Prisma query on their tables. *(This revision moves the episode lookup out of this module; see `design.md` §2.4.)*

### Traceability

| Group | MF | UC | FR | BR | Exception | Story |
|---|---|---|---|---|---|---|
| Ingest, normalise, dedup | MF-02 | UC-13 | FR-EVT-01 | BR-06 | E02-2, E02-4 | US-042, US-050, US-052 |
| Priority tiers and flush order | MF-02 | UC-13 | FR-EVT-03 | BR-07 | E02-1, E02-5, E02-6 | US-043, US-044, US-048 |
| Episode correlation | MF-02, MF-03 | UC-13 | FR-EVT-05 | BR-08 | E03-2, E03-5, E03-6 | US-057 |
| Suspected episode | MF-03 | UC-13 | FR-EVT-06 | BR-09 | E03-1 | US-088 |
| Sync audit log | MF-02 | UC-20 | FR-EVT-07 (new) | | | US-051 |
| Gateway health, buffering | MF-02, MF-04 | UC-14 | FR-EVT-08 (new) | BR-15 | E04-1, E04-2 | US-049, US-065 |
| Position plausibility | MF-04 | | FR-MON-05 | BR-16 | E04-4 | none |
| Stage C bridge | MF-02 | UC-13 | FR-EVT-03 | BR-07 | E02-3 | US-041, US-045, US-046, US-047 |

### Firmware ground truth (verified by inspection)

Inspection results from `treklink-firmware`, not assumptions. Full reference with all citations: [`treklink-docs/_docs/00-project-context/04-firmware-ground-truth.md`](../../../treklink-docs/_docs/00-project-context/04-firmware-ground-truth.md).

> **Per D-008 the firmware is editable this term.** These facts describe firmware *as it stands today*, which is what this spec is written against. Several of them are fixable at source and are logged as firmware-fix candidates in the risk register, but none of the requirements below depend on a firmware change landing.

| Fact | Evidence |
|---|---|
| No custom PortNum exists. SOS rides stock `TEXT_MESSAGE_APP` (1) and `POSITION_APP` (3). | `portnums.pb.h`, zero TrekLink entries |
| One SOS trigger emits **two independent packets**, position first, then text | `TrekLinkSOSHelper.cpp:41–48` |
| SOS is discriminated by an **ASCII prefix on the text body** | `TrekLinkSOSHelper.cpp:146` |
| Three text forms exist: `"SOS - [lat], [lon]"`, `"SOS - FALL DETECTED - [lat], [lon]"`, `"SOS - [No GPS]"` | `TrekLinkSOSHelper.cpp:146,148`; `FallDetectionModule.cpp:145` |
| The SOS text is sent **once**, `want_ack = false`. Beacons thereafter are **position-only**. | `TrekLinkSOSHelper.cpp:157–160`; `tickBeacon` → `broadcastPosition()` |
| Beacon cadence: 5s for the first 60s, then 30s, indefinitely until cancelled or battery death | `TrekLinkSOSHelper.cpp:181` |
| `MeshPacket.id` is a 10-bit rolling counter + 22 random bits, re-seeded at boot. Not a sequence. | `Router.cpp:168` |
| No `sessionId` or `sequenceNumber` exists anywhere | grep across `src/modules/TrekLink*`, `src/mesh/` |
| `TREKLINK_MSG_SOS 0x01` / `TREKLINK_MSG_FALL 0x02` are declared in three headers and **referenced nowhere**, dead constants, not wire discriminators | `TrekLinkSOSHelper.h:23–27`, `TrekLinkButtonModule.h:43–44`, `FallDetectionModule.h:13–14` |
| `treklink_v1_0` compiles MQTT out entirely | `variants/esp32/treklink_v1_0/platformio.ini:10` |
| **(S7)** The node's outbound MQTT queue is **16 entries, RAM-only, strict FIFO, and discards the OLDEST on overflow**, so an SOS text frame is evicted before telemetry, ~80 s into an outage | `MQTT.h:27`, `MQTT.cpp:821–823`, `PointerQueue.h:8` |
| **(S7)** That queue drains **one entry per 200 ms tick**, and reconnect is attempted every 30 s | `MQTT.cpp:699–709`, `:619`, `:621` |
| **(S7)** `MessageStore` is an existing flash-backed bounded queue on these boards, the precedent the Stage B queue follows | `MessageStore.cpp:244`, `:287`; `Power.cpp:810` |
| **(S7)** The default LoRa channel PSK is **Meshtastic's published default key**, so RF traffic is encrypted but not confidential | `Channels.cpp:128–134`, `:238` |

---

## 2. EARS Functional Criteria

### Ubiquitous (always active)

- **REQ-UBI-01**: The system SHALL record UTC `createdAt` on every `GatewayEvent` and `SyncAuditLog` row.
- **REQ-UBI-02**: The system SHALL distinguish `observedAt` (the payload `timestamp`, device-reported `rx_time`, untrusted) from `receivedAt` (backend wall clock, trusted) on every event, and SHALL derive `eventTime = observedAt` when it is present and not flagged `CLOCK_SKEW`, else `receivedAt`. Map trails, cadence detection and the episode window SHALL use `eventTime`; the arrival order SHALL NOT be used. *(Changed per O-001 fact 3: in direct Wi-Fi mode stock firmware drains one queued entry per reconnect (`MQTT.cpp:604-636`, `:699-710`), so a backlog arrives slowly and out of real time. An earlier revision ordered by `receivedAt`, which would have stretched one five-second beacon run over many minutes and could split one episode into two Incidents.)*
- **REQ-UBI-03**: The system SHALL treat `GatewayEvent` as append-only. No update or delete path may exist, per `04-architecture-conventions.md` §2 (no hard deletes on audit-relevant records).
- **REQ-UBI-04**: The system SHALL persist the decoded payload verbatim alongside every accepted event, so that a normalization defect can be re-processed from stored data without re-collecting from the field.
- **REQ-UBI-05**: The system SHALL derive the packet idempotency key as `eventId = sha256(nodeNum : packetId)` (D-006) and SHALL NOT depend on `sessionId` or `sequenceNumber`, neither of which the firmware transmits.
- **REQ-UBI-06**: The system SHALL resolve exactly one `PacketNormalizationStrategy` per PortNum from the injected registry, and SHALL contain no PortNum-conditional branching outside a strategy (D-007).
- **REQ-UBI-09**: The system SHALL classify an SOS only by the `"SOS - "` text prefix (fall prefix first) and SHALL NOT infer an SOS from `MeshPacket.priority` or any priority field. *(O-001 fact 2: the uplink node also forwards peer packets it hears (`Router.cpp:767-769`), so a peer's SOS reaches the broker as a `HIGH` priority text frame, not `MAX`.)*
- **REQ-UBI-08**: The system SHALL NOT depend on any device-side priority classification, which is internal queue state and is deliberately absent from the wire (D-019 §3). Backend priority assignment SHALL remain derived solely from PortNum, payload prefix and episode context, per REQ-EVT-04 and REQ-EVT-08.
- **REQ-UBI-07**: Normalization strategies SHALL be pure, no database access, no network access, no clock reads other than values passed in, so the dedup, ordering, and concurrency criteria in §3 are testable without a broker, a device, or a database.

### Event-Driven (triggered by an action)

- **REQ-EVT-01** `[A]`: WHEN a message arrives on `treklink/2/json/+/+`, the system SHALL decode the JSON envelope, construct a `RawMeshPacket`, and submit it to the normalizer.
- **REQ-EVT-02**: WHEN the normalizer receives a `RawMeshPacket`, the system SHALL resolve the strategy for its PortNum and produce a `TrekLinkEvent`, or produce `null` if the PortNum is not of interest.
- **REQ-EVT-03**: WHEN a `TrekLinkEvent` is produced, the system SHALL, **inside a single database transaction**, (a) insert the `GatewayEvent` keyed on `eventId`, (b) update the `Device` current-state projection, (c) perform SOS episode correlation if applicable, and (d) write a `SyncAuditLog` row recording the outcome.
- **REQ-EVT-04**: WHEN a `TEXT_MESSAGE_APP` payload begins with `"SOS - FALL DETECTED"`, the system SHALL classify the event as kind `FALL_SOS` at priority `P0`; WHEN it begins with `"SOS - "` but not the fall prefix, the system SHALL classify it as kind `SOS` at priority `P0`.
- **REQ-EVT-05**: WHEN an SOS-kind event is accepted, the system SHALL, inside the ingestion transaction, call `IncidentsService.correlateSos()`, which appends to the device's most recent non-`CLOSED` Incident whose `lastEventAt` lies within `incidents.episodeWindowSeconds` (reopening it if `RESOLVED`, E03-6), or otherwise creates exactly one new Incident; the system SHALL then link the `GatewayEvent` to the returned Incident. [BR-08, BR-12]
- **REQ-EVT-06**: WHEN position events from one device arrive at a cadence at or above the SOS beacon rate for a configured count within a configured window, and no open `Incident` exists for that device, the system SHALL raise a **suspected** SOS episode flagged as cadence-inferred and lower-confidence. *(Mitigates the single-unacknowledged-text-frame failure mode, see the risk register.)* **Known blind spots, today's firmware (O-001 fact 1):** a fall auto-SOS sends one `BACKGROUND` position and one text frame and then never beacons (`FallDetectionModule.cpp:140-145`), and an SOS raised before the first GPS fix sends no beacon positions at all (`PositionModule.cpp:352-355`). In both cases this detector cannot fire, so losing the single text frame loses the episode. Both are firmware fixes scheduled as `onboard-queue` Phase 9; they add beacons later and need no change here.
- **REQ-EVT-07**: WHEN an SOS episode is opened or appended to, the system SHALL emit an in-process domain event (`EventEmitter2`) for `monitoring` to fan out. The system SHALL NOT hold a Socket.io reference itself.
- **REQ-EVT-08**: WHEN a `POSITION_APP` event is accepted for a device with an open SOS episode, or within the backward grace window preceding an episode's opening text, the system SHALL classify it at priority `P1` rather than `P2`. *(Compensates for the JSON path's missing `MeshPacket.priority`, D-007.)*
- **REQ-EVT-09**: WHEN a `TELEMETRY_APP` event carrying a battery metric is accepted, the system SHALL update `Device.batteryPct`.
- **REQ-EVT-12** `[B]`: WHEN a JSON message arrives with `"type": "treklink_queue_health"` and a payload whose `schema` is `treklink.queue_health` and `v` is 1, the system SHALL persist the report (`uptime_s`, `capacity`, per-tier `depth`, `enqueued`, `published`, `shed`, and `p0_refused`, `flash_write_failed`, `restore_discarded`, `flash_bytes`, `flash_budget`) against the device resolved from `from`, and SHALL NOT treat it as a field event: it creates no `GatewayEvent` and never reaches episode correlation. The schema is `api-design/06-queue-health-payload.md`, a consumer copy of `treklink-firmware/specs/onboard-queue/design.md` §2.4, which wins on any disagreement. *(Changed per O-001: the firmware adds a `PRIVATE_APP` case to its JSON serializer, so the report is readable on the Stage A JSON topic. The earlier "needs check" note is withdrawn.)*
- **REQ-EVT-15** `[B]`: WHEN a queue-health counter is lower than the previous report's value for the same device, the system SHALL record a device reboot and SHALL NOT compute negative traffic from the difference. WHEN counters are consistent, the system SHALL keep `Σ enqueued - (Σ published + Σ shed + p0_refused + Σ depth)` per report as the device-side loss check for RQ1.
- **REQ-EVT-16**: WHEN a `PRIVATE_APP` message arrives with an empty `type` and no payload (any other private-app traffic, serialised by stock Meshtastic), the system SHALL ignore it without an audit row. A `treklink_queue_health` message with an unknown `schema` or `v` SHALL be audited `MALFORMED_ENVELOPE`.
- **REQ-EVT-14**: WHEN a packet arrives from a `sender` gateway key not seen before, the system SHALL register a `Gateway` row; on every accepted packet it SHALL advance that gateway's `lastPacketAt`, and it SHALL emit `gateway.health.changed` when the gateway crosses `monitoring.gatewayStaleSeconds` in either direction. [E04-2, BR-15]
- **REQ-EVT-13** `[B]`: WHEN a queue-health report's total `depth` (sum over the four tiers) is above zero, the system SHALL record the device as **buffering** rather than merely silent, and SHALL clear the state when a report shows zero. Reports are sent only while the uplink is up (every 300 s when something changed, and once right after an outage), so buffering is set from the first report after reconnection. *(E04-1 otherwise cannot distinguish "the node is holding events for us" from "the node is gone", they look identical from the platform when no events arrive.)*
- **REQ-EVT-10** `[C]`: WHEN the serial reader decodes a complete frame (`0x94 0xC3` + big-endian u16 length), the system SHALL enqueue it into the SQLite priority queue with its assigned tier.
- **REQ-EVT-11** `[C]`: WHEN the MQTT uplink transitions to connected, the system SHALL flush the SQLite queue in `ORDER BY priority ASC, created_at ASC`, deleting each row only after the broker acknowledges its publish at QoS 1.

### State-Driven (context-dependent)

- **REQ-STA-01** `[C]`: WHILE the MQTT uplink is unavailable, the system SHALL continue accepting and enqueuing serial frames, and SHALL NOT drop events until the configured queue-capacity bound is reached.
- **REQ-STA-02** `[C]`: WHILE the SQLite queue is at capacity, the system SHALL shed the **newest** row within the lowest-priority occupied tier, SHALL NEVER shed a `P0` row, and SHALL refuse and count a new `P0` when every row is `P0`. *(Aligned with the Stage B policy per Q7; an earlier revision said oldest-first, which is the stock behaviour that discards the evidence of what a device was doing when the link dropped.)*
- **REQ-STA-03**: WHILE an `Incident` is open for a device, the system SHALL classify that device's position events at `P1` (per REQ-EVT-08) until the Incident reaches `Resolved` or `Closed`.
- **REQ-STA-04**: WHILE no `Device` row matches an inbound `nodeNum`, the system SHALL quarantine the event, write a `SyncAuditLog` row with outcome `UNKNOWN_DEVICE` and create no `GatewayEvent`.

### Unwanted Behavior / Error Cases

- **REQ-ERR-01**: IF an inbound `eventId` already exists in `GatewayEvent`, THEN the system SHALL perform no insert, SHALL create no Incident, SHALL emit no domain event, and SHALL write a `SyncAuditLog` row with outcome `DUPLICATE_REJECTED`. The ingestion path SHALL remain a success from the publisher's perspective.
- **REQ-ERR-02**: IF two deliveries of the same `eventId` are processed concurrently, THEN exactly one SHALL be recorded as accepted and the other as `DUPLICATE_REJECTED`. The check and the insert SHALL be one atomic operation, never a read-then-write pair, which races under the charter's 20-simultaneous-submission target.
- **REQ-ERR-03**: IF a JSON envelope fails schema validation, THEN the system SHALL write a `SyncAuditLog` row with outcome `MALFORMED_ENVELOPE` and the raw message, and SHALL continue consuming without terminating the subscription.
- **REQ-ERR-04**: IF a strategy throws during normalization, THEN the system SHALL isolate the failure to that packet, record outcome `NORMALIZATION_FAILED` with the error, and continue processing subsequent packets.
- **REQ-ERR-05**: IF an SOS text payload matches a prefix but its coordinates fail to parse, including the literal `"SOS - [No GPS]"` form, THEN the system SHALL still classify it `P0` and still open the episode, with a null position. **An SOS without coordinates is an SOS.**
- **REQ-ERR-06**: IF `observedAt` is absent or zero, the firmware writes `0` when the device RTC holds no valid time, THEN the system SHALL persist `observedAt` as null and SHALL NOT substitute `receivedAt` for it.
- **REQ-ERR-07**: IF a device reports an `observedAt` later than `receivedAt` by more than `gatewaySync.clockSkewToleranceSeconds`, or older than `gatewaySync.maxBacklogAgeHours`, THEN the system SHALL accept and persist the event, flag it `CLOCK_SKEW` in the audit log, and use `receivedAt` as its `eventTime`. An `observedAt` in the past within the backlog age is a delayed delivery, not a skew (O-001 fact 3). Device clock error SHALL NOT cause event loss.
- **REQ-ERR-08**: IF the MQTT broker connection drops, THEN the system SHALL reconnect with bounded exponential backoff and SHALL resubscribe to all topics on re-establishment.
- **REQ-ERR-09**: IF a position payload carries latitude or longitude outside valid WGS-84 bounds, THEN the system SHALL persist the event with a null position and flag `INVALID_POSITION`, rather than rejecting the event.
- **REQ-ERR-11**: IF a position implies travel from the device's last projected position faster than `monitoring.maxPlausibleSpeedKmh`, THEN the system SHALL persist the event, write `IMPLAUSIBLE_POSITION` to the audit log, leave the device projection unchanged and emit no position update. [E04-4, BR-16, FR-MON-05]
- **REQ-ERR-10** `[A]`: IF no packet has been received from a configured gateway within a configured silence interval, THEN the system SHALL raise a gateway-health alarm rather than appearing merely idle. *(A silent uplink and a quiet trail are indistinguishable from the platform side; this is the only signal that separates them.)*

### Optional Features

- **REQ-OPT-01** `[C]`: WHERE the serial-bridge adapter is enabled, the system SHALL accept events from both ingress paths concurrently, relying on `eventId` (REQ-ERR-01) to collapse packets delivered by both.
- **REQ-OPT-02**: WHERE an event carries link-quality fields (`rssi`, `snr`, `hops_away`), the system SHALL persist them for RF-coverage analysis in the RQ1 evaluation.
- **REQ-OPT-03**: WHERE the `/2/e/` protobuf topic is enabled in place of JSON, the system SHALL read `MeshPacket.priority` directly and bypass the grace-window inference of REQ-EVT-08. *(Deferred precision upgrade, D-007.)*

---

## 3. Non-Functional Requirements

Charter §5 is binding and not restated. Module-specific bindings and one explicit gap:

| Property | Target | Stage | Verified by |
|---|---|---|---|
| Ingestion latency (broker receipt → DB commit) | ≤5s | A, B | REQ-EVT-03 path benchmark |
| DB commit → WebSocket delivery | ≤2s | A, B | `monitoring` integration test |
| Duplicate prevention | 0 duplicate Incidents across 10× replay | A, B | REQ-ERR-01/02 |
| Concurrency | ≥20 simultaneous submissions, 0 loss, 0 duplication | A, B | REQ-ERR-02 |
| Fleet scale | ≥50 devices, concurrent trips, no architecture change | A, B | Load harness |
| **Offline recovery delivery rate** | **≥99% after 30s–30min loss** | **B, C** | firmware `onboard-queue` AC-02; REQ-STA-01/02, REQ-EVT-11 for C |
| **Priority-ordering compliance** | **≥99%, all P0 before P2/P3 on reconnect** | **B, C** | firmware `onboard-queue` AC-02; REQ-EVT-11 for C |
| Device buffering is visible, not inferred | queue depth and drop counters surfaced per device | **B** | REQ-EVT-12, REQ-EVT-13 |

> ⚠️ **Stage A cannot satisfy the bolded rows, and the reason is worse than "no buffer."** The node's stock queue is 16 entries, RAM-only, FIFO, and **discards the oldest entry on overflow** (`MQTT.cpp:821–823`), so during an outage it evicts the SOS text frame *before* it evicts telemetry. Stage A is not merely unbuffered; its buffer is ordered against the priority rule this module exists to enforce. Never present Stage A as satisfying the offline-recovery NFR.
>
> **Both rows become satisfiable at Stage B** (D-018) and are measured in `treklink-firmware/specs/onboard-queue/` Phase 8, against the unmodified firmware as baseline. Stage C extends the same guarantees to events from *peer* nodes, which Stage B cannot reach, the two are additive, not alternatives.

---

## 4. Acceptance Criteria

- **AC-01**: Publishing a captured SOS text frame to `treklink/2/json/+/+` creates exactly one `GatewayEvent`, exactly one `Incident` in `Detected`, and one `SyncAuditLog` row with outcome `ACCEPTED`.
- **AC-02**: Replaying that identical frame 10× leaves the `Incident` count at 1 and produces 9 additional `SyncAuditLog` rows with outcome `DUPLICATE_REJECTED`.
- **AC-03**: Publishing 20 distinct frames concurrently yields 20 `GatewayEvent` rows, zero loss, zero duplication.
- **AC-04**: A simulated SOS episode, one text frame followed by 12 position beacons at 5s spacing, produces exactly one `Incident` with 13 correlated events, not 13 Incidents.
- **AC-05**: A `"SOS - [No GPS]"` frame opens an `Incident` with a null position and priority `P0` (REQ-ERR-05).
- **AC-06**: 12 position beacons at 5s spacing with **no** preceding text frame raise one cadence-inferred suspected episode (REQ-EVT-06), proving a button or gesture SOS with a GPS fix survives loss of its single announcing frame. The fall and no-fix cases are out of this AC until the firmware adds beacons (REQ-EVT-06 note).
- **AC-12**: 12 beacons with `timestamp` 5 s apart delivered one per minute (slow backlog drain) produce one Incident, with `lastEventAt` following `eventTime`, not arrival.
- **AC-13** `[B]`: A `treklink_queue_health` message with `depth [1,4,0,12]` creates no `GatewayEvent`, sets the device buffering, and a later report with `depth [0,0,0,0]` clears it.
- **AC-07**: A malformed JSON message writes a `MALFORMED_ENVELOPE` audit row and the subscription keeps consuming the next valid message.
- **AC-08**: A frame whose `from` matches no `Device` writes an `UNKNOWN_DEVICE` audit row and creates no `GatewayEvent` (REQ-STA-04).
- **AC-09**: Adding a new PortNum strategy requires only a new class plus a registry entry, no edit to `MeshNormalizerService` (REQ-UBI-06, Open/Closed).
- **AC-10**: The full normalizer strategy suite passes with no broker, no device, and no database in the test fixture (REQ-UBI-07).
- **AC-11** `[C]`: With the uplink severed for 30 minutes and 200 mixed-priority events enqueued, restoring the uplink delivers ≥99% and flushes every `P0` before any `P2`/`P3`.

---

## 5. Open Questions

- [x] ~~**Q1.** Hardware-variant mix of the demo units.~~ **Answered (Session 3):** v1 is out of the demo set; Stage A targets **v2/v3/v4**, all of which leave MQTT compiled in. v1's exclusion is a build-time flag and would be a one-line fix if ever needed (D-008).
- [x] ~~**Q2, Blocking for TP2 planning.** Supervisor decision on the Stage A/B trade; omit Stage B if scope must shrink.~~ **Closed (Session 7).** The trade is void, the supervisor's green light removed the scope pressure, and D-016 makes MF-02 binding anyway. Buffering is **in**, and D-018 splits it into an on-device Stage B (built now) and a basecamp Stage C (after). The offline NFRs and RQ1/RQ2 stay binding and become measurable this term.
- [x] ~~**Q9, New, from D-008.** Which firmware fixes do we take?~~ **Answered (Session 7).** All four were evaluated; the adopted set is:
  - **Taken now**, the on-device durable priority queue. Not on the original list, and it turned out to be the highest-value item: it fixes a defect (`MQTT.cpp:821–823` evicts SOS first) rather than adding a capability. Spec: [`treklink-firmware/specs/onboard-queue/`](../../../treklink-firmware/specs/onboard-queue/requirements.md).
  - **Taken, sequenced after**, retransmit the SOS discriminator each Nth beacon, and set beacon `priority = MAX` (REQ-OPT-01/02 there). Held back deliberately so the queue's measured effect stays attributable to one change.
  - **Partially taken**, the `PRIVATE_APP` range is now used, for queue-health reporting (REQ-EVT-12). A custom *SOS* PortNum is not adopted yet, but the pattern is established and the cost of adding one has dropped.
  - **Still deferred**, boot-`sessionId` + per-packet `sequenceNumber`. The D-006 split key works without it; gap detection remains the reason to revisit.
  - Firmware effort **does** earn graded credit, confirmed 2026-09-13, recorded in D-008.
- [ ] **Q3.** Episode window length for REQ-EVT-05. The 30s steady-state beacon interval sets the floor; a window below about 90s risks splitting one episode across two Incidents when beacons are lost. **Proposed default 300 s** as `incidents.episodeWindowSeconds`; carried into C-003 for a decision before AC-04 is written as a test.
- [ ] **Q4.** Backward grace window for REQ-EVT-08. The SOS position is emitted milliseconds before its text, but mesh reordering can widen that gap. **Proposed default 60 s** as `gatewaySync.retroTagGraceSeconds`; carried into C-003.
- [ ] **Q5.** Cadence-anomaly thresholds for REQ-EVT-06 (count N, window W). Too tight and routine dense reporting raises false SOS episodes; too loose and the mitigation never fires. **Proposed defaults N = 6 within W = 60 s** (the first minute of a beacon emits 12 positions at 5 s), as `gatewaySync.cadenceCount` and `gatewaySync.cadenceWindowSeconds`, to be calibrated against the routine interval measured in task 0.4.
- [x] ~~**Q6.** Does a cancelled SOS produce any observable signal?~~ **Answered by `04-firmware-ground-truth.md` §2**: `cancelSOS()` (`TrekLinkSOSHelper.cpp:57–61`) only calls `deactivateAlarms()` and transmits nothing. An episode is closed only by an operator; `specs/incidents/` reflects that.
- [ ] **Q7.** SQLite queue capacity bound and eviction policy constants for REQ-STA-02 `[C]`. **Partly answered**: Stage B settled the *policy*, shed newest-first within the lowest occupied tier, never a P0, refuse-and-count when the queue is all-P0 at capacity. Stage C should adopt the same policy for consistency; only the numeric bound differs, since a laptop is not a microcontroller.
- [x] ~~**Q8.** Does `nodeNum` to `Device` mapping need to survive hardware swaps mid-trip?~~ **Answered by `04-firmware-ground-truth.md` §3** (Session 4): `nodeNum` is MAC-derived (`NodeDB.cpp:1123–1142`) and stable per physical unit across reboots. `Device.nodeNum` stays `@unique`, stored as `BigInt` because the value is an unsigned 32-bit integer.

## 6. Configuration Matrix entries

| Parameter | Default | Location | Admin-editable | Source |
|---|---|---|---|---|
| `MQTT_BROKER_URL`, `MQTT_TOPIC_ROOT` | none, `treklink` | env | no | D-007 frozen config |
| `MQTT_RECONNECT_MIN_MS` / `MQTT_RECONNECT_MAX_MS` | 1000 / 30000 | env | no | REQ-ERR-08, proposal |
| `gatewaySync.retroTagGraceSeconds` | 60 | DB | yes | Q4 proposal |
| `gatewaySync.cadenceCount` / `gatewaySync.cadenceWindowSeconds` | 6 / 60 | DB | yes | Q5 proposal |
| `gatewaySync.clockSkewToleranceSeconds` | 300 | DB | yes | REQ-ERR-07, proposal (future-dated only) |
| `gatewaySync.maxBacklogAgeHours` | 72 | DB | yes | REQ-ERR-07, proposal |
| `gatewaySync.gatewaySilenceSeconds` | 120 | DB | yes | REQ-ERR-10, proposal |
| `incidents.episodeWindowSeconds` | 300 | DB | yes | Q3 proposal, owned by `incidents` |
| `monitoring.maxPlausibleSpeedKmh`, `monitoring.gatewayStaleSeconds` | 30 / 120 | DB | yes | owned by `monitoring` |
