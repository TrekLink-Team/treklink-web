# Requirements Specification: billing (prices, invoices, charges and payments)

**User Story**: As an **Org Manager**, I want to see what each plan costs, receive one clear invoice per term, and pay online or at the counter; as **TrekLink Staff and Admin**, I want late, damage and loss charges computed from configuration and every payment recorded exactly once.
**Story ID**: assigned when the backlog is regenerated | **Priority**: High | **Milestone**: MF-01 (first payment), MF-05 (balance and close)

> **Authority**: Report 3 SRS (2026-10-04) UC-19, UC-22, UC-45 to UC-48, UC-56, FR-BILL-01 to FR-BILL-09, FR-CFG-02, BR-06, BR-07, BR-23 to BR-25, BR-29, BR-31, BR-34, NFR-SEC-07, NFR-UI-03, MSG20, MSG25, MSG30; D-033 item 9 (SePay sandbox); D-037 (one invoice per term, two dated lines); D-038 (webhook body). Rewritten 2026-10-04 (D-036). Reports (FR-BILL-10) are served by `monitoring` (`platform` design §2.1).

---

## 1. Domain Context & Scope

- **In-Scope**: the price schedule per variant; the damage schedule; plan catalogue and quotes; price
  snapshots for `rentals`; invoices and lines; late, damage and loss charges; damage-charge approval;
  SePay sandbox payment requests and the confirming webhook; counter payments; balances.
- **Out-of-Scope**: when a charge arises (decided by `rentals`); report aggregation (`monitoring`); real
  money (BR-34); refunds (none in the plan rules: the holding fee is not refundable).
- **Depends on**: `platform`, `organizations`, `devices` (remaining value). Called by `rentals`. Provides
  `ORGANIZATION_EXIT_CHECKS.canReactivate`.

### Traceability

| This spec | SRS |
|---|---|
| Monthly and day-plan pricing | FR-BILL-01, FR-BILL-02, BR-06, BR-07 |
| Late, damage, loss | FR-BILL-03 to FR-BILL-05, BR-23 to BR-25 |
| Invoices | UC-45, FR-BILL-06 |
| Online and counter payments | UC-19, UC-22, FR-BILL-07 to FR-BILL-09, BR-31, BR-34 |
| Price configuration | UC-56, FR-CFG-01, FR-CFG-02, BR-29 |

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL compute every amount in integer VND, rounding each line up to the whole đồng, from the contract's snapshot and the configured schedules, never from a source literal. [BR-29]
- **REQ-UBI-02**: The system SHALL never change an issued invoice's lines; a correction SHALL be an `ADJUSTMENT` line on the contract's closing invoice, with its author. [FR-BILL-06]
- **REQ-UBI-03**: The system SHALL record a payment only once per reference and once per gateway transaction id; a repeat SHALL record nothing and SHALL be logged. [FR-BILL-08, BR-31]
- **REQ-UBI-04**: The system SHALL run online payments in SePay's sandbox only, label them sandbox wherever they appear, and store no card or bank credential. [BR-34, NFR-UI-03]
- **REQ-UBI-05**: The system SHALL keep the price schedule append-only: a new price is a new row effective from a time not in the past. [FR-CFG-02]

### Event-Driven

- **REQ-EVT-01**: WHEN `rentals` asks for a price snapshot, the system SHALL return the variant's current monthly price, `billing.dayPremium` and `billing.holdingFeeRatio`. [FR-CFG-02]
- **REQ-EVT-02**: WHEN `rentals` issues a monthly term, the system SHALL create one `TERM` invoice with a `HOLDING_FEE` line (ratio × monthly unit price × quantity) due at the term start and a `TERM_BALANCE` line (the remainder) due at the term end. [FR-BILL-01, BR-06, D-037]
- **REQ-EVT-03**: WHEN `rentals` issues a day plan, the system SHALL create one `DAY_PLAN` invoice with one line of monthly unit price ÷ 30 × premium × days × quantity, due at the start date and paid at the latest at the counter. [FR-BILL-02, BR-07]
- **REQ-EVT-04**: WHEN `rentals` checks a device in after `returnDueAt` plus `rentals.returnGraceHours`, the system SHALL add a `LATE_FEE` line of `billing.lateFeePerDevicePerDayVnd` per started day after the due time, for that device, to the closing invoice. [FR-BILL-03, BR-23]
- **REQ-EVT-05**: WHEN `rentals` records a `DAMAGED` inspection, the system SHALL price each damage code from the schedule (variant row first, generic row otherwise) as one `DamageCharge`; IF the total exceeds `billing.damageApprovalThresholdVnd`, THEN it SHALL be `PENDING_APPROVAL`, otherwise `APPROVED`. [FR-BILL-04, BR-24]
- **REQ-EVT-06**: WHEN an Admin who did not record the inspection approves, reduces or waives a pending charge, the system SHALL record the decision and its final amount; an approved or reduced amount SHALL become a `DAMAGE` line on the closing invoice. [FR-BILL-04, BR-24, MSG30]
- **REQ-EVT-07**: WHEN `rentals` records a loss, the system SHALL add a `LOSS` line of the device's remaining value at that date (from `devices`). [FR-BILL-05, BR-25]
- **REQ-EVT-08**: WHEN an Org Manager pays online, the system SHALL create a `PENDING` SePay payment with a fresh reference and an expiry of `billing.sepayPaymentTtlMinutes`, and return the VietQR for the sandbox account. [FR-BILL-07]
- **REQ-EVT-09**: WHEN SePay's webhook arrives with the configured API key and a content holding an issued reference, the system SHALL, in one transaction, confirm the payment, apply its amount to the invoice's unpaid lines oldest due first, update the invoice status, and answer `{ "success": true }` (D-038); a webhook with no issued reference SHALL be logged for Staff and answered the same way. [FR-BILL-07, NFR-SEC-07]
- **REQ-EVT-10**: WHEN Staff record a cash or bank-transfer payment at the counter with a receipt reference, the system SHALL record it `CONFIRMED` and apply it the same way (MSG20). [UC-22, FR-BILL-08]
- **REQ-EVT-11**: WHEN `rentals` cancels a contract before handover, the system SHALL void the unpaid lines of its first invoice with a zero-sum `ADJUSTMENT`, keeping any holding fee paid. [FR-CON-04, E01-7]

### State-Driven

- **REQ-STA-01**: WHILE a SePay payment is `PENDING` past its expiry, the system SHALL treat it as `EXPIRED`, and the amount SHALL stay due. [FR-BILL-09, E05-4]
- **REQ-STA-02**: WHILE any line of a contract is unpaid or a damage charge is pending, the contract's balance SHALL not be settled, and `rentals` SHALL not close it. [FR-CON-13, BR-27]

### Unwanted Behaviour

- **REQ-ERR-01**: IF a webhook lacks the right API key, THEN the system SHALL return 401 and record nothing. [NFR-SEC-07]
- **REQ-ERR-02**: IF a payment fails or expires, THEN the system SHALL write no partial settlement and the amount SHALL stay due and visible (MSG25). [FR-BILL-09]
- **REQ-ERR-03**: IF the inspector tries to decide their own damage charge, THEN the system SHALL return 403 `SEPARATION_OF_DUTY`. [BR-24, E05-6]
- **REQ-ERR-04**: IF a counter payment exceeds the amount still due, THEN the system SHALL return 400 `OVERPAYMENT`.
- **REQ-ERR-05**: IF a counter reference is already recorded, THEN the system SHALL return 409 `DUPLICATE_REFERENCE` and record nothing. [E01-6]

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
`SEPAY_QR_BASE_URL` (default `https://qr.sepay.vn/img`), `SEPAY_BANK_CODE`.

---

## 5. Acceptance Criteria

- **AC-01**: 10 v3 devices at 450,000 VND monthly: term invoice of 4,500,000 with a 2,250,000 holding fee due at the start and 2,250,000 at the end. (TC-06)
- **AC-02**: A 4-day plan of 8 devices at premium 1.5: 720,000 VND due at handover. (TC-07)
- **AC-03**: The same webhook posted 10 times records one payment. (TC-31)
- **AC-04**: A 700,000 VND damage total with threshold 500,000 waits for approval; the inspector's own decision gets 403. (TC-24)
- **AC-05**: A loss on a 14-month-old v3 is charged 1,800,000 VND from the schedule. (TC-25)

---

## 6. Open Questions

None.
