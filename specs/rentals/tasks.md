# Implementation Tasks: rentals

> Approved by: pending (`_handoff/SYNC.md`) · Branch: `feat/module-specs-and-backend-foundation` · Jira: US-025 to US-028, US-030 to US-034, US-039
>
> Fulfills `design.md`. Blocked on C-003 answers for payment timing (Q60 versus MF-05), reserve-before-confirm ordering, loss handling and PDF storage. Tasks resting on Recorded answers are tagged `[Qnn]`.

## Phase 1: Foundation & Domain Modeling

- [ ] 1.1 Prisma models `Booking`, `DeviceAllocation`, `Rental`, `RentalItem`, `RentalAgreement`, `HandoverCheck`, `ReturnInspection`, `BookingStatusHistory`, `RentalStatusHistory`; enums (platform initial migration)
- [ ] 1.2 Raw SQL in the migration: `btree_gist`, exclusion constraint `no_double_allocation`, append-only triggers on history, handover and inspection tables
  - _Requirements: REQ-UBI-01, BR-01_
- [ ] 1.3 DTOs, error codes of design §2.6, parameter keys of requirements §4

## Phase 2: Core Service Logic

- [ ] 2.1 `booking-fsm.ts` and `rental-fsm.ts` tables `[Q56]`
  - _Requirements: REQ-UBI-03_
- [ ] 2.2 Booking create with seats through `TripsService.adjustSeats` and participants
  - _Requirements: REQ-EVT-01, REQ-EVT-02 `[Q55, Q57]`_
- [ ] 2.3 Reservation algorithm of design §2.3 with `SKIP LOCKED`, window widening, retry on exclusion violation `[Q53, Q58, Q59]`
  - _Requirements: REQ-EVT-03, REQ-ERR-01, REQ-ERR-02, REQ-ERR-03_
- [ ] 2.4 Hold expiry job and escrow-paid handler (`payment.succeeded`) `[Q59, Q60]`
  - _Requirements: REQ-EVT-04, REQ-EVT-05, AC-02_
- [ ] 2.5 Confirm, reject, cancel (with billing refund), hold changes
  - _Requirements: REQ-EVT-06 to REQ-EVT-09, REQ-ERR-04, REQ-ERR-05, REQ-ERR-07, REQ-ERR-08_
- [ ] 2.6 Direct rental creation; item allocation and replacement
  - _Requirements: REQ-EVT-10, REQ-EVT-11_
- [ ] 2.7 `AgreementService`: PDF render and signature embedding with hashing (`pdfkit`, dependency approval in C-003) `[Q62]`
  - _Requirements: REQ-EVT-12, REQ-EVT-13, REQ-UBI-06_
- [ ] 2.8 Check-out, all-or-nothing, with `devices` eligibility
  - _Requirements: REQ-EVT-14, REQ-STA-03, REQ-ERR-06, AC-06_
- [ ] 2.9 Handover check with `devices.minHandoverBatteryPct` `[Q52]`
  - _Requirements: REQ-EVT-15, AC-05_
- [ ] 2.10 `trip.status.changed` handler: `IN_FIELD` on start, `MISSING_REPORTED` on finish, cascade on cancel `[Q48, Q71, Q72]`
  - _Requirements: REQ-EVT-16, REQ-EVT-17_
- [ ] 2.11 Check-in, inspection, loss confirmation
  - _Requirements: REQ-EVT-18 to REQ-EVT-20_
- [ ] 2.12 Settlement hand-off and close with `billing`
  - _Requirements: REQ-EVT-21, REQ-EVT-22, REQ-STA-05, AC-09_
- [ ] 2.13 Overdue and loss-suspected jobs
  - _Requirements: REQ-STA-01, REQ-STA-02_
- [ ] 2.14 `RESCHEDULE_GUARD` implementation for `trips`; `allocatedDeviceIds`, `findActiveAssignmentForDevice`, `devicesForTrip` exports
- [ ] 2.15 Unit tests: every FSM edge and non-edge; reservation algorithm branches; fee-free paths
- [ ] 2.16 Concurrency tests against Docker Postgres: 20 parallel reservations for the last device (AC-01); 20 parallel check-outs of one rental

## Phase 3: Query / Retrieval

- [ ] 3.1 Booking and rental lists with scope and blockers; details
- [ ] 3.2 Availability count and trip participants routes served here (devices 13, trips 12)

## Phase 4: API Presentation Layer

- [ ] 4.1 `BookingsController`, `RentalsController`, `AvailabilityController` per api-design 01 to 23
- [ ] 4.2 Swagger annotations
- [ ] 4.3 E2E tests: every Validation row; AC-01 to AC-10

## Phase 5: Frontend Integration

- [ ] 5.1 Booking wizard with hold countdown, bookings queue, rental detail, check-out wizard, handover check, inspection form, signature pad (tracked in `specs/frontend/tasks.md`)

## Phase 6: End-to-End Verification & DoD Audit

- [ ] 6.1 Tests green; 6.2 lint, boundary check, typecheck clean; 6.3 api-design matches behaviour; 6.4 session file
- [ ] 6.5 MF-01 demo script rehearsed with seed data (`05-main-flows.md` demo discipline)
