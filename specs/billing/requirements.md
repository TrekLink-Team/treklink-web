# Requirements Specification: billing (prices, invoices, charges and payments)

**User Story**: As an **Org Manager**, I want to see what each plan costs, receive one clear invoice per term, and pay online or at the counter; as **TrekLink Staff and Admin**, I want late, damage and loss charges computed from configuration and every payment recorded exactly once.
**Story ID**: the Stories row of `tasks.md` (backlog D-051) | **Priority**: High | **Milestone**: MF-01 (first payment), MF-05 (balance and close)

> **Authority**: Report 3 SRS (2026-10-14; traceability checked 2026-10-19) UC-19, UC-22, UC-45 to UC-48, UC-56, UC-60, FR-BILL-01 to FR-BILL-09, FR-BILL-11, BR-39, FR-CFG-02, BR-06, BR-07, BR-23 to BR-25, BR-29, BR-31, BR-34, NFR-SEC-07, NFR-UI-03, MSG20, MSG25, MSG30; D-033 item 9 (SePay sandbox); D-037 (one invoice per term, two dated lines); D-038 (webhook body); D-097 rules 2 and 3 (the pro-rata credit of End now, leader ruling 2026-11-05). Rewritten 2026-10-04 (D-036). Reports (FR-BILL-10) are served by `monitoring` (`platform` design §2.1).

---

## 1. Domain Context & Scope

- **In-Scope**: the price schedule per variant; the damage schedule; plan catalogue and quotes; price
  snapshots for `rentals`; invoices and lines; late, damage and loss charges; damage-charge approval;
  SePay sandbox payment requests and the confirming webhook; counter payments; balances.
- **Out-of-Scope**: when a charge arises (decided by `rentals`); report aggregation (`monitoring`); real
  money (BR-34); refunds other than the service credit of REQ-EVT-12 to REQ-EVT-15 (the holding fee stays
  non-refundable when the organization cancels, D-092 rule 5).
- **Depends on**: `platform`, `organizations`, `devices` (remaining value). Called by `rentals`. Provides
  `ORGANIZATION_EXIT_CHECKS.canReactivate`.

### Traceability

| This spec | SRS |
|---|---|
| Monthly and day-plan pricing | FR-BILL-01, FR-BILL-02, BR-06, BR-07 |
| Late, damage, loss | FR-BILL-03 to FR-BILL-05, FR-BILL-11, BR-23 to BR-25, BR-39 |
| Invoices | UC-45, FR-BILL-06 |
| Online and counter payments | UC-19, UC-22, FR-BILL-07 to FR-BILL-09, BR-31, BR-34 |
| Price configuration | UC-56, FR-CFG-01, FR-CFG-02, BR-29 |

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL compute every amount in integer VND, rounding each line up to the whole đồng, from the contract's snapshot and the configured schedules, never from a source literal. [BR-29]
- **REQ-UBI-02**: The system SHALL never change an issued term invoice's lines. The contract's closing invoice stays open to new lines until the contract is `CLOSED`: late, damage, loss, adjustment, service credit and early-end credit lines all land on it, and a correction SHALL be an `ADJUSTMENT` line there, with its author. [FR-BILL-06, leader ruling 2026-11-02 on treklink-web#288]
- **REQ-UBI-03**: The system SHALL record a payment only once per reference and once per gateway transaction id; a repeat SHALL record nothing and SHALL be logged. [FR-BILL-08, BR-31]
- **REQ-UBI-04**: The system SHALL run online payments in SePay's sandbox only, label them sandbox wherever they appear, and store no card or bank credential. [BR-34, NFR-UI-03]
- **REQ-UBI-05**: The system SHALL keep the price schedule append-only: a new price is a new row effective from a time not in the past. [FR-CFG-02]

### Event-Driven

- **REQ-EVT-01**: WHEN `rentals` asks for a price snapshot, the system SHALL return the variant's current monthly price, `billing.dayPremium` and `billing.holdingFeeRatio`. [FR-CFG-02]
- **REQ-EVT-02**: WHEN `rentals` issues a monthly term (term 1 at the request since D-092 rule 1, later terms at rollover), the system SHALL create one `TERM` invoice with a `HOLDING_FEE` line (ratio × monthly unit price × quantity) due at the term start, or at the request's `holdExpiresAt` when that is earlier, and a `TERM_BALANCE` line (the remainder) due at the term end. [FR-BILL-01, BR-06, D-037]
- **REQ-EVT-03**: WHEN `rentals` issues a day plan (at the request since D-092 rule 1), the system SHALL create one `DAY_PLAN` invoice with one line of monthly unit price ÷ 30 × premium × days × quantity, due at the start date, or at the request's `holdExpiresAt` when that is earlier, and paid at the latest at the counter. [FR-BILL-02, BR-07]
- **REQ-EVT-04**: WHEN `rentals` checks a device in after `returnDueAt` plus `rentals.returnGraceHours`, the system SHALL add a `LATE_FEE` line of `billing.lateFeePerDevicePerDayVnd` per started day after the due time, for that device, to the closing invoice. [FR-BILL-03, BR-23]
- **REQ-EVT-05**: WHEN `rentals` records a `DAMAGED` inspection, the system SHALL price each damage code from the schedule (variant row first, generic row otherwise) as one `DamageCharge`; IF the total exceeds `billing.damageApprovalThresholdVnd`, THEN it SHALL be `PENDING_APPROVAL`, otherwise `APPROVED`. [FR-BILL-04, BR-24]
- **REQ-EVT-06**: WHEN an Admin who did not record the inspection approves, reduces or waives a pending charge, the system SHALL record the decision and its final amount; an approved or reduced amount SHALL become a `DAMAGE` line on the closing invoice. [FR-BILL-04, BR-24, MSG30]
- **REQ-EVT-07**: WHEN `devices` confirms a loss case in `RENTER` custody, the system SHALL add a `LOSS` line of the device's remaining value at the confirmation date (from `devices.valueAt`) to that contract's closing invoice; a `TREKLINK` custody loss adds no line. WHEN the case is settled as reduced or waived, the system SHALL record the decision as an `ADJUSTMENT` line with the reason, never by editing the `LOSS` line. [FR-BILL-05, FR-BILL-11, BR-25, BR-39]
- **REQ-EVT-08**: WHEN an Org Manager pays online, the system SHALL create a `PENDING` SePay payment with a fresh reference and an expiry of `billing.sepayPaymentTtlMinutes`, and return the VietQR for the sandbox account. [FR-BILL-07]
- **REQ-EVT-09**: WHEN SePay's webhook arrives with the configured API key and a content holding an issued reference, the system SHALL, in one transaction, confirm the payment, apply its amount to the invoice's unpaid lines oldest due first, update the invoice status, and answer `{ "success": true }` (D-038); a webhook with no issued reference SHALL be logged for Staff and answered the same way. [FR-BILL-07, NFR-SEC-07]
- **REQ-EVT-10**: WHEN Staff record a cash or bank-transfer payment at the counter with a receipt reference, the system SHALL record it `CONFIRMED` and apply it the same way (MSG20). [UC-22, FR-BILL-08]
- **REQ-EVT-11**: WHEN `rentals` cancels a contract before handover, rejects a request, or cancels a request whose hold expired unpaid, the system SHALL void the unpaid lines of its first invoice with a zero-sum `ADJUSTMENT`, keeping any holding fee paid; a deposit paid on a rejected request is refunded outside TrekLink (leader ruling 2026-11-01). [FR-CON-04, E01-7, D-092 rule 1]
- **REQ-EVT-12**: WHEN TrekLink Staff request a service credit for a unit of a running contract that failed through no fault of the organization, after the unit is checked in or replaced, naming the cause, the source of the outage start (an incident id, a fault report id of rentals REQ-EVT-24 for the same contract row, or a note with the time of the call or counter visit) and the inspection of the returned unit that shows the fault, the system SHALL record the credit `REQUESTED` with its computed amount (design §9) and its author, and notify the organization's Managers after commit. If the request names a fault report and omits the start, the system SHALL use the report's `reportedAt`. [D-092 rule 5]
- **REQ-EVT-13**: WHEN an Admin who did not request the credit approves, reduces (with a reason) or rejects (with a reason) a `REQUESTED` credit with the `version` they saw, the system SHALL record the decision and its author and, after commit, record the audit entry and notify the organization's Managers. [D-092 rule 5, BR-24]
- **REQ-EVT-14**: WHEN a credit is approved or reduced, the system SHALL add one negative `SERVICE_CREDIT` line of the decided amount to the contract's next term invoice not yet issued, else to its closing invoice (REQ-UBI-02), and mark the credit `APPLIED` with that line. [D-092 rule 5, leader ruling 2026-11-02]
- **REQ-EVT-15**: WHEN a decided credit has no later invoice to go on because the contract is `CLOSED`, the system SHALL mark it `REFUND_DUE`; WHEN Staff record the refund paid outside TrekLink with a unique reference, the system SHALL mark it `REFUNDED` with the reference and the time (BR-34: sandbox only, no real money moves through TrekLink). [D-092 rule 5]

- **REQ-EVT-16**: WHEN `rentals` ends a monthly contract now (rentals REQ-EVT-27), the system SHALL credit the unused whole days of the current term at the term's daily rate: with the term fee F = P × q, the term length D in whole days from its start to its end, and the used days U = ⌈(end time − term start) ÷ 1 day⌉ (the end day counts as used, at least 1, at most D), it SHALL add one `EARLY_END_CREDIT` line of −⌈F × (D − U) ÷ D⌉ VND to the contract's closing invoice, due at the end time, with the ending actor as author and a description that names the term, the unused days and the end reason; no line when D − U is 0. A day plan, already billed per day, SHALL get no credit. The preview (rentals REQ-EVT-28) uses the same computation and stores nothing. [D-097 rule 2, FR-BILL-06]
- **REQ-EVT-17** (D-097 amended, leader ruling 2026-11-06, treklink-docs#178): WHEN TrekLink Staff (or an Admin) mark a `CREDIT_DUE` invoice refunded with a note, after the refund was made outside TrekLink, the system SHALL record the amount refunded (the invoice's credit due at that moment), the note, the author and the time, set the invoice to `REFUNDED`, lower the contract's `owedToOrganizationVnd` by that amount, and, after commit, record the audit entry `invoice.refunded`. [D-097 rule 3 amended, BR-34]

### State-Driven

- **REQ-STA-01**: WHILE a SePay payment is `PENDING` past its expiry, the system SHALL treat it as `EXPIRED`, and the amount SHALL stay due. [FR-BILL-09, E05-4]
- **REQ-STA-02**: WHILE any line of a contract is unpaid, a damage charge is pending, or a service credit is `REQUESTED`, the contract's balance SHALL not be settled, and `rentals` SHALL not close it; an `APPROVED` credit counts as owed to the organization. [FR-CON-13, BR-27, leader ruling 2026-11-02]
- **REQ-STA-03**: WHILE the credits on a contract's lines exceed what its lines still owe, the system SHALL report the difference as `owedToOrganizationVnd` in the contract balance (api-design 10), and the contract balance counts as settled; the page SHALL say that the amount is refunded outside TrekLink, because no refund flow exists yet (D-092 rule 5, BR-34); a refund recorded under REQ-EVT-17 lowers it. [D-097 rule 3]
- **REQ-STA-04** (D-097 amended, leader ruling 2026-11-06): WHILE an invoice's total is below zero and no refund is recorded on it, the system SHALL keep it `CREDIT_DUE`, never `PAID`, and SHALL return with it `creditDueVnd`, what TrekLink owes the organization on it: the smaller of the negative total and the contract's `owedToOrganizationVnd`, zero while the credit is still set against the contract's unpaid lines. Every screen and the invoice document SHALL read "Credit due to organization" with that amount. [D-097 rule 3 amended]

### Unwanted Behaviour

- **REQ-ERR-01**: IF a webhook lacks the right API key, THEN the system SHALL return 401 and record nothing. [NFR-SEC-07]
- **REQ-ERR-02**: IF a payment fails or expires, THEN the system SHALL write no partial settlement and the amount SHALL stay due and visible (MSG25). [FR-BILL-09]
- **REQ-ERR-03**: IF the inspector tries to decide their own damage charge, THEN the system SHALL return 403 `SEPARATION_OF_DUTY`. [BR-24, E05-6]
- **REQ-ERR-04**: IF a counter payment exceeds the amount still due, THEN the system SHALL return 400 `OVERPAYMENT`.
- **REQ-ERR-05**: IF a counter reference is already recorded, THEN the system SHALL return 409 `DUPLICATE_REFERENCE` and record nothing. [E01-6]
- **REQ-ERR-06**: IF Staff request a credit for a unit not on the contract, for an outage start outside the unit's custody interval or in the future, without the source of the outage start, or without a fault record of that unit, THEN the system SHALL return 400 `VALIDATION_FAILED` or 409 `DEVICE_NOT_ON_CONTRACT` (MSG12); IF the unit is neither checked in nor replaced, THEN 409 `INVALID_STATE_TRANSITION`; in every case it records nothing. [D-092 rule 5, leader ruling 2026-11-02]
- **REQ-ERR-07**: IF the requester decides their own credit, THEN the system SHALL return 403 `SEPARATION_OF_DUTY`; IF a reduction is not below the computed amount or a reduction or rejection has no reason, THEN 400 `VALIDATION_FAILED`; IF the credit is not `REQUESTED` or the `version` is stale, THEN 409 `INVALID_STATE_TRANSITION` or `STALE_VERSION`. [D-092 rule 5, BR-24]
- **REQ-ERR-08**: IF a second credit is requested for the same unit with an outage that overlaps a credit not `REJECTED`, THEN the system SHALL return 409 `DUPLICATE_CREDIT` and record nothing. [D-092 rule 5]
- **REQ-ERR-09** (D-097 amended): IF a refund is marked on an invoice that is not `CREDIT_DUE`, THEN 409 `INVALID_STATE_TRANSITION` "Only an invoice with a credit due can be marked refunded."; IF its credit due is zero because the credit is still set against unpaid lines, THEN 409 `NOTHING_OWED` "Nothing is owed to the organization on this invoice yet: the credit is set against its unpaid invoices."; nothing changes in either case.

---

## 3. Non-Functional Requirements

| Property | Target | Source |
|---|---|---|
| Webhook answer | within 30 s, by SePay's rule; target ≤1 s | D-038 |
| Duplicate webhook | 10 repeats record 1 payment | TC-31 |

---

## 4. Configuration

The `billing` section of the [Configuration Matrix](../platform/configuration-matrix.md); prices and
damage rates are their own tables, edited by an Admin. Environment: `SEPAY_WEBHOOK_API_KEY`,
`SEPAY_QR_BASE_URL` (default `https://qr.sepay.vn/img`, the SePay QR guide read 2026-11-02), `SEPAY_BANK_CODE`
(default `MBBank`; a bank short name of `https://qr.sepay.vn/banks.json`, and `billing.sepayBankAccount` letters and digits
only, or the QR service answers an error page instead of an image).

---

## 5. Acceptance Criteria

- **AC-01**: 10 v3 devices at 450,000 VND monthly: term invoice of 4,500,000 with a 2,250,000 holding fee due at the start and 2,250,000 at the end. (TC-06)
- **AC-02**: A 4-day plan of 8 devices at premium 1.5: 720,000 VND due at handover. (TC-07)
- **AC-03**: The same webhook posted 10 times records one payment. (TC-31)
- **AC-04**: A 700,000 VND damage total with threshold 500,000 waits for approval; the inspector's own decision gets 403. (TC-24)
- **AC-05**: A loss on a 14-month-old v3 is charged 1,800,000 VND from the schedule. (TC-25)
- **AC-06**: A v3 unit at 450,000 VND monthly on a 30-day term fails on day 10 with a swollen battery; its replacement is handed over on day 13. The credit is ⌈450,000 × 3 ÷ 30⌉ = 45,000 VND; once an Admin approves it, the next term invoice carries a `SERVICE_CREDIT` line of −45,000 VND. (D-092 rule 5)
- **AC-07**: The Staff member who requested a credit tries to approve it: 403 `SEPARATION_OF_DUTY`. Another Admin reduces it to 30,000 VND with a reason: the line is −30,000 VND. (D-092 rule 5)
- **AC-08**: A credit decided after the contract closed is `REFUND_DUE`; Staff record the bank-transfer reference and it becomes `REFUNDED`; the same reference again gets 409 `DUPLICATE_REFERENCE`. (D-092 rule 5)

- **AC-09**: A monthly contract of 2 units at 450,000 VND (F = 900,000) on a 30-day term is ended now on day 6 (5 days and 1 hour after the term start): U = 6, the closing invoice carries `EARLY_END_CREDIT` −⌈900,000 × 24 ÷ 30⌉ = −720,000 VND. Ended in the first hour of day 1: −⌈900,000 × 29 ÷ 30⌉ = −870,000; on the last day: no line. On a 31-day term ended on day 6: −⌈900,000 × 25 ÷ 31⌉ = −725,807. A day plan ended early: no line. (D-097 rule 2)
- **AC-10**: The same contract had paid its whole term, 900,000 VND: after the credit the balance is settled, `owedToOrganizationVnd` is 720,000 and the page says it is refunded outside TrekLink. (D-097 rule 3)
- **AC-11**: The closing invoice of AC-10 (total −720,000 VND) reads "Credit due to organization 720,000 ₫", status `CREDIT_DUE`, never Paid; Staff mark it refunded with the note "Bank transfer FT26110600042": it becomes `REFUNDED` with the amount, note, author and time, and the contract's `owedToOrganizationVnd` is 0. (D-097 amended)
- **AC-12**: Had the term been unpaid, the same credit is set against the term's lines: the closing invoice is `CREDIT_DUE` with `creditDueVnd` 0, and marking it refunded answers 409 `NOTHING_OWED`. (D-097 amended)

---

## 6. Open Questions

- None. Service credits (D-092 rule 5): the leader confirmed design §9 on 2026-11-02 with six rulings on
  treklink-web#288 (where the line goes, the invoiced term, a unit still out, the source of the outage start,
  a one-day minimum, a requested credit blocking the close); they are in REQ-UBI-02, REQ-EVT-12, REQ-EVT-14,
  REQ-STA-02, REQ-ERR-06 and design §9. The build is billing tasks 8.1 and 8.2.
