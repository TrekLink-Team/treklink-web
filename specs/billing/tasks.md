# Implementation Tasks: billing

> Approved by: pending (`_handoff/SYNC.md`) · Branch: `feat/module-specs-and-backend-foundation` · Jira: US-031, US-035, US-036, US-067 to US-070
>
> Fulfills `design.md`. MF-05 is "specified" at Review 2. The escrow and quote parts (Phase 2.1 to 2.4) are needed by MF-01 if C-003 keeps escrow at booking, and then move ahead of the rest.

## Phase 1: Foundation & Domain Modeling

- [ ] 1.1 Prisma `PricingRule`, `DamageFeeRule`, `Invoice`, `InvoiceLine`, `Payment`, `FeeWaiver` and enums (platform initial migration); invoice number sequence
- [ ] 1.2 Append-only triggers on `invoice_lines` and `payments`; unique `idempotencyKey`
  - _Requirements: REQ-UBI-05, REQ-UBI-06_
- [ ] 1.3 Money helper on `Prisma.Decimal` with whole-đồng half-up rounding; a lint rule forbidding `number` arithmetic in `billing/`
  - _Requirements: REQ-UBI-02_
- [ ] 1.4 Seed illustrative rules and a damage schedule, labelled as demo values
- [ ] 1.5 DTOs, error codes of design §2.6, parameter keys of requirements §4

## Phase 2: Core Service Logic

- [ ] 2.1 Rule selection of design §2.1 and overlap guard `[Q61, Q63]`
  - _Requirements: REQ-EVT-01, REQ-ERR-01, REQ-ERR-02, AC-01_
- [ ] 2.2 Quotes; escrow invoices; `payment.succeeded` `[Q60]`
  - _Requirements: REQ-EVT-02, REQ-EVT-03_
- [ ] 2.3 Cancellation settlement and escrow refund `[Q60]`
  - _Requirements: REQ-EVT-04, AC-02_
- [ ] 2.4 `SandboxPaymentAdapter` with failure rate and forced decline; idempotent payments
  - _Requirements: REQ-UBI-04, REQ-UBI-06, REQ-EVT-09, REQ-EVT-10, REQ-STA-03, REQ-ERR-04, REQ-ERR-05, AC-05, AC-07_
- [ ] 2.5 Settlement computation of design §2.2
  - _Requirements: REQ-EVT-05 to REQ-EVT-08, REQ-ERR-06, AC-03, AC-04_
- [ ] 2.6 Waivers with separation of duty and adjustment invoices
  - _Requirements: REQ-EVT-11, REQ-ERR-03, AC-06_
- [ ] 2.7 `isSettled`, `depositsFor` exports
  - _Requirements: REQ-STA-01_
- [ ] 2.8 Unit tests: every rule-ranking branch, late-fee day boundaries, deposit above and below fees, rounding, idempotency replay and key reuse

## Phase 3: Query / Retrieval

- [ ] 3.1 Invoice list and detail with scope and the `outstanding` filter

## Phase 4: API Presentation Layer

- [ ] 4.1 `PricingController`, `QuotesController`, `InvoicesController`, `PaymentsController`, `WaiversController` per api-design 01 to 11
- [ ] 4.2 E2E: every Validation row; AC-01 to AC-07

## Phase 5: Frontend Integration

- [ ] 5.1 Pricing admin, quote in the booking wizard, invoices, sandbox pay dialog, settlement panel (tracked in `specs/frontend/tasks.md`)

## Phase 6: End-to-End Verification & DoD Audit

- [ ] 6.1 Tests green; 6.2 lint, boundary check, typecheck clean; 6.3 api-design matches behaviour; 6.4 session file
- [ ] 6.5 Reports US-071 to US-074 scheduled as a follow-up spec once MF-05 core is demo-ready
