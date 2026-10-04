# Implementation Tasks: rentals

> Rewritten 2026-10-04 (D-036). Owners: TanNB (Phases 1 to 3, MF-01), LongLP (Phases 4 and 5, MF-05).
> The unmerged booking-state rename migration is obsolete (D-036). Jira keys assigned when the backlog is
> regenerated. Fulfills `design.md`. Starts after organizations Phase 2, devices Phase 2 and billing Phase 2.

## Phase 1: Foundation & Domain Modeling

- [ ] 1.1 `RentalsModule`; repositories for its four models; contract code sequence
- [ ] 1.2 `ContractLifecycle` table (design §2) with compare-and-set and transition rows
  - _Requirements: REQ-UBI-01_
- [ ] 1.3 Declare `CONTRACT_CLOSE_CHECKS`; provide `ORGANIZATION_EXIT_CHECKS.canClose`

## Phase 2: Request to approval (TanNB)

- [ ] 2.1 Request with price snapshot from `billing` and the organization guard
  - _Requirements: REQ-EVT-01, REQ-UBI-04, REQ-ERR-02, REQ-ERR-03_
- [ ] 2.2 Approve with `DevicesService.reserve` and the first invoice in one transaction; reject; cancel with release and `billing.settleCancellation`
  - _Requirements: REQ-EVT-02, REQ-EVT-03, REQ-UBI-02, REQ-ERR-01, AC-01_

## Phase 3: Handover (TanNB)

- [ ] 3.1 Provisioning record, swap, handover note preview and signed PDF with SHA-256, `complete()`
  - _Requirements: REQ-EVT-04 to REQ-EVT-06, REQ-UBI-05, REQ-ERR-04, AC-02_
- [ ] 3.2 Holder labels and their events
  - _Requirements: REQ-EVT-15_

## Phase 4: Terms and end of contract (LongLP)

- [ ] 4.1 Term rollover job, notice, day-plan end
  - _Requirements: REQ-EVT-07 to REQ-EVT-09, AC-03_
- [ ] 4.2 Overdue and default job with organization suspension; reservation reminders
  - _Requirements: REQ-EVT-13, REQ-EVT-14, AC-05_

## Phase 5: Return and close (LongLP)

- [ ] 5.1 Check-in with late charges; inspection orchestration with damage; loss
  - _Requirements: REQ-EVT-10 to REQ-EVT-12, REQ-STA-01, REQ-ERR-07, AC-04_
- [ ] 5.2 Close with balance and incident checks; label erasure
  - _Requirements: REQ-ERR-05, REQ-EVT-15, AC-06, AC-07_

## Phase 6: API Presentation Layer

- [ ] 6.1 Controllers for api-design 01 to 18
- [ ] 6.2 E2E for every Validation row; tenancy cases

## Phase 7: Frontend Integration

- [ ] 7.1 Manager: request with quote, contracts, notice, holder labels; Staff: approval queue, counter handover with signature pad, check-in by scan, inspection (tracked in `specs/frontend/tasks.md`)

## Phase 8: Verification & DoD

- [ ] 8.1 Suite green; lint, boundary check, typecheck clean; `api-design/*.md` matching behaviour
