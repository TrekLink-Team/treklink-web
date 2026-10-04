# Implementation Tasks: monitoring

> Rewritten 2026-10-04 (D-036). Owner: LongNN (MF-04). Jira keys assigned when the backlog is regenerated.
> Fulfills `design.md`. Starts after gateway-sync Phase 2 (events) and rentals Phase 1.

## Phase 1: Foundation

- [ ] 1.1 `MonitoringModule`; `StreamEvent` repository; `LiveGateway` (Socket.io `/live`) with JWT and API-key handshakes and server-assigned rooms
  - _Requirements: REQ-UBI-01, ws-live-contract.md_

## Phase 2: Stream

- [ ] 2.1 Listeners for the domain events; organization resolution cache; throttling; `incident.alert` publishing
  - _Requirements: REQ-EVT-01, REQ-EVT-04, REQ-EVT-07, AC-01, AC-05_
- [ ] 2.2 Replay on connect, `replay.done`, `replay.expired`; REST replay with 410; key revocation closing sockets
  - _Requirements: REQ-EVT-02, REQ-EVT-08, AC-02_
- [ ] 2.3 Staleness sweep and pruning jobs
  - _Requirements: REQ-EVT-03, AC-03_

## Phase 3: Read models

- [ ] 3.1 Map config and snapshot; organization API with the per-key rate limit
  - _Requirements: REQ-UBI-02, REQ-EVT-05, AC-06_
- [ ] 3.2 Clipped telemetry history; device history; reports with CSV; system health
  - _Requirements: REQ-EVT-06, REQ-ERR-02, FR-DEV-11, FR-BILL-10, FR-MON-10_

## Phase 4: API Presentation Layer

- [ ] 4.1 Controllers for api-design 01 to 08
- [ ] 4.2 E2E for every Validation row; tenancy cases including the device moving between organizations

## Phase 5: Frontend Integration

- [ ] 5.1 Live map widget with the overlay, stale and incident markers, reconnect banner, map error state (tracked in `specs/frontend/tasks.md`)

## Phase 6: Verification & DoD

- [ ] 6.1 Suite green; lint, boundary check, typecheck clean; `api-design/*.md` matching behaviour
