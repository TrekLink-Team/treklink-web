# Implementation Tasks: incidents

> Approved by: pending (`_handoff/SYNC.md`) · Branch: `feat/module-specs-and-backend-foundation` · Jira: US-054, US-057 to US-064, US-066, US-072, US-088
>
> Fulfills `design.md`. MF-03 is "in progress" at Review 2 (roadmap W7): Phases 1 to 3 are the Review 2 target, the rest follows. Blocked on C-003 for the reopen target state and escalation timeout.

## Phase 1: Foundation & Domain Modeling

- [ ] 1.1 Prisma `Incident`, `IncidentAudit` and enums of design §1 (platform initial migration); drop the stale `eventId @unique`; audit relation `onDelete: Restrict`
  - _Requirements: REQ-UBI-01, REQ-UBI-03, D-006_
- [ ] 1.2 Append-only trigger on `incident_audits`; unique `(incidentId, seq)`
  - _Requirements: BR-11, AC-09_
- [ ] 1.3 DTOs, error codes of design §2.6, parameter keys of requirements §4

## Phase 2: Core Service Logic

- [ ] 2.1 `incident-fsm.ts` table of design §2.1
  - _Requirements: REQ-UBI-01, REQ-ERR-04, BR-10_
- [ ] 2.2 `correlateSos`, `appendBeacon`, `raiseSuspected` with the per-device advisory lock, window lookup on `lastEventAt`, reopen and upgrade
  - _Requirements: REQ-EVT-01 to REQ-EVT-03, REQ-EVT-06, REQ-UBI-05, AC-01 to AC-04, AC-06_
- [ ] 2.3 Trip attachment through `RentalsService.findActiveAssignmentForDevice`; unassigned path
  - _Requirements: REQ-EVT-04, AC-07_
- [ ] 2.4 Acknowledge with conditional update and winner in the 409
  - _Requirements: REQ-EVT-07, REQ-ERR-01, AC-05_
- [ ] 2.5 Transitions with `expectedVersion`, notes, dismissal and suppression, manual create
  - _Requirements: REQ-EVT-08 to REQ-EVT-11, REQ-ERR-02, REQ-ERR-05_
- [ ] 2.6 Post-commit domain events `incident.opened`, `incident.updated`, `incident.escalated`
  - _Requirements: REQ-EVT-05, REQ-ERR-06_
- [ ] 2.7 Escalation job on the platform scheduler
  - _Requirements: REQ-STA-01, AC-08_
- [ ] 2.8 Unit tests: every FSM edge and non-edge, correlation branches, suppression window
- [ ] 2.9 Concurrency tests against Docker Postgres: 20 concurrent packets of one episode yield one Incident (AC-03); simultaneous acknowledgements (AC-05)

## Phase 3: Query / Retrieval

- [ ] 3.1 Queue list with ordering, Guide scope, `updatedSince` reconciliation
- [ ] 3.2 Detail with audit trail and allowed actions
- [ ] 3.3 Metrics with `percentile_cont`
  - _Requirements: AC-11, RQ3_

## Phase 4: API Presentation Layer

- [ ] 4.1 `IncidentsController` per api-design 01 to 08; declare `GET /metrics` before `GET /:id` so the literal route wins
- [ ] 4.2 Swagger annotations
- [ ] 4.3 E2E tests: every Validation row; AC-01 to AC-11; AC-10 (Admin without Operator gets 403)

## Phase 5: Frontend Integration

- [ ] 5.1 Incident queue widget, acknowledge button, incident detail with both timelines (tracked in `specs/frontend/tasks.md`)

## Phase 6: End-to-End Verification & DoD Audit

- [ ] 6.1 Tests green; 6.2 lint, boundary check, typecheck clean; 6.3 api-design matches behaviour; 6.4 session file
- [ ] 6.5 The 10x replay demonstration rehearsed end to end with `gateway-sync` (D-016 demo obligation)
