# Implementation Tasks: trips

> Approved by: pending (`_handoff/SYNC.md`) · Branch: `feat/module-specs-and-backend-foundation` · Jira: US-023, US-024, US-029, US-037, US-040
>
> Fulfills `design.md`. Tasks resting on Recorded answers are tagged `[Qnn]`; the trip FSM `[Q66]` and the emergency state name (Session 8 question 76) must be confirmed before 2.1.

## Phase 1: Foundation & Domain Modeling

- [ ] 1.1 Prisma models `TrekPackage`, `Trip`, `TripGuideAssignment`, `TripParticipant`, `TripReadinessCheck`, `TripRequest`, `TripStatusHistory`; enums (platform initial migration)
- [ ] 1.2 Check constraints on `"seatsTaken"` and trip window; partial unique indexes on active assignments and single active LEAD; append-only triggers on history and readiness checks
  - _Requirements: REQ-UBI-02, REQ-UBI-03, REQ-EVT-03_
- [ ] 1.3 DTOs, error codes of design §2.5, parameter keys of requirements §4

## Phase 2: Core Service Logic

- [ ] 2.1 `trip-fsm.ts` table with actor sets and guards `[Q66, Q71]`
  - _Requirements: REQ-UBI-01, REQ-ERR-01, AC-05_
- [ ] 2.2 Package CRUD and publish rules
  - _Requirements: FR-TRIP-02, REQ-ERR-05_
- [ ] 2.3 Trip create, update, reschedule through `RESCHEDULE_GUARD` `[Q72]`
  - _Requirements: REQ-EVT-01, REQ-EVT-07, REQ-ERR-03, REQ-ERR-04_
- [ ] 2.4 Guide assignment with overlap test under lock; `guidesSatisfied` `[Q44, Q68]`
  - _Requirements: REQ-EVT-03, REQ-STA-02, REQ-STA-03, AC-02, AC-03_
- [ ] 2.5 Readiness checklist evaluation from the parameter `[Q73]`
  - _Requirements: REQ-EVT-08, REQ-STA-04, AC-04, AC-08_
- [ ] 2.6 Transitions with post-commit `trip.status.changed` (start, finish with missing devices, cancel, emergency) `[Q71, Q72]`
  - _Requirements: REQ-EVT-04, REQ-EVT-05, REQ-EVT-06, REQ-EVT-09_
- [ ] 2.7 `adjustSeats()` with row lock; `assertBookable()`
  - _Requirements: REQ-UBI-03, REQ-STA-01, REQ-ERR-06_
- [ ] 2.8 `SCOPE_PROVIDER` implementation for `auth`
  - _Requirements: REQ-UBI-05_
- [ ] 2.9 Trip requests: create, list, decline, accept through trip creation `[Q65]`
- [ ] 2.10 Scheduler job: `BOOKING_OPEN` to `READY` at `bookingCloseHoursBeforeStart`
- [ ] 2.11 Unit tests for every branch; concurrency test: 20 parallel `adjustSeats(+1)` on the last seat yields one success

## Phase 3: Query / Retrieval

- [ ] 3.1 Public package and trip lists with reduced shape; Staff and Guide lists
  - _Requirements: REQ-UBI-04, AC-01_
- [ ] 3.2 Trip detail with history and readiness; guide availability; participants

## Phase 4: API Presentation Layer

- [ ] 4.1 `PackagesController`, `TripsController`, `GuidesController`, `TripRequestsController` per api-design 01 to 16 (12 composed in `rentals`)
- [ ] 4.2 Swagger annotations
- [ ] 4.3 E2E tests: every Validation row; AC-01 to AC-08

## Phase 5: Frontend Integration

- [ ] 5.1 Public package pages; Staff trip pages; Guide trip pages (tracked in `specs/frontend/tasks.md`)

## Phase 6: End-to-End Verification & DoD Audit

- [ ] 6.1 Tests green; 6.2 lint, boundary check, typecheck clean; 6.3 api-design matches behaviour; 6.4 session file
