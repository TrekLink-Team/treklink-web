# Implementation Tasks: devices

> Rewritten 2026-10-04 (D-036). Owner: LongLP (D-035). Jira keys assigned when the backlog is regenerated.
> Fulfills `design.md`. Starts after auth Phase 4 (policies).

## Phase 1: Foundation & Domain Modeling

- [ ] 1.1 `DevicesModule`; repositories for its nine models
- [ ] 1.2 `DeviceLifecycle` transition table (design §2) with manual and system rows, compare-and-set, transition row
  - _Requirements: REQ-UBI-01, AC-01_
- [ ] 1.3 `nodeId` and `nodeNum` conversion; remaining-value lookup `valueAt()`
  - _Requirements: REQ-EVT-01, FR-BILL-05_

## Phase 2: Core Service Logic

- [ ] 2.1 Variants CRUD with schedule validation and the in-use guards
  - _Requirements: REQ-STA-02_
- [ ] 2.2 Registration and intake checks
  - _Requirements: REQ-EVT-01, REQ-EVT-02, REQ-ERR-01, REQ-ERR-04, AC-03_
- [ ] 2.3 Exported methods for `rentals`: reserve (`SKIP LOCKED`), release, swap failure, provisioning, handover readiness, rented, returned, lost, inspection
  - _Requirements: REQ-EVT-03 to REQ-EVT-05, REQ-EVT-07, REQ-ERR-02, AC-02_
- [ ] 2.4 Reset, maintenance open and close, retire, recover
  - _Requirements: REQ-EVT-06, REQ-EVT-09 to REQ-EVT-11, REQ-ERR-03_
- [ ] 2.5 `projectReading()` for `gateway-sync`
  - _Requirements: REQ-EVT-08_
- [ ] 2.6 Stock-take
  - _Requirements: REQ-EVT-12, AC-04_

## Phase 3: API Presentation Layer

- [ ] 3.1 Controllers for api-design 01 to 17 (`/api/devices/availability` declared before `/:id`)
- [ ] 3.2 E2E for every Validation row; the reservation race against Postgres

## Phase 4: Frontend Integration

- [ ] 4.1 Staff fleet pages: variants, register, intake, maintenance, reset, stock-take (tracked in `specs/frontend/tasks.md`)

## Phase 5: Verification & DoD

- [ ] 5.1 Suite green; lint, boundary check, typecheck clean; `api-design/*.md` matching behaviour
