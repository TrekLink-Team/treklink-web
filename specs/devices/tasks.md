# Implementation Tasks: devices

> Rewritten 2026-10-04 (D-036); loss cases and disposal (D-045) and periodic maintenance (D-047) added
> 2026-10-14. Owner: LongLP (D-035). Jira keys assigned when the backlog is regenerated.
> Fulfills `design.md`. Starts after auth Phase 4 (policies).

## Phase 1: Foundation & Domain Modeling

- [ ] 1.1 `DevicesModule`; `DevicesRepository`, `LossCasesRepository` and `MaintenanceRepository` over its eleven models
- [ ] 1.2 `DeviceLifecycle` transition table (design §2) with manual and system rows, compare-and-set, transition row
  - _Requirements: REQ-UBI-01, AC-01_
- [ ] 1.3 `nodeId` and `nodeNum` conversion; remaining-value lookup `valueAt()`
  - _Requirements: REQ-EVT-01, FR-BILL-05_

## Phase 2: Core Service Logic

- [ ] 2.1 Variants CRUD with schedule and service-plan validation and the in-use guards
  - _Requirements: REQ-STA-02, REQ-ERR-10_
- [ ] 2.2 Registration and intake checks; first `serviceDueAt` on the first pass
  - _Requirements: REQ-EVT-01, REQ-EVT-02, REQ-EVT-18, REQ-ERR-01, REQ-ERR-04, AC-03_
- [ ] 2.3 Exported methods for `rentals`: reserve (`SKIP LOCKED`), release, swap failure, provisioning, handover readiness, rented, returned, lost, inspection
  - _Requirements: REQ-EVT-03 to REQ-EVT-05, REQ-EVT-07, REQ-ERR-02, AC-02, AC-10_
- [ ] 2.4 Reset, retire, recover
  - _Requirements: REQ-EVT-06, REQ-EVT-10, REQ-EVT-11, REQ-ERR-03_
- [ ] 2.5 `projectReading()` for `gateway-sync`
  - _Requirements: REQ-EVT-08_
- [ ] 2.6 Stock-take
  - _Requirements: REQ-EVT-12, AC-04_
- [ ] 2.7 Loss cases: report, triage by custody, recover, confirm, settle; the `devices.lossSearch` job; disposal
  - _Requirements: REQ-EVT-13 to REQ-EVT-17, REQ-ERR-05 to REQ-ERR-07, AC-05 to AC-08_
- [ ] 2.8 `MaintenanceService`: open, estimate, decide, complete, `isDue()`; the `devices.serviceScan` job and the Staff email
  - _Requirements: REQ-EVT-09, REQ-EVT-18 to REQ-EVT-22, REQ-STA-03, REQ-STA-04, REQ-ERR-08, REQ-ERR-09, AC-09 to AC-12_

## Phase 3: API Presentation Layer

- [ ] 3.1 Controllers for api-design 01 to 26 (`/api/devices/availability` declared before `/:id`)
- [ ] 3.2 E2E for every Validation row; the reservation race and the four maintenance constraints against Postgres

## Phase 4: Frontend Integration

- [ ] 4.1 Staff fleet pages: variants with service plans, register, intake, maintenance with the week's list, Admin cost approvals, reset, loss cases, stock-take (tracked in `specs/frontend/tasks.md`)

## Phase 5: Verification & DoD

- [ ] 5.1 Suite green; lint, boundary check, typecheck clean; `api-design/*.md` matching behaviour
