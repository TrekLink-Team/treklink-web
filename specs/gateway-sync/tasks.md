# Implementation Tasks: gateway-sync

> Rewritten 2026-10-18 (D-051) in the full task format of `specs/README.md` §6; adds the Field Station
> version in its health report against the downloadable release (FR-EVT-18, D-039). Fulfills `design.md`;
> endpoints are `api-design/01` to `06`; MQTT and the local page are the hand-written contracts in `api-design/`.

| | |
|---|---|
| Lane owner | KhoaDD (roadmap §5.1) |
| Reviewer | LongLP |
| Sprint | 3 (W7 to W8), MF-02 complete for Review 2; the isolation and load harness in Sprint 4 |
| Stories | US-UC26, US-UC27, US-UC28, US-UC42 (station health; the page is `monitoring` and `frontend`) |
| Depends on | devices 2.5; rentals 4.5 (`custodyAt`); organizations 2.8 (stations); incidents 2.3 for the SOS hand-off |
| Unblocks | incidents 2.3 (SOS events), monitoring 2.1 (field events) |

## Phase 1: Foundation

- [ ] 1.1 `GatewaySyncModule` and MQTT client (owner KhoaDD)
  - **Files**: `backend/src/modules/gateway-sync/gateway-sync.module.ts`, `mqtt/mqtt-subscriber.ts`, `providers/mqtt-health.probe.ts`
  - **Do**: connect with `MQTT_BROKER_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`; QoS 1, persistent session, subscribe `treklink/2/json/+/+`, `treklink/fs/+/2/json/+/+`, `treklink/fs/+/health`; acknowledge only after `ingest()` returns; provide `MQTT_HEALTH_PROBE.isConnected()`
  - **Test**: health reports `mqtt: "down"` while the broker container is stopped
  - **Progress**: `MqttSubscriber` on the node topic, QoS 1, `clean: false`, PUBACK after `ingest()` through mqtt.js `handleMessage`, retry while the database is unreachable; `MQTT_HEALTH_PROBE` from `GatewaySyncPortsModule` (platform design §2.1). Verified against Mosquitto 2: `degraded` and `mqtt: "down"` with the broker stopped, `ok` again after it returns. `MQTT_INGESTION_ENABLED=false` keeps it off (e2e suite). The two Field Station subscriptions join with the station adapter (Sprint 4, D-058 rule 2)
  - _Requirements: REQ-UBI-05, design §2_
- [ ] 1.2 Golden fixtures (owner KhoaDD)
  - **Files**: `backend/test/fixtures/mqtt/*.json`
  - **Do**: captured stock JSON from real v2, v3 and v4 devices for text, `SOS - `, `SOS - FALL DETECTED`, position, telemetry and `treklink_queue_health`, per `mqtt-ingress-contract.md` and `queue-health-payload.md`; give the rented devices TL-0009 and TL-0010 of `backend/prisma/seed-demo.ts` the captured node numbers, so a replay lands on contract RC-2026-0001 (platform 1.12)
  - **Progress**: 13 fixtures are synthesized from `MeshPacketSerializer.cpp` and `TrekLinkSOSHelper.h` on the seed's node numbers (provenance in `backend/test/fixtures/mqtt/README.md`); the capture from real v2, v3 and v4 devices is still open and replaces them
  - _Requirements: REQ-UBI-05, FR-EVT-10_

## Phase 2: Ingestion

- [ ] 2.1 Adapters and strategies (owner KhoaDD)
  - **Files**: `adapters/node-json.adapter.ts`, `adapters/field-station-json.adapter.ts`, `normalizer/text.strategy.ts`, `position.strategy.ts`, `telemetry.strategy.ts`, `queue-health.strategy.ts`
  - **Do**: adapters translate topic and envelope into the `CanonicalEnvelope`; the station adapter resolves the station through `FieldStationsService.byUsername`; text tests `SOS - FALL DETECTED` before `SOS - `, both P0; a decode failure audits `MALFORMED_ENVELOPE` and continues; a throwing strategy audits `NORMALIZATION_FAILED` for that packet only
  - **Test**: every fixture of 1.2; the fall prefix; AC-05
  - **Progress**: `NodeJsonAdapter` and the text, position and telemetry strategies are built and tested on every fixture. Open: `field-station-json.adapter.ts` (needs `FieldStationsService`, organizations 2.8) and `queue-health.strategy.ts` (task 2.6); until then a `treklink_queue_health` report is ignored like any type ingestion does not read
  - _Requirements: REQ-EVT-01, REQ-EVT-02, REQ-ERR-01, REQ-ERR-05, AC-05, FR-EVT-05, FR-EVT-09_
  - _Story: US-UC26_
- [ ] 2.2 `IngestionService.ingest(envelope)` (owner KhoaDD)
  - **Files**: `backend/src/modules/gateway-sync/ingestion.service.ts`, `ingestion.repository.ts`
  - **Do**: the five steps of design §2: `eventId = sha256(from + ":" + id)` lower-case hex; resolve the device by `nodeNum` (`UNKNOWN_DEVICE`); `INSERT ... ON CONFLICT (eventId) DO NOTHING` (`DUPLICATE_REJECTED`, nothing else changes); one audit row per attempt; `rx_time` 0 stored as unknown; ordering by queue sequence and priority only; post-commit `field.position` and `field.telemetry`
  - **Test**: AC-01 (node uplink and station deliver the same packet, stored once); AC-02 replay ten times
  - **Progress**: built for the node path. Against Postgres 16 and Mosquitto 2: 21 audited attempts for 21 ingestible fixture messages; the SOS replayed ten times is stored once with ten `DUPLICATE_REJECTED`. AC-01 waits for the station path; AC-02's single incident waits for incidents 2.3
  - _Requirements: REQ-UBI-01, REQ-UBI-02, REQ-UBI-04, REQ-EVT-06, REQ-ERR-02, AC-01, AC-02, FR-EVT-01, FR-EVT-11, BR-11_
  - _Story: US-UC26_
- [ ] 2.3 Positions, projection, incident hand-off (owner KhoaDD)
  - **Do**: outside `monitoring.positionBounds` or WGS-84: keep without position (`INVALID_POSITION`); faster than `monitoring.maxPlausibleSpeedKmh` from the last plotted: keep with `plotted = false`, no projection (`IMPLAUSIBLE_POSITION`); `DevicesService.projectReading` in the same transaction; SOS and fall SOS call `IncidentsService.onSos`, positions call `onPosition`, passing the attribution; set `incidentId` on the event when it joined an episode
  - **Test**: both position rules; an SOS creates one incident inside the ingestion transaction
  - **Progress**: both position rules and the projection are built. The speed rule compares occurrence times with the last plotted position in `seq` order. Attribution followed on 2026-10-27 (task 2.4). The incidents hand-off followed on 2026-10-29 (MF-03 PR): an SOS or fall SOS calls `IncidentIngress.onSos` and a plotted position calls `onPosition`, in the ingestion transaction, and the event's `incidentId` is set when it opened or joined an episode. An SOS text carries no position (FGT row on SOS PortNums), so the incident's position comes from the position packet
  - _Requirements: REQ-EVT-03, REQ-EVT-04, FR-DEV-06, FR-MON-04, FR-INC-01, FR-INC-02_
  - _Depends on: devices 2.5, incidents 2.3_
- [ ] 2.4 Occurrence time and attribution (owner KhoaDD)
  - **Files**: `attribution.ts`
  - **Do**: time source `STATION_CORRECTED`, then `DEVICE_RTC` within `gatewaySync.deviceTimeMaxAheadSeconds` and `gatewaySync.lateUploadGraceHours`, then `SERVER_RECEIPT`; `ContractsService.custodyAt(deviceId, occurredAt)`; `ATTRIBUTED` only inside an interval, clear of `gatewaySync.attributionMarginSeconds` from its ends and, for a station event, of the station's organization; otherwise `UNATTRIBUTED` with no organization, audited `ACCEPTED_UNATTRIBUTED`, visible to Staff and Admin only
  - **Test**: AC-06 (E02-7 fixture), AC-07, AC-08
  - **Partly done** (2026-10-27, by LongLP for the MF-02 demo in this lane): `IngestionService.ingest` asks `ContractsService.custodyAt(deviceId, occurredAt, gatewaySync.attributionMarginSeconds)` before its transaction (custody changes only at a handover, check-in or loss); inside an interval and clear of the margin the event is `ATTRIBUTED` with `organizationId` and `contractDeviceId`, audited `ACCEPTED`, and `field.position` and `field.telemetry` carry the organization; otherwise `UNATTRIBUTED` and `ACCEPTED_UNATTRIBUTED` as before. Unit-tested; walked on local PGlite with the gateway simulation (every packet of TL-0009 and TL-0010 attributed to ORG-0001). Open: the station organization check (Stage C, task 2.5), `attribution.ts` as its own unit, AC-06 to AC-08 on Postgres
  - _Requirements: REQ-UBI-03, REQ-UBI-06, REQ-EVT-15, REQ-ERR-06, AC-06, AC-07, AC-08, FR-EVT-15, FR-EVT-16, FR-EVT-17, BR-36_
  - _Depends on: rentals 4.5_
- [ ] 2.5 Field Station events and health (owner KhoaDD)
  - **Files**: `station-health.handler.ts`
  - **Do**: refuse a revoked station; accept a device only when the station's organization holds it now or under an interval ended less than `gatewaySync.lateUploadGraceHours` ago (`NOT_RENTED_TO_STATION_ORG`); health messages call `FieldStationsService.recordStationHealth` with depth per tier, oldest retry count, last sync time and version, then emit `fieldStation.synced`; listen to `fieldStation.revoked` and drop that username's messages at once
  - **Test**: AC-04; a health report with an older version makes the station `outdated` (organizations AC-08)
  - **Progress** (2026-10-30, D-078 MF-02 demo chain): the health part only. `StationHealthHandler`
    subscribes `treklink/fs/+/health` alongside the node topic, parses the `treklink.fs_health` payload
    (schema and version checked), drops an unparseable report, an unknown username or a revoked station
    with no audit row (a health report is not an ingestion attempt), and calls
    `FieldStationsService.recordStationHealth` with the depth per tier, oldest attempts, version and the
    clock-corrected last flush (`FieldStation.lastFlushAt`, same offset as `fs_captured_at`, D-040).
    Open: the `fieldStation.synced` emit, the `fieldStation.revoked` listener, and the whole Field
    Station event path (device acceptance, `NOT_RENTED_TO_STATION_ORG`) of this task, which belongs to
    the station adapter of task 2.1
  - _Requirements: REQ-EVT-05, REQ-EVT-08, AC-04, FR-EVT-13, FR-EVT-14, FR-EVT-18_
  - _Story: US-UC42_
- [ ] 2.6 Device queue reports (owner KhoaDD)
  - **Do**: a `treklink_queue_health` report stores a `DeviceQueueReport` and never a field event; non-zero total depth marks the device buffering; a counter lower than the previous report sets `rebootDetected`
  - **Test**: a reboot sequence never yields negative traffic
  - _Requirements: REQ-EVT-12, REQ-EVT-13, REQ-EVT-14, NFR-IF-01, NFR-REL-05_

## Phase 3: Broker

- [ ] 3.1 Broker hooks and mosquitto configuration (owner KhoaDD)
  - **Files**: `broker-hooks.controller.ts`, `docker-compose.yml`, `infra/mosquitto/mosquitto.conf`
  - **Do**: api-design 01 and 02 behind `MQTT_AUTH_HOOK_SECRET` (401 `BROKER_SECRET`); credentials and topics of design §4 (403 `CREDENTIAL_REJECTED`, `TOPIC_DENIED`); go-auth HTTP backend, status mode, `auth_opt_cache true`, auth and ACL cache at most 60 s, `auth_opt_cache_refresh false`
  - **Test**: AC-06 of organizations: a revoked station is refused at its next connection
  - **Progress** (2026-11-01, KhoaDD under D-078): the client side only. The Field Station gateway sends `GATEWAY_FS_USERNAME` and `GATEWAY_FS_SECRET` as the MQTT username and password when both are set and connects without credentials otherwise (`gateway/src/mqtt/mqtt-client.ts` `connectOptions`, tested in `mqtt-client.spec.ts`; design §3 Broker credential). Open: the hooks, the mosquitto configuration and the AC-06 test
  - **Partly done** (2026-11-01, KhoaDD under D-078): `infra/mosquitto/mosquitto.conf`, mounted by `docker-compose.yml`, with open listeners on 1883 and 9001 (websockets) and `persistence true` in `/mosquitto/data/`, so the backend's persistent session survives a broker restart. Without it a 25 s outage stored 0 of about 20 queued readings in 3 of 3 runs; with this file, 20 of 20 in 3 of 3 (Mosquitto 2.0.18, `docs/sessions/2026-11-01-0030-demo-smoke.md`). Open: the go-auth hooks and their settings in this file, and the AC-06 test
  - _Requirements: REQ-EVT-07, FR-EVT-14, D-037_

## Phase 4: API Presentation Layer

- [ ] 4.1 `POST /api/gateway-sync` operation endpoint (owner KhoaDD)
  - **Do**: api-design 03 to 06, operations `listEvents`, `listAudit`, `replayAudit` (a quarantined `UNKNOWN_DEVICE` row re-runs ingestion on its raw message and writes a new audit row; anything else 409 `NOT_REPLAYABLE`), `listQueueReports` (D-027)
  - **Test**: replay after registering the device ingests it once
  - **Progress** (2026-10-30, D-078 MF-02 demo chain): `GatewaySyncController` dispatches `listEvents`
    (api-design 03) and `syncStatus`, a new op added by this chain for the demo's sync status page
    (api-design 07, `FieldEventQueryService`, `SyncStatusService`). `syncStatus` needs `read FieldEvent`
    (the route's gate) and `read FieldStation` (checked in the handler); no new permission, both
    already STAFF-held. Open: `listAudit`, `replayAudit`, `listQueueReports`
  - **Partly done** (2026-11-01, KhoaDD under D-078): `listAudit` (api-design 04) dispatched to the new `SyncAuditService`: the sync audit newest first (`createdAt`, then `id`), filters by outcome, device, uplink key and time, pages of 100 by default and at most 500, the asset tag per row, and the raw payload of a `MALFORMED_ENVELOPE` row only, cut to 500 Unicode code points (`rawExcerpt`, `rawTruncated`). It needs `read FieldEvent`, so TrekLink Staff reads it as well as Admin (api-design 04 read Admin before; `syncAudit.read`, Admin only, stays in the catalog for no route yet). `syncStatus` (api-design 07) also answers `normalizationFailed` (REQ-ERR-05). Unit-tested; `test/sync-audit.db-spec.ts` passed on a local Postgres 16 (3 tests). The Field data sync page shows both (frontend task 9.5). `test/gateway-sync.e2e-spec.ts` proves both operations answer 403 to an Org Manager and an Org Operator and 200 to Staff and Admin (8 tests). Open: `replayAudit`, `listQueueReports`
  - _Requirements: REQ-EVT-09_
- [ ] 4.2 E2E and replay harness (owner KhoaDD)
  - **Files**: `backend/test/gateway-sync.e2e-spec.ts`, `backend/test/harness/replay.ts`
  - **Do**: every Validation row of api-design 01 to 06; publish fixtures to a real Mosquitto; TC-11 replay
  - **Progress**: `test/harness/replay.ts` (`npm run replay:mqtt`) publishes fixtures at QoS 1 with `--times`, `--now`, `--new-ids` and `--interval`; its unit test runs in the e2e job. Open: `gateway-sync.e2e-spec.ts` with the Validation rows, once the endpoints of api-design 01 to 06 exist (tasks 3.1 and 4.1)
  - _Requirements: AC-01 to AC-08_
- [ ] 4.3 Two-organization isolation and load harness (owner KhoaDD, secondary TanNB)
  - **Files**: `backend/test/harness/load.ts`
  - **Do**: at least two organizations; 20 simulated Field Stations publishing at once; 10 organizations and 50 devices; assert 0 loss, 0 duplicates, 0 cross-organization delivery (D-042)
  - _Requirements: NFR-PERF-02, NFR-PERF-03, NFR-SEC-04_
  - _Story: US-X04_

## Phase 5: Field Station executable (`gateway/`)

- [ ] 5.1 Serial reader, queue, flush, bound, health (owner KhoaDD)
  - **Files**: the existing scaffold `gateway/src/serial/serial-reader.ts`, `queue/priority-queue.ts`, `mqtt/mqtt-client.ts`, `config.ts`, `index.ts`; read them first and bring them to design §3
  - **Do**: decode `FromRadio` into the stock JSON shape; SQLite WAL table `queue(localSeq, tier, eventJson, capturedAt, attempts, flushedAt)`, insert before any network attempt; flush `ORDER BY tier, localSeq LIMIT 50`, QoS 1, add `fs_captured_at` and `fs_sent_at`, set `flushedAt` on PUBACK only; bound `QUEUE_MAX_ROWS` sheds the oldest P3, then P2, never P0 or P1, each shed logged; health every 60 s with depth per tier, oldest attempts and the executable's version; package one executable per OS
  - **Test**: AC-03 (200 events, every P0 before any P2 or P3); kill mid-flush and restart: nothing lost, nothing marked flushed without a PUBACK
  - **Partly done** (2026-10-27, LongLP, for the MF-02 demo): the scaffold now works as the Stage B bridge (D-005). It publishes each queued packet's stock JSON on its node's uplink topic `GATEWAY_MQTT_TOPIC_PREFIX/GATEWAY_MQTT_CHANNEL/<sender>` (`treklink/2/json/LongFast/!de000009`), the topic the backend ingests; the old `treklink/events/priority/<tier>` topic reached no subscriber. A flush runs after every enqueue as well as on connect, one batch at a time in `ORDER BY priority, id`, and a row leaves the queue only on its PUBACK. Simulation mode (`GATEWAY_SERIAL_SIMULATION`, no node on the port) produces positions, telemetry and a periodic SOS for `GATEWAY_SIM_NODES` (`GATEWAY_SIM_INTERVAL_MS`, `GATEWAY_SIM_SOS_EVERY`, start point). The queue creates its folder (#96). Walked on local PGlite with a local broker: 2 SOS, 12 positions and 12 telemetry readings queued with the broker down, flushed SOS first when it came up, all ingested and attributed. Open: the Stage C table and topics (`queue(localSeq, ...)`, `treklink/fs/<username>/...`, `fs_captured_at`, `fs_sent_at`), the serial `FromRadio` decoder, the bound, health and packaging
  - **Partly done** (2026-10-31, KhoaDD under D-078): the bound and the two tests of this task, on the Stage B table (`event_queue`); topics, flush order and removal on PUBACK unchanged. `GATEWAY_QUEUE_MAX_ROWS` (`QUEUE_MAX_ROWS`, default 100000, a whole number from 1 to 10000000, checked at start; requirements §4): an insert past it sheds the oldest P3 row, then the oldest P2, in the insert's SQLite transaction; P0 and P1 are never shed, so with only those left the new row stays and the queue logs the bound exceeded. Each shed is logged with its tier and local id and counted per tier in the queue (`shedByTier()`); the health payload has no shed field and is unchanged. Tests: `queue-bound.spec.ts` (every case, the transaction rollback), `flush-outage.spec.ts` against an in-process aedes broker: AC-03 (200 events across the tiers queued with the broker down, every P0 before any P2 or P3, the whole flush in tier order) and a station process killed while the broker holds the PUBACKs of a half-sent batch (every removed row had its PUBACK, every held row survives, the restart delivers the rest). Found: mqtt.js replays a QoS 1 publish left unacknowledged by a dropped connection before anything the flush sends after the reconnect, so a P2 or P3 in flight at the cut can reach the broker ahead of the outage's P0 (measured by task 5.3); left as it is pending the leader's decision. Open: the Stage C table and topics (`queue(localSeq, ...)`, `treklink/fs/<username>/...`, `fs_captured_at`, `fs_sent_at`), the serial `FromRadio` decoder, packaging
  - **Partly done** (2026-10-31, KhoaDD under D-078): the mqtt.js resend found above is fixed. On every close `GatewayMqttClient` removes the client's unacknowledged publishes (`removeOutgoingMessage`), so the rows they carried, still queued because a row leaves only on its PUBACK, go out again in tier order with the next flush instead of ahead of it; topics and flush order unchanged. Test: `flush-outage.spec.ts` cuts the uplink relay while the broker holds the PUBACKs of a P2 and P3 batch, queues P0 and P1 during the outage, and expects the arrival order P0, P0, P1, P2, P3, P3, P3 (before the fix: P2, P3, P3, P3, P0, P0, P1)
  - _Requirements: REQ-STA-01, REQ-STA-03, REQ-ERR-03, REQ-ERR-04, AC-03, FR-EVT-02, FR-EVT-03, FR-EVT-04, FR-EVT-06, FR-EVT-07, FR-EVT-08, BR-12_
  - _Story: US-UC27_
- [ ] 5.2 Local page and local API (owner KhoaDD)
  - **Do**: `127.0.0.1:4321`, the routes of `field-station-local-page.md`: nodes heard, positions, battery, SOS state, queue depth per tier, uplink state; served with the uplink down
  - **Test**: page and API answer with the network interface down
  - _Requirements: REQ-STA-02, FR-EVT-12, NFR-UI-04_
  - _Story: US-UC28_
- [ ] 5.3 Outage harness and RQ1 measurements (owner KhoaDD)
  - **Do**: scripted outages of 30 s to 30 min, at least 20 trials per condition; report delivery latency, delivery rate and P0 ordering against NFR-REL-01, NFR-REL-02 and NFR-REL-04
  - **Partly done** (2026-10-31, KhoaDD under D-078): the harness, `gateway/test/harness/outage.ts` (`npm --prefix gateway run harness:outage`, README beside it). It runs the gateway's own simulator, queue and MQTT client against a broker (aedes in process, or `--broker`) through a TCP relay that resets the uplink for the outage, the cut at a random point inside a simulator tick, and reports per trial and per condition: delivery of the events generated during the outage (NFR-REL-02, pooled and worst trial), latency of the events generated at least 5 s before the cut or after the backlog drained (NFR-REL-01), and the share of backlog P0 that arrived before any backlog P2 or P3 (NFR-REL-04). Small-scale run on 2026-10-31 (in-process aedes, 2 nodes, 1 s tick, SOS every 3 ticks, 3000 ms reconnect), indicative because under 20 trials: 30 s x3, 390/390 delivered, P0 first 30/30, latency p95 29 ms and max 32 ms, drain 220 to 360 ms; 2 min x3, 1556/1556 delivered, P0 first 120/120, latency p95 25 ms and max 30 ms, drain 915 to 1005 ms; 0 duplicates, 0 shed. Before the cut was randomised, 2 of 6 phase-locked 4.5 s trials put a P0 behind a P2 or P3 that was in flight at the cut (task 5.1, mqtt.js replay). Open: the 20-trial runs per condition from 30 s to 30 min (about 14.7 h, commands in the README), a link that goes silent without a reset, a real Mosquitto and the backend ingestion in the loop
  - **Partly done** (2026-10-31, KhoaDD under D-078): rerun after the mqtt.js resend fix of task 5.1, same small scale and settings, indicative: 30 s x3, 386/386 delivered, P0 first 30/30, latency p95 18 ms and max 24 ms, drain 178 to 214 ms; 2 min x3, 1560/1560 delivered, P0 first 120/120, latency p95 21 ms and max 25 ms, drain 741 to 848 ms; 0 duplicates, 0 shed. New option `--cut-after-tick-ms` cuts right after a tick, the condition of the resend fault: `--outage 4.5 --trials 6 --cut-after-tick-ms 1` put 3 P2 or P3 ahead of the backlog P0 in 4 of 6 trials before the fix (P0 first 4/12, FAIL) and in 0 of 6 after it (12/12); 108/108 delivered in both, and the fixed run counted one duplicate in 4 of 6 trials (a publish whose PUBACK the cut lost, sent again from the queue). Results table in the harness README. Open as before: the 20-trial runs, a silent link, a real Mosquitto and the backend in the loop
  - _Requirements: NFR-REL-01, NFR-REL-02, NFR-REL-04_

## Phase 6: Verification & DoD

- [ ] 6.1 Suite green; lint, boundary check, typecheck clean; `api-design/*.md` matching behaviour; installation guide for organizations (NFR-USE-06) (owner KhoaDD)
