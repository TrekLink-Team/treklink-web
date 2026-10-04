# Implementation Tasks: billing

> Rewritten 2026-10-04 (D-036). Owner: LongLP (D-035). Jira keys assigned when the backlog is regenerated.
> Fulfills `design.md`. Starts after devices Phase 1.

## Phase 1: Foundation & Domain Modeling

- [ ] 1.1 `BillingModule`; repositories for its six models; invoice number sequence
- [ ] 1.2 Money helpers in integer VND with ceiling rounding
  - _Requirements: REQ-UBI-01_
- [ ] 1.3 Provide `ORGANIZATION_EXIT_CHECKS.canReactivate`

## Phase 2: Core Service Logic

- [ ] 2.1 Price schedule, damage schedule, plan catalogue, quote, snapshot
  - _Requirements: REQ-UBI-05, REQ-EVT-01, AC-01, AC-02_
- [ ] 2.2 Term, day-plan and closing invoices; late, damage, loss charges; cancellation adjustment
  - _Requirements: REQ-EVT-02 to REQ-EVT-07, REQ-EVT-11, REQ-UBI-02, AC-04, AC-05_
- [ ] 2.3 Damage-charge decisions with separation of duty
  - _Requirements: REQ-EVT-06, REQ-ERR-03_
- [ ] 2.4 Balance service for `rentals` and `monitoring`
  - _Requirements: REQ-STA-02_

## Phase 3: Payments

- [ ] 3.1 Counter payments with line application under a row lock
  - _Requirements: REQ-EVT-10, REQ-ERR-04, REQ-ERR-05_
- [ ] 3.2 SePay request and VietQR; webhook with constant-time key check, `@RawResponse()`, dedup on reference and transaction id; expiry job; verify the VietQR URL against the sandbox
  - _Requirements: REQ-EVT-08, REQ-EVT-09, REQ-UBI-03, REQ-UBI-04, REQ-STA-01, REQ-ERR-01, REQ-ERR-02, AC-03_

## Phase 4: API Presentation Layer

- [ ] 4.1 Controllers for api-design 01 to 17
- [ ] 4.2 E2E for every Validation row; webhook replay; tenancy cases

## Phase 5: Frontend Integration

- [ ] 5.1 Plans page; quote in the request form; invoices and payment page with QR and polling; Admin price and damage schedules; damage approval queue (tracked in `specs/frontend/tasks.md`)

## Phase 6: Verification & DoD

- [ ] 6.1 Suite green; lint, boundary check, typecheck clean; `api-design/*.md` matching behaviour
