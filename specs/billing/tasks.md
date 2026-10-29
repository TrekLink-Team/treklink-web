# Implementation Tasks: billing

> Rewritten 2026-10-18 (D-051) in the full task format of `specs/README.md` §6; adds the loss charge and
> its adjustment (FR-BILL-05, FR-BILL-11, D-045) through the `devices` port `LOSS_CASE_LISTENERS`.
> Fulfills `design.md`; endpoints are `api-design/01` to `17`. Reports (FR-BILL-10) are `monitoring`.

| | |
|---|---|
| Lane owner | LongLP (roadmap §5.1) |
| Reviewer | KhoaDD |
| Sprint | 3 (W7 to W8) for prices, term invoices, payments (MF-01); 5 (W11) for late, damage and loss charges (MF-05) |
| Stories | US-UC19, US-UC22, US-UC45, US-UC46, US-UC47, US-UC48, US-UC56, US-UC60 (charge side) |
| Depends on | platform 2.5 to 2.10; auth 4.2; organizations 1.3; devices 1.3 (`valueAt`) and 1.4 (port) |
| Unblocks | rentals 2.1 (snapshot), 2.2 (invoices), 2.4 (first payment), 4.1 and 4.2 (charges) |

## Phase 1: Foundation & Domain Modeling

- [ ] 1.1 `BillingModule` and repositories (owner LongLP)
  - **Files**: `backend/src/modules/billing/billing.module.ts`, `pricing.repository.ts`, `invoices.repository.ts`, `payments.repository.ts`
  - **Do**: repositories over the `// @module billing` models only; invoice number `INV-<year>-<6 digits>` as the `schema.prisma` example `INV-2026-000123`
  - _Requirements: NFR-MNT-01_
  - **Partly done** (Jira card pending, treklink-docs#114 point 4): `BillingModule` and `invoices.repository.ts` with `INV-<year>-NNNNNN` under a per-year advisory lock (the year in UTC+7, a range error past 999999). `payments.repository.ts` with the counter payment of 3.1. `pricing.repository.ts` waits on points 1 and 2 of treklink-docs#114.
- [x] 1.2 Money helpers (owner LongLP)
  - **Files**: `backend/src/modules/billing/money.ts`
  - **Do**: integer VND only; `ceilVnd(x)` rounds each line up to the whole đồng; no floating amount is stored
  - **Test**: the AC-01 and AC-02 figures; ratio 0.5 of an odd amount rounds up
  - _Requirements: REQ-UBI-01, BR-29_
  - **Done**: also `termFeeVnd`, `holdingFeeVnd` and `dayPlanFeeVnd`; the day-plan division runs last, so a whole fee stays exact
- [ ] 1.3 Provide `ORGANIZATION_EXIT_CHECKS.canReactivate` (owner LongLP)
  - **Do**: any unpaid line or pending damage charge of the organization returns `BALANCE_OUTSTANDING`
  - **Test**: reactivation refused with one unpaid line
  - _Requirements: design §4, FR-ORG-07_

## Phase 2: Core Service Logic

- [x] 2.1 Prices, damage rates, plans, quotes, snapshot (owner LongLP)
  - **Files**: `backend/src/modules/billing/pricing.service.ts`
  - **Do**: price schedule append-only, a new row effective from a time not in the past; damage rates per variant with a generic fallback; plan catalogue (public); quote for a variant, plan, quantity and length; `snapshot(variantId)` returns monthly price, `billing.dayPremium` and `billing.holdingFeeRatio`
  - **Test**: a past effective time is refused; the snapshot ignores a price effective tomorrow
  - _Requirements: REQ-UBI-05, REQ-EVT-01, AC-01, AC-02, FR-CFG-02_
  - _Story: US-UC56_
  - **Done**: `PricingService` over a new `PricingRepository` (PriceSchedule, DamageRate) backs api-design 01 to 07; the endpoints are 5.1. `snapshot(variantId, tx?)` reads in the caller's transaction and answers 404 when no price is in effect (no code of its own in design §6). A day-plan length outside `rentals.dayPlanLengths` in a quote is 400 `VALIDATION_FAILED`, the only codes api-design 02 lists besides `BELOW_MOQ`. An unknown variant on a price or damage rate is 404 from the foreign key. `damageRateFor(code, variantId)` gives task 2.5 the variant rate or the generic fallback. The catalogue returns prices by variant id: the variant code, name and active flag of api-design 01 belong to `devices`, which has no variant read yet, so 5.1 joins them once it does. The "ignores tomorrow's price" case is the `effectiveFrom <= at` query, unit-tested; a test:db case waits for PGlite here
- [x] 2.2 Term and day-plan invoices (owner LongLP)
  - **Files**: `backend/src/modules/billing/invoices.service.ts`
  - **Do**: `issueTermInvoice(contract, term, tx)`: one `TERM` invoice, `HOLDING_FEE` line due at the term start and `TERM_BALANCE` due at the term end; `issueDayPlanInvoice(contract, tx)`: one `DAY_PLAN_FEE` line due at the start date; issued lines never change
  - **Test**: AC-01 and AC-02
  - _Requirements: REQ-EVT-02, REQ-EVT-03, REQ-UBI-02, FR-BILL-01, FR-BILL-02, BR-06, BR-07_
  - **Done** (Jira card pending): the inputs are billing's `BillableMonthlyContract`, `BillableTerm` and `BillableDayPlan`, filled by `rentals` from its snapshot and term, with the variant code for the line description; the day plan carries its `termId` and anchored `startsAt`. The balance line takes the remainder of the rounded-up holding fee; a line keeps the device count only when the amount divides by it
- [x] 2.3 Cancellation adjustment (owner LongLP)
  - **Do**: `ChargesService.settleCancellation(contract, tx)` voids the unpaid first-invoice lines with a zero-sum `ADJUSTMENT`, keeping a paid holding fee
  - **Test**: cancel before and after the holding fee is paid
  - _Requirements: REQ-EVT-11, FR-CON-04_
  - **Done** (Jira card pending): as `settleCancellation(contract, actorId, tx)`, `actorId` null for SYSTEM, so the `ADJUSTMENT` carries its author (REQ-UBI-02); one line of minus the unpaid total on the contract's `CLOSING` invoice, created under a per-contract advisory lock when missing; nothing when no invoice was issued yet or nothing is unpaid
- [ ] 2.4 Balance service (owner LongLP)
  - **Files**: `backend/src/modules/billing/balance.service.ts`
  - **Do**: `firstPaymentConfirmed(contractId)`, `outstanding(contractId)` (unpaid lines plus pending damage charges), `balanceSummary(contractId)`, `revenue(range)` for monitoring
  - **Test**: a pending damage charge counts as outstanding
  - _Requirements: REQ-STA-02, FR-CON-13, BR-27_
  - **Partly done** (Jira card pending): `firstPaymentConfirmed`, `outstanding` and `balanceSummary` over the contract's invoice lines, with negative adjustments credited against the oldest-due lines first. Pending damage charges wait on a contract link (`DamageCharge` carries none) and `revenue(range)` per variant on a variant link; both are raised in treklink-docs#114
- [ ] 2.5 Late and damage charges, damage decisions (owner LongLP)
  - **Files**: `backend/src/modules/billing/charges.service.ts`
  - **Do**: `chargeLate(contract, device, checkedInAt, tx)` per started day past `returnDueAt` and the grace, on the `CLOSING` invoice (created on the first charge); `chargeDamage(contract, inspection, tx)` prices each code, `PENDING_APPROVAL` above `billing.damageApprovalThresholdVnd`; a decision by an Admin who did not record the inspection (403 `SEPARATION_OF_DUTY`) approves, reduces or waives, an approved or reduced amount becomes a `DAMAGE` line (MSG30)
  - **Test**: AC-04; three late days on two devices give two lines of three days
  - _Requirements: REQ-EVT-04, REQ-EVT-05, REQ-EVT-06, REQ-ERR-03, AC-04, FR-BILL-03, FR-BILL-04, BR-23, BR-24_
  - _Story: US-UC46, US-UC47, US-UC48_
  - **Partly done**: `chargeLate(contract, device, checkedInAt, actorId, tx)` adds one `LATE_FEE` line per device (quantity the started days after `returnDueAt`, nothing within `rentals.returnGraceHours`); `chargeDamage(contract, inspection, actorId, tx)` prices each code through `PricingService.damageRateFor` into one `DamageCharge` per inspection, `PENDING_APPROVAL` above the threshold, else `APPROVED` at once with its `DAMAGE` line; a code with no active rate is 400 `VALIDATION_FAILED` and records nothing. Both write to the closing invoice through one shared helper, as `settleCancellation` does; `NewInvoiceLine` gains an optional `deviceId`; a new `DamageChargesRepository` owns `DamageCharge`. Both tests pass (AC-04 and the two-device case). Open: the Admin decision (approve, reduce, waive, `SEPARATION_OF_DUTY`), which needs the charge's contract and inspector: `DamageCharge` has no contract column, and the inspector is on the `Inspection` row that `devices` owns (treklink-docs#114)
- [ ] 2.6 Loss charge and adjustment (owner LongLP)
  - **Files**: `charges.service.ts`, `providers/loss-case-listener.provider.ts`
  - **Do**: provide `LOSS_CASE_LISTENERS`: `onConfirmed` for `RENTER` custody calls `chargeLoss(contract, device, confirmedAt, tx)`, a `LOSS` line of `DevicesService.valueAt(device, confirmedAt)` on the closing invoice; `TREKLINK` custody adds nothing; `onSettled` with a reduced or waived decision calls `adjustLoss(...)`, an `ADJUSTMENT` line with the reason and author, never an edit of the `LOSS` line
  - **Test**: AC-05; a waiver leaves the `LOSS` line and adds a negative `ADJUSTMENT` of the same amount
  - _Requirements: REQ-EVT-07, AC-05, FR-BILL-05, FR-BILL-11, BR-25, BR-39_
  - _Story: US-UC60_
  - _Depends on: devices 1.3 and 1.4_

## Phase 3: Payments

- [ ] 3.1 Counter payments (owner LongLP)
  - **Files**: `backend/src/modules/billing/payments.service.ts`
  - **Do**: cash or bank transfer with a receipt reference, `CONFIRMED` at once (MSG20); applied to unpaid lines oldest due first under `SELECT ... FOR UPDATE` on the invoice; more than due 400 `OVERPAYMENT`; a known reference 409 `DUPLICATE_REFERENCE`
  - **Test**: two concurrent counter payments on one invoice never over-apply
  - _Requirements: REQ-EVT-10, REQ-ERR-04, REQ-ERR-05, FR-BILL-08_
  - _Story: US-UC22_
  - **Partly done** (Jira card pending): `PaymentsService.recordCounter(invoiceId, input, actor)` locks the invoice (`InvoicesRepository.lockWithLines`), refuses a known reference (409 `DUPLICATE_REFERENCE`, also when another invoice takes it at the same moment and the unique index fires) and more than the invoice's net amount due (400 `OVERPAYMENT`, message `amountVnd must be between 1 and {due}`), records the payment `CONFIRMED` and outside the sandbox, applies it oldest due first (`applyPayment`) and emits `payment.confirmed` and `audit.record` after commit. Open: the concurrency test on Postgres (`test:db`), which this machine cannot run; endpoint 13 comes with 5.1
- [ ] 3.2 SePay sandbox (owner LongLP)
  - **Files**: `backend/src/modules/billing/sepay.service.ts`, `sepay-webhook.controller.ts`, `jobs/expire-payments.job.ts`
  - **Do**: create a `PENDING` payment with reference `TL` plus 8 Crockford base32 characters and expiry `billing.sepayPaymentTtlMinutes`; return the VietQR URL built from `SEPAY_QR_BASE_URL` and `SEPAY_BANK_CODE`, labelled sandbox; the webhook checks `Authorization: Apikey` in constant time (401 and nothing recorded otherwise), dedups on reference and gateway transaction id, applies the amount, answers `{ "success": true }` through `@RawResponse()`, logs an unknown reference for Staff; `billing.expirePayments` every 60 s marks expired payments `EXPIRED` with no partial settlement; render the QR once against the sandbox to verify the URL format
  - **Test**: AC-03 (ten identical webhooks record one payment); wrong key 401; an expired payment leaves the amount due (MSG25)
  - _Requirements: REQ-EVT-08, REQ-EVT-09, REQ-UBI-03, REQ-UBI-04, REQ-STA-01, REQ-ERR-01, REQ-ERR-02, AC-03, FR-BILL-07, FR-BILL-09, NFR-SEC-07, BR-31, BR-34_
  - _Story: US-UC19_

## Phase 4: Query / Retrieval

- [ ] 4.1 Invoices, payments, damage charges (owner LongLP)
  - **Do**: invoices and payments with status and contract filters (Org Manager sees own); invoice detail with lines; contract balance; damage charges pending approval
  - **Test**: a Manager reading another organization's invoice gets 404
  - _Requirements: FR-BILL-06, FR-AUTH-11_
  - _Story: US-UC45, US-UC55 (data)_
  - **Partly done**: `BillingReadsService` serves the invoice page (contract, status and overdue filters), the invoice detail with its lines and payments, the payment page and the contract balance; a member reads only its own organization's rows, and another organization's invoice or contract answers 404. The contract code, organization code and term sequence of a row come from the port `CONTRACT_DIRECTORY` (design §4), which `rentals` provides; without it they are null. A contract with no invoice yet answers a zero balance, since billing cannot see its organization before the first invoice. Open: damage charges pending approval, which wait on the contract link of treklink-docs#114

## Phase 5: API Presentation Layer

- [ ] 5.1 Controllers (owner LongLP)
  - **Files**: `pricing.controller.ts`, `invoices.controller.ts`, `payments.controller.ts`, `damage-charges.controller.ts`, `sepay-webhook.controller.ts`
  - **Do**: api-design 01 to 17 with each file's permission and `@ResponseMessage`; the webhook is the one `@RawResponse()` route (D-038)
  - **Partly done**: `pricing.controller.ts` serves api-design 01 `GET /api/plans` (public, listed in the route-guard test) and 02 `POST /api/quotes` (`plan.quote`); `invoices.controller.ts` serves 08 `GET /api/invoices`, 09 `GET /api/invoices/:id`, 10 `GET /api/contracts/:id/balance` (`invoice.read`), 13 `POST /api/invoices/:id/payments/counter` (`payment.recordCounter`) and 14 `GET /api/payments` (`payment.read`). Every VND amount is a JSON number, because the response layer cannot serialize a bigint. The counter payment answers the static message `Payment received.`; the page builds MSG20 with the amount from the result, since `@ResponseMessage` cannot carry a value. `pricing-admin.controller.ts` (2026-10-27) serves 03 `GET /api/price-schedules` and 04 `POST /api/price-schedules` (`priceSchedule.manage`), 05 `GET /api/damage-rates` (`damageRate.read`), 06 `POST` and 07 `PATCH /api/damage-rates/:id` (`damageRate.manage`) over the existing `PricingService`. 2026-10-29 (review of #91): 03 answers each row's `state` against the whole schedule (`PricingRepository.currentPriceIds`); 04 answers "Price scheduled"; a damage label is trimmed before validation, so a label of spaces is 400; a PATCH that changes nothing is 400. Open: 11, 12 and 15 (SePay, task 3.2), 16 and 17 (damage charges, task 2.5, waiting on treklink-docs#114)
- [ ] 5.2 E2E (owner LongLP)
  - **Files**: `backend/test/billing.e2e-spec.ts`, `backend/test/tenancy.e2e-spec.ts`
  - **Do**: every Validation row of api-design 01 to 17; webhook replay; AC-01 to AC-05
  - _Requirements: AC-01 to AC-05_

## Phase 6: Frontend Integration

- [ ] 6.1 Plans page; quote in the request form; invoices and payment page with QR and polling; Admin price and damage schedules; damage approval queue (owner LongNN, tracked in `specs/frontend/tasks.md` 6.1 to 6.4)

## Phase 7: Verification & DoD

- [ ] 7.1 Suite green; lint, boundary check, typecheck clean; `api-design/*.md` matching behaviour (owner LongLP)
