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
  - _Requirements: REQ-UBI-05, design §2_
- [ ] 1.2 Golden fixtures (owner KhoaDD)
  - **Files**: `backend/test/fixtures/mqtt/*.json`
  - **Do**: captured stock JSON from real v2, v3 and v4 devices for text, `SOS - `, `SOS - FALL DETECTED`, position, telemetry and `treklink_queue_health`, per `mqtt-ingress-contract.md` and `queue-health-payload.md`; give the rented devices TL-0009 and TL-0010 of `backend/prisma/seed-demo.ts` the captured node numbers, so a replay lands on contract RC-2026-0001 (platform 1.12)
  - _Requirements: REQ-UBI-05, FR-EVT-10_

## Phase 2: Ingestion

- [ ] 2.1 Adapters and strategies (owner KhoaDD)
  - **Files**: `adapters/node-json.adapter.ts`, `adapters/field-station-json.adapter.ts`, `normalizer/text.strategy.ts`, `position.strategy.ts`, `telemetry.strategy.ts`, `queue-health.strategy.ts`
  - **Do**: adapters translate topic and envelope into the `CanonicalEnvelope`; the station adapter resolves the station through `FieldStationsService.byUsername`; text tests `SOS - FALL DETECTED` before `SOS - `, both P0; a decode failure audits `MALFORMED_ENVELOPE` and continues; a throwing strategy audits `NORMALIZATION_FAILED` for that packet only
  - **Test**: every fixture of 1.2; the fall prefix; AC-05
  - _Requirements: REQ-EVT-01, REQ-EVT-02, REQ-ERR-01, REQ-ERR-05, AC-05, FR-EVT-05, FR-EVT-09_
  - _Story: US-UC26_
- [ ] 2.2 `IngestionService.ingest(envelope)` (owner KhoaDD)
  - **Files**: `backend/src/modules/gateway-sync/ingestion.service.ts`, `ingestion.repository.ts`
  - **Do**: the five steps of design §2: `eventId = sha256(from + ":" + id)` lower-case hex; resolve the device by `nodeNum` (`UNKNOWN_DEVICE`); `INSERT ... ON CONFLICT (eventId) DO NOTHING` (`DUPLICATE_REJECTED`, nothing else changes); one audit row per attempt; `rx_time` 0 stored as unknown; ordering by queue sequence and priority only; post-commit `field.position` and `field.telemetry`
  - **Test**: AC-01 (node uplink and station deliver the same packet, stored once); AC-02 replay ten times
  - _Requirements: REQ-UBI-01, REQ-UBI-02, REQ-UBI-04, REQ-EVT-06, REQ-ERR-02, AC-01, AC-02, FR-EVT-01, FR-EVT-11, BR-11_
  - _Story: US-UC26_
- [ ] 2.3 Positions, projection, incident hand-off (owner KhoaDD)
  - **Do**: outside `monitoring.positionBounds` or WGS-84: keep without position (`INVALID_POSITION`); faster than `monitoring.maxPlausibleSpeedKmh` from the last plotted: keep with `plotted = false`, no projection (`IMPLAUSIBLE_POSITION`); `DevicesService.projectReading` in the same transaction; SOS and fall SOS call `IncidentsService.onSos`, positions call `onPosition`, passing the attribution; set `incidentId` on the event when it joined an episode
  - **Test**: both position rules; an SOS creates one incident inside the ingestion transaction
  - _Requirements: REQ-EVT-03, REQ-EVT-04, FR-DEV-06, FR-MON-04, FR-INC-01, FR-INC-02_
  - _Depends on: devices 2.5, incidents 2.3_
- [ ] 2.4 Occurrence time and attribution (owner KhoaDD)
  - **Files**: `attribution.ts`
  - **Do**: time source `STATION_CORRECTED`, then `DEVICE_RTC` within `gatewaySync.deviceTimeMaxAheadSeconds` and `gatewaySync.lateUploadGraceHours`, then `SERVER_RECEIPT`; `ContractsService.custodyAt(deviceId, occurredAt)`; `ATTRIBUTED` only inside an interval, clear of `gatewaySync.attributionMarginSeconds` from its ends and, for a station event, of the station's organization; otherwise `UNATTRIBUTED` with no organization, audited `ACCEPTED_UNATTRIBUTED`, visible to Staff and Admin only
  - **Test**: AC-06 (E02-7 fixture), AC-07, AC-08
  - _Requirements: REQ-UBI-03, REQ-UBI-06, REQ-EVT-15, REQ-ERR-06, AC-06, AC-07, AC-08, FR-EVT-15, FR-EVT-16, FR-EVT-17, BR-36_
  - _Depends on: rentals 4.5_
- [ ] 2.5 Field Station events and health (owner KhoaDD)
  - **Files**: `station-health.handler.ts`
  - **Do**: refuse a revoked station; accept a device only when the station's organization holds it now or under an interval ended less than `gatewaySync.lateUploadGraceHours` ago (`NOT_RENTED_TO_STATION_ORG`); health messages call `FieldStationsService.recordStationHealth` with depth per tier, oldest retry count, last sync time and version, then emit `fieldStation.synced`; listen to `fieldStation.revoked` and drop that username's messages at once
  - **Test**: AC-04; a health report with an older version makes the station `outdated` (organizations AC-08)
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
  - _Requirements: REQ-EVT-07, FR-EVT-14, D-037_

## Phase 4: API Presentation Layer

- [ ] 4.1 `POST /api/gateway-sync` operation endpoint (owner KhoaDD)
  - **Do**: api-design 03 to 06, operations `listEvents`, `listAudit`, `replayAudit` (a quarantined `UNKNOWN_DEVICE` row re-runs ingestion on its raw message and writes a new audit row; anything else 409 `NOT_REPLAYABLE`), `listQueueReports` (D-027)
  - **Test**: replay after registering the device ingests it once
  - _Requirements: REQ-EVT-09_
- [ ] 4.2 E2E and replay harness (owner KhoaDD)
  - **Files**: `backend/test/gateway-sync.e2e-spec.ts`, `backend/test/harness/replay.ts`
  - **Do**: every Validation row of api-design 01 to 06; publish fixtures to a real Mosquitto; TC-11 replay
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
  - _Requirements: REQ-STA-01, REQ-STA-03, REQ-ERR-03, REQ-ERR-04, AC-03, FR-EVT-02, FR-EVT-03, FR-EVT-04, FR-EVT-06, FR-EVT-07, FR-EVT-08, BR-12_
  - _Story: US-UC27_
- [ ] 5.2 Local page and local API (owner KhoaDD)
  - **Do**: `127.0.0.1:4321`, the routes of `field-station-local-page.md`: nodes heard, positions, battery, SOS state, queue depth per tier, uplink state; served with the uplink down
  - **Test**: page and API answer with the network interface down
  - _Requirements: REQ-STA-02, FR-EVT-12, NFR-UI-04_
  - _Story: US-UC28_
- [ ] 5.3 Outage harness and RQ1 measurements (owner KhoaDD)
  - **Do**: scripted outages of 30 s to 30 min, at least 20 trials per condition; report delivery latency, delivery rate and P0 ordering against NFR-REL-01, NFR-REL-02 and NFR-REL-04
  - _Requirements: NFR-REL-01, NFR-REL-02, NFR-REL-04_

## Phase 6: Verification & DoD

- [ ] 6.1 Suite green; lint, boundary check, typecheck clean; `api-design/*.md` matching behaviour; installation guide for organizations (NFR-USE-06) (owner KhoaDD)
