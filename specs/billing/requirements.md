# Requirements Specification: billing

**User Story**: As an **Admin**, I want prices, deposits and fee schedules to be data I can change and show changing; as an **Operator**, I want the platform to compute every charge itemised, apply the deposit first, take sandbox payments and never close a rental with money outstanding; as a **Customer**, I want to see exactly what I paid, what was deducted and why, and what comes back to me.
**Story IDs**: US-031, US-035, US-036, US-067 to US-070 (E3, E6) | **Priority**: Medium | **Main Flow**: **MF-05** (specified for Review 2), with the escrow step of MF-01 | **Lane**: LongLP (`billing`, MF-05 owner)

> **Authority**: charter §8 (sandbox only, no real funds, no card data), D-015 (every price and fee is configuration), Q60, Q61, Q63, Q64 (**Recorded, not Confirmed**, tagged `[Qnn]`). **Payment lives in `billing` only; other modules call it** `[Q64]`. The payment-timing conflict between Q60 (escrow at booking) and MF-05 (settle at return) is resolved by proposal in `specs/rentals/requirements.md` and switchable by `rentals.requireEscrowBeforeReview`; this module supports both.

### MF-05 coverage map

MF-05 spans three modules. This table is where the flow's steps are traced, so no step is left without an owner.

| MF-05 step | Module | Spec |
|---|---|---|
| 1. Guide returns, Staff checks in, device to `RETURNED` | `rentals`, `devices` | rentals REQ-EVT-18 |
| 2. Return inspection | `rentals` | rentals REQ-EVT-19 |
| 3. Charge = base + late + damage − deposit | **`billing`** | REQ-EVT-05 to REQ-EVT-08 here |
| 4. Sandbox payment, invoice or refund | **`billing`** | REQ-EVT-09, REQ-EVT-10 here |
| 5. Rental to `CLOSED` | `rentals` | rentals REQ-EVT-22 |
| 6. Device to `AVAILABLE`, `MAINTENANCE` or `RETIRED`; maintenance record | `devices` | devices REQ-EVT-07, REQ-EVT-08, REQ-EVT-10 |

---

## 1. Domain Context & Scope

- **In-Scope**:
  - Pricing rules, admin-configurable, by package, hardware variant, channel and quantity tier, with validity dates (US-067) `[Q61, Q63]`
  - Deposits per device by tier (package, variant, quantity) `[Q61]`
  - Quotes for bookings; escrow invoices; cancellation fee and refund `[Q60]`
  - Settlement invoices: base fee when not prepaid, late fee, damage fee, loss fee, deposit applied, balance or refund (US-035, US-036, BR-17 to BR-20)
  - Sandbox payments (charge and refund) with idempotency keys and a simulated failure path (charter §8, E05-4)
  - Fee waivers with separation of duty above a threshold (BR-21, E05-7)
  - Invoice and payment views for Staff and Customers (US-070)
- **Out-of-Scope**:
  - Real payment providers, card data of any kind (charter §8, NFR-LEG-02)
  - Tax and e-invoice (hóa đơn điện tử) compliance
  - Reports and dashboard widgets (US-071 to US-074): E6 reporting stories, scheduled after MF-05 core; listed so their absence here is deliberate
- **Depends on**: `platform`, `auth`, `trips` (package of a trip), `devices` (variant of a device). Not `rentals`: it pushes facts in (acyclic graph, platform design Figure 3).

### Traceability

| Group | MF | UC | FR | BR | Exception | Story |
|---|---|---|---|---|---|---|
| Pricing rules and deposits | MF-01, MF-05 | UC-50 Manage Pricing Rules (new) | FR-BILL-03 (new) | BR-23 | | US-067 |
| Quote and escrow | MF-01 | UC-02 | FR-BILL-04 (new) | | | US-031 |
| Cancellation fee | MF-01 | UC-29 | FR-BOOK-07 | BR-03 | E01-2 | none |
| Charge calculation | MF-05 | UC-11 | FR-BILL-01 | BR-17 | | US-068 |
| Late fee | MF-05 | UC-24 | FR-BILL-02 | BR-18 | E05-1 | US-035 |
| Damage and loss fee | MF-05 | UC-25 | FR-BILL-06 | BR-20 | E05-2, E05-3, E05-5 | US-036 |
| Payment | MF-05 | UC-12 | FR-BILL-05 | BR-19 | E05-4 | US-069 |
| Fee waiver | MF-05 | UC-44 Approve Fee Waiver (new) | FR-BILL-08 | BR-21 | E05-7 | none |
| Invoice view | MF-05 | UC-12 | FR-BILL-07 (new) | | | US-070 |

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL hold every price, deposit, fee rate, fee schedule, grace period, threshold and percentage as a pricing rule, damage-fee rule or runtime parameter; none SHALL be a source literal. [D-015, BR-23, NFR-CFG-01]
- **REQ-UBI-02**: The system SHALL represent money as an exact decimal with its currency (`VND`), and SHALL round each line to whole đồng, half up, before summing.
- **REQ-UBI-03**: The system SHALL itemise every amount as its own invoice line with a type, description, quantity, unit amount, amount and the source it came from (rule, inspection, lateness); no invoice total SHALL contain an amount that is not a line. [E05-1]
- **REQ-UBI-04**: The system SHALL mark every payment `sandbox: true` and SHALL NOT accept, transmit or store card data. [charter §8, EARS optional-feature example in `02-spec-driven-development-workflow.md`]
- **REQ-UBI-05**: The system SHALL make invoices immutable once `ISSUED`; a correction is a new invoice or a waiver line, never an edit. [auditability]
- **REQ-UBI-06**: The system SHALL process every payment request idempotently on its `Idempotency-Key`, so a retried request never charges or refunds twice.

### Event-Driven

- **REQ-EVT-01**: WHEN `rentals` asks for a booking quote, the system SHALL select for each component (trip fee per traveller, rental fee per device, deposit per device) the most specific active rule for the package, hardware variant, channel and quantity, and return itemised lines. `[Q61, Q63]`
- **REQ-EVT-02**: WHEN `rentals` opens escrow for a Customer booking, the system SHALL issue a `BOOKING_ESCROW` invoice from the quote, due at the hold expiry. `[Q60]`
- **REQ-EVT-03**: WHEN an escrow invoice is paid in full, the system SHALL mark it `PAID` and emit `payment.succeeded` with the booking id after commit. `[Q60]`
- **REQ-EVT-04**: WHEN `rentals` asks for a cancellation settlement, the system SHALL compute the fee as zero if the cancellation is within `billing.freeCancellationMinutes` of the escrow payment, else `billing.cancellationFeePct` of the `RENTAL_FEE` lines only (never the trip fee), issue the refund of the remainder, and return both amounts. [BR-03, E01-2] `[Q60]`
- **REQ-EVT-05**: WHEN `rentals` submits settlement facts, the system SHALL issue a `SETTLEMENT` invoice with: a `RENTAL_FEE` line if the rental fee was not prepaid; one `LATE_FEE` line per late device; one `DAMAGE_FEE` line per inspected device with a non-`GOOD` condition; one `LOSS_FEE` line per lost device; and a negative `DEPOSIT_APPLIED` line for the deposit held. [BR-17, UC-11]
- **REQ-EVT-06**: WHEN computing a late fee, the system SHALL charge `billing.lateFeePerDevicePerDay` for each started day after `dueAt + billing.lateGraceHours`, per device, and SHALL show the hours late in the line description. [BR-18, E05-1, UC-24]
- **REQ-EVT-07**: WHEN computing a damage or loss fee, the system SHALL use the damage-fee rule for the condition (or `LOST`) and the device's variant, falling back to the variant-agnostic rule. [E05-2, E05-3, UC-25]
- **REQ-EVT-08**: WHEN the fees exceed the deposit held, the system SHALL set the balance due to the difference and the refund to zero; WHEN the deposit exceeds the fees, the system SHALL set the refund due to the difference and the balance to zero. A negative refund SHALL never be produced. [BR-20, E05-5]
- **REQ-EVT-09**: WHEN a sandbox charge succeeds, the system SHALL record the payment, reduce the balance, and mark the invoice `PAID` when the balance reaches zero. WHEN a refund due is paid out, the system SHALL record a `REFUND` payment and mark the invoice `SETTLED`. [UC-12]
- **REQ-EVT-10**: WHEN a sandbox charge fails (simulated decline or timeout), the system SHALL record the payment `FAILED` with its reason and leave the invoice, balance and rental untouched. [E05-4, BR-19]
- **REQ-EVT-11**: WHEN an Operator requests a waiver on a fee line at or below `billing.waiverApprovalThreshold`, the system SHALL apply it as a negative `WAIVER` line on a new adjustment invoice linked to the original; above the threshold it SHALL hold the waiver `PENDING` until approved by a different Operator. [BR-21, E05-7]

### State-Driven

- **REQ-STA-01**: WHILE an invoice has a balance due above zero or a refund due not yet paid, `isSettled` SHALL return false and the rental SHALL NOT close. [BR-19, E05-4]
- **REQ-STA-02**: WHILE a pricing rule is outside its validity window or inactive, the system SHALL NOT select it.
- **REQ-STA-03**: WHILE `billing.sandboxFailureRate` is above zero, the sandbox SHALL fail that share of charges at random, so E05-4 can be demonstrated without a code change. (Default 0.)

### Unwanted Behaviour

- **REQ-ERR-01**: IF no pricing rule matches a component, THEN the quote SHALL fail with 409 `PRICE_NOT_CONFIGURED` naming the package, variant and channel, rather than pricing at zero.
- **REQ-ERR-02**: IF two active rules of equal specificity and priority overlap, THEN creating or activating the second SHALL fail with 409 `PRICING_RULE_CONFLICT`.
- **REQ-ERR-03**: IF a waiver above the threshold is approved by its requester or by the inspector of the item it concerns, THEN the system SHALL return 409 `SEPARATION_OF_DUTY`. [BR-21, E05-7]
- **REQ-ERR-04**: IF a payment amount exceeds the balance due, or a refund exceeds the refund due, THEN the system SHALL return 400 `AMOUNT_EXCEEDS_DUE`.
- **REQ-ERR-05**: IF the same `Idempotency-Key` is reused with a different body, THEN the system SHALL return 409 `IDEMPOTENCY_KEY_REUSED`.
- **REQ-ERR-06**: IF settlement facts include a returned device with no inspection, THEN the system SHALL return 409 `INSPECTION_REQUIRED`.

---

## 3. Non-Functional Requirements

| Property | Target | Source |
|---|---|---|
| Arithmetic | exact decimal, no floating point anywhere in money code | REQ-UBI-02 |
| Idempotency | a payment retried 10 times charges once | REQ-UBI-06 |
| Legal | sandbox only, no card data | charter §8 |

---

## 4. Configuration Matrix entries

| Parameter | Default | Location | Admin-editable | Source of default |
|---|---|---|---|---|
| pricing rules (trip fee, rental fee, deposit) | seeded examples only | DB table | yes, `api-design/01` to `03` | Q61, Q63 |
| damage-fee rules by condition and variant | seeded examples only | DB table | yes, `api-design/04`, `05` | E05-2 |
| `billing.freeCancellationMinutes` | 10 | DB | yes | Q60 |
| `billing.cancellationFeePct` | 5 | DB | yes | Q60 |
| `billing.lateGraceHours` | 2 | DB | yes | proposal (BR-18 names a grace period, no value) |
| `billing.lateFeePerDevicePerDay` | 50000 VND | DB | yes | proposal |
| `billing.waiverApprovalThreshold` | 200000 VND | DB | yes | proposal |
| `billing.sandboxFailureRate` | 0 | DB | yes | demo switch |
| `billing.currency` | `VND` | env | no | charter |

Seeded amounts are illustrative for the demo and are labelled so in the seed; the agency sets real ones.

---

## 5. Acceptance Criteria

- **AC-01**: A quote for 2 travellers and 1 device on the Customer channel returns three itemised lines from three rules; deleting the rental-fee rule makes the quote fail with `PRICE_NOT_CONFIGURED`.
- **AC-02**: Cancelling 5 minutes after escrow payment refunds everything; cancelling 30 minutes after charges 5 % of the rental-fee line only; changing `billing.cancellationFeePct` to 10 changes the next cancellation (D-015 demo).
- **AC-03**: A device returned 26 hours after `dueAt` with a 2-hour grace incurs one day's late fee on its own line with the hours stated.
- **AC-04**: Damage 700 000 against a deposit of 300 000 yields balance 400 000 and refund 0; damage 100 000 yields refund 200 000 and balance 0.
- **AC-05**: With `billing.sandboxFailureRate = 1`, a charge fails, the balance is unchanged and the rental cannot close; with 0 it succeeds and the rental closes.
- **AC-06**: A waiver of 500 000 requested by the inspector and approved by the same person returns 409 `SEPARATION_OF_DUTY`; approved by another Operator it applies.
- **AC-07**: The same payment request sent 10 times with one `Idempotency-Key` produces one payment.

---

## 6. Open Questions

Carried into QUESTION entry C-003: escrow at booking versus settlement at return (shared with `rentals`), default fee values, whether Admin (rather than an Operator) must approve waivers above the threshold, and whether a Guide-channel booking pays escrow.
