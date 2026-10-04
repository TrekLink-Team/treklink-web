# Implementation Tasks: gateway-sync

> Rewritten 2026-10-04 (D-036). Owner: KhoaDD (MF-02). Jira keys assigned when the backlog is regenerated.
> Fulfills `design.md`. Starts after devices Phase 2 and rentals Phase 1; the incident hand-off waits for
> incidents Phase 2.

## Phase 1: Foundation

- [ ] 1.1 `GatewaySyncModule`; MQTT client with QoS 1, persistent session, ack after ingest; `MQTT_HEALTH_PROBE` provider
  - _Requirements: REQ-UBI-05, design §2_
- [ ] 1.2 Golden fixtures from real v2, v3, v4 devices for text, position, telemetry and the queue-health report
  - _Requirements: mqtt-ingress-contract.md_

## Phase 2: Ingestion

- [ ] 2.1 Adapters, canonical envelope, strategies (fall prefix first)
  - _Requirements: REQ-EVT-01, REQ-EVT-02, REQ-ERR-01, REQ-ERR-05_
- [ ] 2.2 `IngestionService.ingest()` with `ON CONFLICT` dedup, audit, renting organization, position rules, projection, incident hand-off, post-commit events
  - _Requirements: REQ-UBI-01 to REQ-UBI-04, REQ-EVT-03, REQ-EVT-04, REQ-EVT-06, REQ-ERR-02, AC-01, AC-02, AC-05_
- [ ] 2.3 Stage C station resolution and the rented-device check; station health handler
  - _Requirements: REQ-EVT-05, REQ-EVT-08, AC-04_
- [ ] 2.4 Queue reports, buffering, reboot detection
  - _Requirements: REQ-EVT-12 to REQ-EVT-14_

## Phase 3: Broker

- [ ] 3.1 Hooks `/api/internal/mqtt/user` and `/acl`; mosquitto go-auth configuration in `docker-compose.yml`
  - _Requirements: REQ-EVT-07, design §4_

## Phase 4: API Presentation Layer

- [ ] 4.1 `POST /api/gateway-sync` operations `listEvents`, `listAudit`, `replayAudit`, `listQueueReports` (D-027)
  - _Requirements: REQ-EVT-09_
- [ ] 4.2 E2E for every Validation row; the replay harness (TC-11)

## Phase 5: Field Station executable

- [ ] 5.1 `gateway/` program: serial reader, SQLite queue, flush, bound, restart safety, health publish; packaging
  - _Requirements: REQ-STA-01 to REQ-STA-03, REQ-ERR-03, REQ-ERR-04, AC-03_
- [ ] 5.2 Local page and local API
  - _Requirements: FR-EVT-12_
- [ ] 5.3 Outage harness and the RQ1 measurements (NFR-REL-01, NFR-REL-02, NFR-REL-04)

## Phase 6: Verification & DoD

- [ ] 6.1 Suite green; lint, boundary check, typecheck clean; `api-design/*.md` matching behaviour; installation guide for organizations (NFR-USE-06)
