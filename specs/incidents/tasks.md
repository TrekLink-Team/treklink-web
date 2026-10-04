# Implementation Tasks: incidents

> Rewritten 2026-10-04 (D-036). Owner: HoangTK (MF-03); KhoaDD co-owns the lifecycle (D-034). Jira keys
> assigned when the backlog is regenerated. Fulfills `design.md`. Starts after rentals Phase 1 and
> organizations Phase 2 (roster).

## Phase 1: Foundation & Domain Modeling

- [ ] 1.1 `IncidentsModule`; repositories for its five models; incident code sequence
- [ ] 1.2 `IncidentLifecycle` table (design §2) with guards, compare-and-set, sequenced transition rows, timer columns
  - _Requirements: REQ-UBI-01, REQ-UBI-03, REQ-ERR-01, AC-06_
- [ ] 1.3 Provide `CONTRACT_CLOSE_CHECKS`
  - _Requirements: REQ-STA-02_

## Phase 2: Creation and routing

- [ ] 2.1 `IncidentIngress.onSos` and `onPosition`: correlation, cadence, routing with empty-tier skipping
  - _Requirements: REQ-UBI-02, REQ-UBI-05, REQ-EVT-01 to REQ-EVT-03, REQ-EVT-10, AC-01, AC-05_

## Phase 3: Timers and outbox

- [ ] 3.1 Outbox rows per transition (design §3) and the dispatcher with backoff
  - _Requirements: REQ-UBI-04, REQ-EVT-13, AC-07_
- [ ] 3.2 Jobs: tier timeouts, stale responses, close after the reopen window; restart resume
  - _Requirements: REQ-EVT-04, REQ-EVT-07, REQ-EVT-10, REQ-ERR-04, AC-02_

## Phase 4: Human actions

- [ ] 4.1 Acknowledge, responding, status updates, resolve, false alarm, owner deactivation
  - _Requirements: REQ-EVT-05 to REQ-EVT-08, REQ-EVT-11, REQ-ERR-02, AC-03_
- [ ] 4.2 Authority reports on incidents and on defaulted contracts; case close
  - _Requirements: REQ-EVT-09, AC-04_
- [ ] 4.3 Stale flag from the sweep
  - _Requirements: REQ-EVT-12_

## Phase 5: API Presentation Layer

- [ ] 5.1 Controllers for api-design 01 to 14
- [ ] 5.2 E2E for every Validation row; replay ×10 (TC-11); tenancy cases

## Phase 6: Frontend Integration

- [ ] 6.1 Alert banner (MSG31), incident queue and detail with one-step acknowledge, status and outcome forms, Staff escalation queue and authority report form (tracked in `specs/frontend/tasks.md`)

## Phase 7: Verification & DoD

- [ ] 7.1 Suite green; lint, boundary check, typecheck clean; `api-design/*.md` matching behaviour
