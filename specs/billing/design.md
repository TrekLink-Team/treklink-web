# Technical Design: billing

> Fulfills `requirements.md` in this folder. Schema: the `// @module billing` block of
> `backend/prisma/schema.prisma` is authoritative.
>
> **Status**: Approved, written by KhoaDD and merged on `dev` (treklink-web PR #30 and #31, 2026-10-18). Changes go through a pull request reviewed by KhoaDD (D-052).

---

## 1. Data model

```mermaid
erDiagram
    HARDWARE_VARIANT ||--o{ PRICE_SCHEDULE : "priced by"
    HARDWARE_VARIANT |o--o{ DAMAGE_RATE : "damage rates"
    RENTAL_CONTRACT ||--o{ INVOICE : "billed by"
    CONTRACT_TERM |o--o| INVOICE : "term invoice"
    INVOICE ||--|{ INVOICE_LINE : "lines"
    INVOICE ||--o{ PAYMENT : "paid by"
    INSPECTION ||--o{ DAMAGE_CHARGE : "charges"
    INVOICE {
        uuid id PK
        string number UK
        enum kind
        enum status
        bigint totalVnd
        bigint paidVnd
    }
    PAYMENT {
        uuid id PK
        string reference UK
        string gatewayTxnId UK
        enum method
        enum status
    }
```

***Figure 1***: billing slice.

Invoice kinds: `TERM` (monthly, two dated lines), `DAY_PLAN` (one line), `CLOSING` (late, damage, loss,
adjustments; created on the first such charge of a contract and kept open for more lines until the
contract closes). A closing invoice is the one exception to "issued once": lines are appended while the
contract is not `CLOSED`, never changed (REQ-UBI-02).

---

## 2. Calculations

| Charge | Formula | Due |
|---|---|---|
| Holding fee | ⌈ratio × P × q⌉ | term start |
| Term balance | P × q − holding fee | term end |
| Day plan | ⌈P ÷ 30 × premium × days × q⌉ | start date (paid by the handover) |
| Late | `lateFeePerDevicePerDayVnd` × ⌈(checkedInAt − returnDueAt) ÷ 1 day⌉, only if past the grace | at check-in |
| Damage | Σ rate(code) for the device's variant, generic rate as fallback | when decided, or at once below the threshold |
| Loss | `devices.valueAt(device, confirmedAt)`, renter custody only; a reduction or waiver is an `ADJUSTMENT` line | at loss-case confirmation |

`P` is the contract's `monthlyUnitPriceVnd` snapshot; `ratio` and `premium` are the snapshot too.

---

## 3. SePay sandbox flow

```mermaid
sequenceDiagram
    autonumber
    actor M as Org Manager
    participant API as PaymentsController
    participant S as SepayService
    participant DB as Postgres
    participant SP as SePay sandbox
    M->>API: POST /api/invoices/{id}/payments/sepay
    S->>DB: INSERT payment PENDING, reference TLxxxx, expiresAt
    API-->>M: VietQR image URL with amount and reference
    M->>SP: scan and pay (sandbox)
    SP->>API: POST /api/payments/sepay/webhook, Authorization Apikey
    S->>S: constant-time key check, extract reference from content
    S->>DB: BEGIN, SELECT payment WHERE reference FOR UPDATE
    alt already confirmed or txn id known
        S-->>SP: 200 {"success": true}, duplicate logged
    end
    S->>DB: CONFIRMED, apply to lines, invoice status, COMMIT
    S-)S: emit payment.confirmed
    S-->>SP: 200 {"success": true}
    M->>API: GET /api/payments/{id} (polling)
    API-->>M: CONFIRMED, MSG20
```

***Figure 2***: SePay flow. Facts verified on 2026-10-04 at https://docs.sepay.vn/tich-hop-webhooks.html:
the `Authorization: Apikey <key>` header, the payload fields, the required `{"success": true}` body and
the retry policy (7 retries over 5 hours). The VietQR image URL format is configuration (`SEPAY_QR_BASE_URL`). On 2026-10-18
https://docs.sepay.vn/tao-qr-code-vietqr-dong.html documents `https://vietqr.app/img?acc=&bank=&amount=&des=`, with optional `template`
and `download`; it replaces the older `qr.sepay.vn/img` default. Rendering against SePay's sandbox stays in task 3.2.

The reference is `TL` plus 8 Crockford base32 characters, so it survives banks that strip punctuation
from transfer content. The webhook's `transferAmount` must equal the payment amount; a different amount
is recorded as a separate `CONFIRMED` payment of the received amount against the same invoice and logged
for Staff, rather than rejected, because the money has moved.

---

## 4. Services and ports

| Export | Used by |
|---|---|
| `PricingService.snapshot(variantId, tx?)`, 404 when no price is in effect | rentals |
| `InvoicesService.issueTermInvoice(contract, term, tx)`, `issueDayPlanInvoice(contract, tx)` | rentals |
| `ChargesService.chargeLate(contract, device, checkedInAt, actorId, tx)`, `chargeDamage(contract, inspection, actorId, tx)`; `actorId` is null for SYSTEM | rentals |
| `ChargesService.chargeLoss(contract, device, lostAt, tx)` and `adjustLoss(contract, device, decision, amountVnd, reason, actor, tx)` (an `ADJUSTMENT` line for a reduced or waived loss, never an edit of the `LOSS` line, FR-BILL-11, BR-39), called from this module's provider of the `devices` port `LOSS_CASE_LISTENERS` (`onConfirmed` for `RENTER` custody, `onSettled`) | devices, through the port (D-045) |
| `ChargesService.settleCancellation(contract, tx)` | rentals |
| `BalanceService.firstPaymentConfirmed(contractId)`, `outstanding(contractId)`, `balanceSummary(contractId)` | rentals |
| `BalanceService.revenue(range)` | monitoring |
| provider of `ORGANIZATION_EXIT_CHECKS.canReactivate` | organizations |

Events emitted: `payment.confirmed`, `audit.record`.

---

## 5. Scheduler jobs

| Job | Rule |
|---|---|
| `billing.expirePayments` | `PENDING` past `expiresAt` to `EXPIRED` |

---

## 6. Error catalogue

| Code | HTTP |
|---|---|
| `BELOW_MOQ` | 400 (quote) |
| `EFFECTIVE_IN_PAST` | 400 |
| `NOTHING_DUE` | 409 |
| `PAYMENT_PENDING` | 409 |
| `WEBHOOK_UNAUTHENTICATED` | 401 |
| `DUPLICATE_REFERENCE` | 409 |
| `OVERPAYMENT` | 400 |
| `SEPARATION_OF_DUTY` | 403 |

---

## 7. Testing strategy

Formula tests from the acceptance criteria; rounding at boundaries; webhook replay ×10; amount mismatch;
expiry; separation of duty; adjustment lines never mutating issued lines; concurrent counter payments on
one invoice.

---

## 8. Detailed design for Report 4 (D-044)

Layering as in `organizations` design §9. Figure 3 is the class view; Figures 4 to 6 are the
MF-05 payment and damage approval.

<!-- sdd: MF-05 class billing -->
```mermaid
classDiagram
    class PaymentsController {
        +createSepay(invoiceId, dto, caller) PaymentDto
        +recordCounter(invoiceId, dto, actor) PaymentDto
    }
    class SepayWebhookController {
        +handle(body, headers) SepayAck
    }
    class DamageChargesController {
        +decide(id, dto, actor) DamageChargeDto
    }
    class SepayService {
        +createRequest(invoiceId, dto, caller) Payment
        +handleWebhook(body, headers) SepayAck
    }
    class DamageChargeService {
        +decide(id, dto, actor) DamageCharge
    }
    class InvoicesService {
        +issueTermInvoice(contract, term, tx) Invoice
    }
    class ChargesService {
        +chargeLate(contract, device, checkedInAt, tx)
        +chargeDamage(contract, inspection, tx)
        +chargeLoss(contract, device, lostAt, tx)
    }
    class BalanceService {
        +firstPaymentConfirmed(contractId) bool
        +outstanding(contractId) int
    }
    class PricingService {
        +quote(dto) Quote
        +snapshot(variantId) PriceSnapshot
    }
    class PaymentsRepository {
        +insertPending(row, tx) Payment
        +lockByReference(ref, tx) Payment
        +confirm(id, txnId, tx)
    }
    class InvoicesRepository {
        +insert(invoice, lines, tx) Invoice
        +applyPayment(invoiceId, amount, tx)
    }
    PaymentsController --> SepayService
    SepayWebhookController --> SepayService
    DamageChargesController --> DamageChargeService
    SepayService --> PaymentsRepository
    SepayService --> InvoicesRepository
    DamageChargeService --> InvoicesRepository
    InvoicesService --> InvoicesRepository
    ChargesService --> InvoicesRepository
    BalanceService --> InvoicesRepository
```

***Figure 3***: billing classes. `SepayWebhookController` is the one raw-response controller (D-038).

<!-- sdd: MF-05 seq UC-19 part 1 of 2: payment request -->
```mermaid
sequenceDiagram
    autonumber
    actor M as Org Manager
    participant P as InvoicePage
    participant C as PaymentsController
    participant S as SepayService
    participant R as PaymentsRepository
    M->>P: pay the invoice online
    P->>C: POST /api/invoices/{id}/payments/sepay
    C->>S: createRequest(invoiceId, dto, caller)
    S->>S: amount due, fresh reference, expiry
    S->>R: insertPending(amount, reference, expiresAt, tx)
    S-->>C: PaymentDto with VietQR
    C-->>P: 201 envelope, QR shown
    P->>C: poll the payment status
    C-->>P: PENDING, then CONFIRMED
```

***Figure 4***: UC-19 Pay Online, part 1 of 2: payment request.

<!-- sdd: MF-05 seq UC-19 part 2 of 2: confirming webhook -->
```mermaid
sequenceDiagram
    autonumber
    participant G as SePay sandbox
    participant W as SepayWebhookController
    participant S as SepayService
    participant R as PaymentsRepository
    participant IR as InvoicesRepository
    G->>W: POST /api/payments/sepay/webhook
    W->>S: handleWebhook(body, headers)
    S->>S: verify the API key in constant time
    S->>R: lockByReference(reference, tx)
    alt already CONFIRMED or transaction id known
        S->>S: log duplicate, COMMIT
    else first confirmation
        S->>R: confirm(id, txnId, tx)
        S->>IR: applyPayment(invoiceId, amount, tx)
        S->>S: COMMIT, emit payment.confirmed
    end
    S-->>W: success
    W-->>G: 200 in the gateway's format
```

***Figure 5***: UC-19 Pay Online, part 2 of 2: the gateway's confirming webhook, recorded once per
reference (FR-BILL-07, FR-BILL-08).

<!-- sdd: MF-05 seq UC-48 -->
```mermaid
sequenceDiagram
    autonumber
    actor Ad as TrekLink Admin
    participant P as DamageChargesPage
    participant C as DamageChargesController
    participant S as DamageChargeService
    participant R as DamageChargesRepository
    participant IR as InvoicesRepository
    Ad->>P: approve, reduce or waive a charge
    P->>C: POST /api/damage-charges/{id}/decision
    C->>S: decide(id, dto, actor)
    S->>R: lock(id, tx)
    R->>R: BEGIN, SELECT damage_charges FOR UPDATE
    alt not PENDING_APPROVAL
        S-->>C: 409
    else actor is the inspector
        S-->>C: 403 SEPARATION_OF_DUTY
    end
    S->>R: recordDecision(id, decision, amount, actor, tx)
    S->>IR: addDamageLine(contractId, amount, tx)
    IR->>IR: UPDATE, INSERT invoice line, COMMIT
    S-->>C: DamageChargeDto
    C-->>P: 200 envelope
```

***Figure 6***: UC-48 Approve Damage Charge. The approver is never the inspector (BR-24).
