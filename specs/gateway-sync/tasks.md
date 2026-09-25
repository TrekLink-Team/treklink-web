# Implementation Tasks: gateway-sync

> Approved by: pending (`_handoff/SYNC.md`) · Branch: `feat/module-specs-and-backend-foundation` (the retired dual `features/Design_*` and `features/Implementation_*` branches were replaced by one branch per unit of work, D-009) · Jira: E4 stories US-041 to US-052
>
> Fulfills `design.md` in this folder. Authority: D-005 (staged topology), D-006 (split `eventId`), D-007 (Strategy normalizer).

## Phase 0: Blockers, clear before Phase 1 opens

- [x] 0.1 ~~Update `04-architecture-conventions.md` §3 to the D-006 split-key scheme~~, **done, Session 3**
- [x] 0.2 ~~Inventory the hardware-variant mix of the demo units~~, **answered, Session 3**: v1 out of scope, Stage A targets v2/v3/v4
- [x] 0.3 ~~Put the Stage A/B scope trade to the supervisor (**Q2**)~~ **Closed, Session 7**: D-005 and D-016 make buffering permanent scope, and D-018 split it into Stage B (on-device, built now) and Stage C (basecamp, deferred).
- [ ] 0.5 Decide the firmware-change slate (**Q9**, D-008), firmware is editable and reflashable
  - Candidates, highest value first: retransmit the SOS discriminator with each beacon (retires the Critical risk); custom SOS PortNum in `PRIVATE_APP` (retires the string parser); boot-`sessionId` + `sequenceNumber` (restores the charter `eventId` **and enables gap detection, proving loss, not just deduplicating arrivals**); transmit on SOS cancel (**Q6**)
  - Also confirm with the supervisor whether firmware commits earn graded credit (D-008 question 3), affects how much sprint capacity this deserves
  - **Nothing in Phases 1–8 depends on this.** The platform-side design stands with or without a firmware change; these are upgrades, not prerequisites.
  - _Requirements: D-008_
- [ ] 0.4 Capture golden fixtures from a physical device, SOS, fall-SOS, no-GPS, routine position, telemetry
  - Real serialized JSON off the broker, not hand-written. Everything in Phase 2 is tested against these.
  - Also yields the routine position interval needed to calibrate **Q5**
  - _Requirements: §2.3, §5 contract tier_

## Phase 1: Foundation & Domain Modeling

- [ ] 1.1 Define `TrekLinkEvent`, `RawMeshPacket`, `EventKind`, `IngressPath`, `MeshIngressAdapter`, `PacketNormalizationStrategy` in `gateway-sync/contracts/`
  - Re-export for `gateway/` consumption (shared types, D-004)
  - _Requirements: REQ-UBI-06, design §1.1, §2.1, §2.2_
- [ ] 1.2 Prisma: extend `GatewayEvent` (`kind`, `observedAt`, `receivedAt`, `gatewayId`, `ingress`, lat/lon/alt, rssi/snr/hopsAway, `incidentId`) + indexes
  - _Requirements: REQ-UBI-01/02/04, REQ-OPT-02, design §1.2_
- [ ] 1.3 Prisma: add `SyncAuditLog` model and `SyncOutcome` enum
  - _Requirements: REQ-EVT-03, REQ-ERR-01/03/04, REQ-STA-04_
- [ ] 1.4 Prisma: split `Incident` keys, drop `eventId @unique`, add `openedByEventId` FK, `lastEventAt`, `detectionConfidence`, index `([deviceId, status, lastEventAt])`
  - The conflation being removed here is what would otherwise mint one Incident per beacon tick
  - _Requirements: REQ-EVT-05, D-006_
- [ ] 1.5 Write and verify the migration against a scratch database
  - _Requirements: D-001_
- [ ] 1.6 Add `SyncOutcome`-aligned codes to `common/error-codes.enum.ts` (`DUPLICATE_EVENT_ID`, `UNKNOWN_DEVICE`, `MALFORMED_ENVELOPE`, …)
  - _Requirements: `05-backend-conventions.md` §2 golden rule 1_

## Phase 2: Normalizer (Strategy pattern), pure, no I/O

- [ ] 2.1 `MeshNormalizerService` with `PACKET_STRATEGIES` multi-provider injection and PortNum registry
  - No PortNum branching in the context, resolve and delegate only
  - _Requirements: REQ-UBI-06, REQ-EVT-02, AC-09_
- [ ] 2.2 `TextMessageStrategy`, prefix table from design §2.3
  - Fall prefix tested **first**: `"SOS - FALL DETECTED - …"` also satisfies `"SOS - "`
  - Coordinate parse failure never downgrades kind (REQ-ERR-05)
  - Tolerate the 100-byte `snprintf` truncation without throwing
  - _Requirements: REQ-EVT-04, REQ-ERR-05_
- [ ] 2.3 `PositionStrategy`, `POSITION` at provisional `P2`; WGS-84 bounds check → null position + `INVALID_POSITION`
  - _Requirements: REQ-ERR-09_
- [ ] 2.4 `TelemetryStrategy`, `TELEMETRY` at `P3`, extract `batteryPct`
  - _Requirements: REQ-EVT-09_
- [ ] 2.5 `eventId` derivation helper, `sha256(nodeNum:packetId)`
  - _Requirements: REQ-UBI-05_
- [ ] 2.6 `rx_time = 0` → `observedAt = null`; never substitute `receivedAt`
  - _Requirements: REQ-UBI-02, REQ-ERR-06_
- [ ] 2.7 Unit-test every strategy against Phase 0.4 fixtures, **no broker, no device, no DB in the fixture**
  - _Requirements: REQ-UBI-07, AC-05, AC-10_
- [ ] 2.8 Test that adding a stub PortNum strategy requires no edit to `MeshNormalizerService`
  - _Requirements: AC-09_

## Phase 3: Ingestion & Idempotency

- [ ] 3.1 `EventIngestionService`, single-transaction ingest per design §2.5
  - `createMany({ skipDuplicates: true })`; the unique index arbitrates the race, not application code
  - _Requirements: REQ-EVT-03, REQ-ERR-01/02_
- [ ] 3.2 Device resolution via injected `DevicesService.findByNodeNum`, never a direct Prisma import
  - _Requirements: REQ-STA-04, `04-architecture-conventions.md` §1.1_
- [ ] 3.3 Device current-state projection update (`lastSeenAt`, `batteryPct`, last position)
  - _Requirements: REQ-EVT-09_
- [ ] 3.4 `SyncAuditLog` writes on every outcome branch, including `CLOCK_SKEW` tolerance check
  - _Requirements: REQ-ERR-01/03/04/07, REQ-STA-04_
- [ ] 3.5 Emit the `EventEmitter2` domain event on accept only, no Socket.io reference in this module
  - _Requirements: REQ-EVT-07_
- [ ] 3.6 Integration test: 10× replay → 1 Incident + 9 `DUPLICATE_REJECTED`
  - _Requirements: AC-02_
- [ ] 3.7 Integration test: 20 concurrent distinct, and 20 concurrent identical
  - _Requirements: REQ-ERR-02, AC-03_

## Phase 4: Episode Correlation

- [ ] 4.1 Decide and document **Q3** (episode window) and **Q4** (backward grace window); ship as config, not constants
  - _Requirements: REQ-EVT-05/08_
- [ ] 4.2 Call `IncidentsService.correlateSos(event, tx)` inside the ingestion transaction and link the returned `incidentId` on the own `GatewayEvent` row; the lookup, append and reopen (E03-6) live in `incidents` (design §2.4, module-boundary correction)
  - Lookup, not hash-bucket: a bucket boundary mid-episode splits one SOS into two Incidents (D-006)
  - _Requirements: REQ-EVT-05_
- [ ] 4.3 `P2 → P1` promotion for positions during an open episode, plus retro-tagging within the grace window
  - Needed because the JSON path omits `MeshPacket.priority` (D-007)
  - _Requirements: REQ-EVT-08, REQ-STA-03_
- [ ] 4.4 Calibrate **Q5** (cadence thresholds N, W) against the Phase 0.4 routine-interval measurement
  - _Requirements: REQ-EVT-06_
- [ ] 4.5 Cadence-anomaly detector raising `SUSPECTED` episodes
  - _Requirements: REQ-EVT-06_
- [ ] 4.6 In-place `SUSPECTED → CONFIRMED` upgrade on late-arriving SOS text, must not create a second Incident
  - _Requirements: REQ-EVT-06, design §1.3_
- [ ] 4.7 Hand-off to `IncidentsService` via DI; `gateway-sync` never reads or writes the `Incident` table itself; the boundary check script (platform task 1.9) enforces it
  - _Requirements: `04-architecture-conventions.md` §1.1_
- [ ] 4.8 Unit tests: 1 text + 12 beacons → 1 Incident / 13 events; 12 beacons alone → 1 `SUSPECTED`
  - _Requirements: AC-04, AC-06_

## Phase 4B: Gateways, projection, plausibility and event time (added this revision)

- [ ] 4B.0 `eventTime` derivation and its use for trails, cadence and the episode window; skew rule of REQ-ERR-07 with `maxBacklogAgeHours` (O-001 fact 3)
  - _Requirements: REQ-UBI-02, REQ-ERR-07, AC-12_
- [ ] 4B.00 Test that a peer SOS relayed at `HIGH` priority is still classified by prefix, and that no code path reads a priority field to decide SOS (O-001 fact 2)
  - _Requirements: REQ-UBI-09_

- [ ] 4B.1 `Gateway` model and registration on first `sender`; advance `lastPacketAt`; emit `gateway.health.changed` on stale transitions
  - _Requirements: REQ-EVT-14, E04-2_
- [ ] 4B.2 Write the device projection only through `DevicesService.updateProjection(..., tx)`
  - _Requirements: design §2.5, NFR-MNT-01_
- [ ] 4B.3 Position plausibility check against the last projected position and `monitoring.maxPlausibleSpeedKmh`; `IMPLAUSIBLE_POSITION` audit outcome
  - _Requirements: REQ-ERR-11, E04-4_
- [ ] 4B.4 `BigInt` node numbers end to end (`SyncAuditLog.nodeNum`, `RawMeshPacket.from` parsed as unsigned)
  - _Requirements: `04-firmware-ground-truth.md` §3_

## Phase 5: Stage A Ingress Adapter (MQTT JSON)

- [ ] 5.1 `MqttJsonIngressAdapter` subscribing `treklink/2/json/+/+`
  - _Requirements: REQ-EVT-01_
- [ ] 5.2 Envelope DTO + `class-validator` schema for the `MeshPacketSerializer.cpp:410–424` field set
  - _Requirements: REQ-ERR-03_
- [ ] 5.3 JSON `type` → PortNum mapping (`"text"`/`"position"`/`"telemetry"`)
  - _Requirements: REQ-EVT-01_
- [ ] 5.4 Per-packet error isolation, one bad packet must not kill the subscription
  - _Requirements: REQ-ERR-03/04, AC-07_
- [ ] 5.5 Bounded exponential-backoff reconnect + resubscribe on re-establish
  - _Requirements: REQ-ERR-08_
- [ ] 5.6 Register as `MESH_INGRESS_ADAPTERS` multi-provider (Stage B must be a registration change, nothing more)
  - _Requirements: design §2.1_
- [ ] 5.7 Document the locked node config, `json_enabled=true`, `encryption_enabled=false`, `root="treklink"`, in `ignore/envs/`
  - _Requirements: D-007_
- [ ] 5.8 Gateway-silence alarm after a configured interval
  - _Requirements: REQ-ERR-10_

## Phase 6: API Presentation Layer

- [ ] 6.1 Write the four `api-design/*.md` operation specs **before** the controller
  - One file per `op`, not per route, the module has a single route (design §4)
  - Frontend develops against these mocked (`04-architecture-conventions.md` §4.3)
  - _Requirements: design §4_
- [ ] 6.2 Implement the operation registry and `POST /api/gateway-sync` dispatch
  - `GatewaySyncOperation<TParams, TResult>` per design §4; discriminated on `op`
  - **Registration must fail closed**: an operation registered without a `policy` throws at module init, never at request time
  - _Requirements: REQ-UBI-04, design §4_
- [ ] 6.3 Implement the four operations: `health`, `listEvents`, `listAudit` (Admin), `replay` (Admin)
  - _Requirements: REQ-UBI-04, REQ-ERR-10, design §4_
- [ ] 6.4 `JwtAuthGuard` on the route; **per-operation policy evaluated inside dispatch, before `handle()`**
  - A route-level `PoliciesGuard` cannot work here, the required policy depends on the request body. See the caveat in design §4.
  - _Requirements: charter §5 security_
- [ ] 6.5 Authorization test **per operation**, a Staff actor is denied `listAudit` and `replay`; an unregistered-policy operation fails at init
  - This test suite is what replaces the auditability that route-level guards gave for free. Do not skip it.
  - _Requirements: charter §5 security_
- [ ] 6.6 Swagger/OpenAPI annotations, documenting each `op` as a discriminated request variant
- [ ] 6.7 Integration tests asserting the D-002 envelope shape and status codes exactly as specced
  - _Requirements: D-002_

## Phase 7: Frontend Integration

- [ ] 7.1 API client methods + Zod schemas mirroring the response DTOs
- [ ] 7.2 `LiveMapWidget` SOS layer, `CONFIRMED` and `SUSPECTED` visually distinct
  - A cadence-inferred episode carries lower confidence; no operator should read it as equivalent
  - _Requirements: REQ-EVT-06, design §6_
- [ ] 7.3 `GatewayHealthWidget` wired to the `health` operation, including per-device queue depth and the **buffering** state from Phase 8B
- [ ] 7.4 `SyncAuditTable` (Admin), the RQ1 evidence view
- [ ] 7.5 Loading / empty / error states on all three

## Phase 8: Verification & DoD Audit

- [ ] 8.1 Firmware contract regression suite green against Phase 0.4 golden fixtures
  - The tier that turns a silent firmware format drift into a failing build instead of an SOS parsed as chat
  - _Requirements: design §2.3, §5_
- [ ] 8.2 Full suite green (`npm test`); lint + typecheck clean
- [ ] 8.3 Measure ingestion latency (broker → DB commit ≤5s) and DB → socket (≤2s)
  - _Requirements: `requirements.md` §3_
- [ ] 8.4 Load test ≥50 devices across concurrent trips
- [ ] 8.5 Verify `api-design/*.md` matches actual behavior
- [ ] 8.6 Confirm AC-01 … AC-10 all demonstrably pass; record AC-11 as Stage C-blocked
- [ ] 8.7 Update `docs/sessions/current.md` session ledger

## Phase 8B: Stage B, consume the on-device queue (backend side)

> **Small by design.** The firmware queue changes delivery order and durability, not the wire format (**D-019 §3**), so the normalizer, `eventId` derivation and ingestion transaction are all untouched. The only new backend work is making the device's buffering *visible*.
>
> Firmware side: [`treklink-firmware/specs/onboard-queue/`](../../../treklink-firmware/specs/onboard-queue/requirements.md). This phase depends on its Phase 6.

- [ ] 8B.1 Add a `QueueHealthStrategy` to the normalizer registry that recognises JSON `type: treklink_queue_health` on PortNum `PRIVATE_APP` (256), validates `schema` and `v` against `api-design/06-queue-health-payload.md` (source of truth: firmware `onboard-queue/design.md` §2.4), and returns a health record, **not** a `TrekLinkEvent`; other `PRIVATE_APP` traffic returns null
  - Must not create a `GatewayEvent` and must never reach episode correlation
  - _Requirements: REQ-EVT-12, REQ-UBI-06_
- [ ] 8B.2 Persist every field of the report in `DeviceQueueReport`; detect a counter decrease as a reboot (REQ-EVT-15); compute the device-side loss check
  - _Requirements: REQ-EVT-12_
- [ ] 8B.3 Derive a **buffering** device state from a non-zero reported depth, distinct from stale and from silent
  - E04-1 cannot otherwise tell "the node is holding events for us" from "the node is gone"
  - _Requirements: REQ-EVT-13_
- [ ] 8B.4 Surface depth and counters through the `health` operation of the module endpoint
  - _Requirements: REQ-EVT-12, REQ-ERR-10_
- [ ] 8B.5 Assert REQ-UBI-08 in tests, no code path may read a device-side priority classification, since none is transmitted
  - A guard against the tempting-but-wrong assumption that Stage B tells the backend what tier an event was
  - _Requirements: REQ-UBI-08_
- [ ] 8B.6 Integration test: a health packet updates device state and creates zero `GatewayEvent` rows
  - _Requirements: REQ-EVT-12_

---

## Phase 9: Stage C, Gateway Bridge (deferred until after Stage B)

> **Renamed by D-018**, this was "Stage B" before Session 7. Form settled by **D-020**: browser-first, native desktop as fallback. The task list below is written against the existing `gateway/src` Node implementation and ports to the browser form unchanged apart from its transport and storage adapters.
>
> Scheduled after Stage B (D-018). Everything above is reused unchanged; this phase adds an adapter and a queue in front of it.
>
> **Adopt Stage B's shed policy here** (requirements Q7): newest-first within the lowest occupied tier, never a P0, refuse-and-count when all-P0 at capacity. Only the numeric bound differs, a laptop is not a microcontroller.

- [ ] 9.1 Real serial reader replacing the simulation stub in `gateway/src/serial/serial-reader.ts`, `0x94 0xC3` + big-endian u16 framing, resync on corruption
  - **Confirmed bug in the current stub** (Session 4 audit): `handleFrame(deviceId, sessionId, sequenceNumber, ...)` still builds `eventId = deviceId:sessionId:sequenceNumber`, the pre-D-006 formula. Neither field exists in the firmware (`04-firmware-ground-truth.md`). The rewritten signature must take `(nodeNum, packetId, ...)` and derive `eventId = sha256(nodeNum:packetId)`, matching `contracts/` from Phase 1/2. Do not carry the old signature forward even as a temporary shim.
  - _Requirements: REQ-EVT-10, REQ-UBI-05_
- [ ] 9.2 Decode Meshtastic protobuf frames to the canonical publish shape
  - _Requirements: REQ-EVT-10_
- [ ] 9.3 Reconcile `priority-queue.ts` against design §1.1, hard-delete-on-flush stays; no `flushed_at`
  - _Requirements: REQ-EVT-11_
- [ ] 9.4 Capacity bound + eviction policy, **P0 never evicted** (**Q7**)
  - _Requirements: REQ-STA-02_
- [ ] 9.5 Reconcile `mqtt-client.ts` flush ordering, `priority ASC, created_at ASC`, delete only on QoS-1 ack
  - **Confirmed bug in the current stub** (Session 4 audit): `flushQueue()` calls `this.queue.peek(20)` then fires all 20 `client.publish(...)` calls concurrently, each removing its own row independently in its own callback. Publish acks can complete out of order under real network latency, a P2/P3 row can be acked-and-removed before an in-flight P0 row, which directly breaks the ≥99% priority-ordering-compliance NFR this phase exists to satisfy. **Fix**: flush sequentially, await each publish's QoS-1 ack before issuing the next, preserving `peek()`'s priority order, not fire-and-forget.
  - **Second confirmed gap**: `flushQueue()` is only invoked from the `client.on('connect', ...)` handler, it never re-runs for events enqueued while the connection stays up continuously. Add a drain trigger on every successful `enqueue()` (or a short poll/interval) so steady-state traffic doesn't wait for a reconnect cycle to flush.
  - Acceptance test additions: (a) interleave a P0 enqueue after 19 P2/P3 rows are already mid-flush, assert the P0 is acked and removed first; (b) enqueue new events while connected with no disconnect, assert they flush without waiting for a reconnect event.
  - _Requirements: REQ-EVT-11_
- [ ] 9.6 `SerialBridgeIngressAdapter` + register as a second `MESH_INGRESS_ADAPTERS` provider
  - _Requirements: REQ-OPT-01_
- [ ] 9.7 Dual-path dedup test, same packet via both ingresses collapses to one `GatewayEvent`
  - _Requirements: REQ-OPT-01_
- [ ] 9.8 RQ1/RQ2 evaluation harness: 30s–30min severance, ≥20 trials/condition, ≥99% delivery, ≥99% P0-ordering
  - _Requirements: AC-11, charter §5_
