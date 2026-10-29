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
    participant P as InvoicePage
    participant API as :SepayController
    participant S as :SepayService
    participant DB as Postgres
    participant SP as SePay sandbox
    M->>+P: pay the invoice online
    P->>+API: POST /api/invoices/{id}/payments/sepay
    API->>+S: request(invoiceId, lineSeq, caller)
    S->>+DB: INSERT payment PENDING, reference TLxxxx, expiresAt
    DB-->>-S: pending payment
    S-->>-API: payment and VietQR
    API-->>-P: VietQR image URL with amount and reference
    P-->>-M: show sandbox QR
    M->>+SP: scan and pay (sandbox)
    SP->>+API: POST /api/payments/sepay/webhook, Authorization Apikey
    Note over API,S: SepayWebhookGuard checks the API key before DTO validation
    API->>+S: handleWebhook(authorization, body)
    S->>S: constant-time key check, extract reference from content
    S->>+DB: SELECT payment by gateway transaction id
    DB-->>-S: whether the transaction is known
    alt gateway transaction id already recorded
        S->>S: no payment recorded
    else new gateway transaction id
        S->>+DB: BEGIN, lock reference, confirm or insert received payment, apply to lines, COMMIT
        DB-->>-S: recorded transfer
        S-)S: emit payment.confirmed
    end
    S-->>-API: webhook outcome
    API-->>-SP: 200 {"success": true}
    SP-->>-M: sandbox transfer complete
    P->>+API: GET /api/payments/{id} (polling)
    API-->>-P: CONFIRMED, MSG20
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

The contract balance must be open before a new QR request is inserted. An earlier invoice may
still have unpaid lines after a cancellation adjustment on the closing invoice settles the
contract; the request is then 409 `NOTHING_DUE`. The invoice page applies the same balance rule
to both SePay and counter-payment actions (the ruling on #87 point 4).

The API-key guard runs before body validation. A missing or wrong key is always 401
`WEBHOOK_UNAUTHENTICATED`, including when the DTO is invalid. The constant-time comparison also
runs for direct service callers. Deduplication is by gateway transaction id only. A different
transaction on a confirmed reference is its own confirmed payment; the invoice receives at most
what remains due, and any excess stays on that payment and is logged for Staff.

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

Port declared: `CONTRACT_DIRECTORY` (`ports/contract-directory.port.ts`), the contract code, organization
code and term sequence the invoice and payment reads show (api-design 08, 09, 14). `billing` may not read
`rental_contracts` or `contract_terms`, and `rentals` depends on `billing`, so `rentals` provides it the
D-032 way; the reads inject it `@Optional()` and show null codes without it.

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

`NOTHING_DUE` covers either an invoice/line with no unpaid amount or a contract whose balance
is settled after all invoices and cancellation credits are netted.

---

## 7. Testing strategy

Formula tests from the acceptance criteria; rounding at boundaries; webhook replay ×10; amount mismatch;
expiry; separation of duty; adjustment lines never mutating issued lines; concurrent counter payments on
one invoice.

---

## 8. Detailed design for Report 4 (D-044)

Layering as in `organizations` design §9. Figure 3 is the class view; Figures 4 to 11 are the
payments, prices, balance and return charges of MF-01 and MF-05.

<!-- sdd: MF-05 class billing -->
```mermaid
classDiagram
    class PaymentsController {
        +createSepay(invoiceId, dto, caller) PaymentDto
    }
    class InvoicesController {
        +recordCounter(invoiceId, dto, actor) PaymentDto
        +balance(contractId, caller) BalanceDto
    }
    class PricingAdminController {
        +setPrice(dto, caller) PriceDto
    }
    class PaymentsService {
        +recordCounter(invoiceId, input, actor) Payment
    }
    class BillingReadsService {
        +balance(contractId, caller) BalanceSummary
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
        +setPrice(input, caller) PriceSchedule
        +damageRateFor(code, variantId, tx) int
    }
    class PricingRepository {
        +insertPrice(row, tx) PriceSchedule
    }
    class DamageChargesRepository {
        +insert(charge, tx) DamageCharge
    }
    class ParameterService
    class PaymentsRepository {
        +insertPending(row, tx) Payment
        +lockByReference(ref, tx) Payment
        +confirm(id, txnId, tx)
    }
    class InvoicesRepository {
        +insert(invoice, lines, tx) Invoice
        +lockWithLines(invoiceId, tx) Invoice
        +lockClosingInvoice(contractId, tx) Invoice
        +appendLines(invoice, lines, tx) Invoice
        +applyPayment(invoiceId, amount, tx)
        +linesOfContract(contractId) InvoiceLine[]
    }
    PaymentsController --> SepayService
    InvoicesController --> PaymentsService
    InvoicesController --> BillingReadsService
    PricingAdminController --> PricingService
    PaymentsService --> InvoicesRepository
    PaymentsService --> PaymentsRepository
    BillingReadsService --> BalanceService
    BillingReadsService --> InvoicesRepository
    PricingService --> PricingRepository
    ChargesService --> PricingService : damageRateFor
    ChargesService --> DamageChargesRepository
    ChargesService --> ParameterService : grace, late fee, threshold
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
    participant W as :SepayController
    participant S as :SepayService
    participant R as :PaymentsRepository
    participant IR as :InvoicesRepository
    G->>+W: POST /api/payments/sepay/webhook
    Note over W,S: SepayWebhookGuard checks the API key before DTO validation
    W->>+S: handleWebhook(authorization, body)
    S->>S: verify the API key in constant time
    S->>+R: gatewayTxnExists(gatewayTxnId)
    R-->>-S: whether the transaction is known
    alt gateway transaction id already recorded
        S->>S: no payment recorded
    else new gateway transaction id
        S->>+R: lockByReference(reference, tx)
        R-->>-S: request
        S->>+R: confirmSepay(id, settlement, tx) or insertReceivedSepay(payment, tx)
        R-->>-S: confirmed payment
        S->>+IR: applyPayment(invoice, applied, tx)
        IR-->>-S: updated invoice
        S->>S: COMMIT, emit payment.confirmed
    end
    S-->>-W: outcome
    W-->>-G: 200 {"success": true}
```

***Figure 5***: UC-19 Pay Online, part 2 of 2: the gateway's confirming webhook, recorded once per
gateway transaction id. A different transfer for a confirmed reference is recorded as its own
payment, with only the unpaid invoice amount applied (FR-BILL-07, FR-BILL-08).

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

<!-- sdd: MF-01 seq UC-22 -->
```mermaid
sequenceDiagram
    autonumber
    actor St as TrekLink Staff
    participant P as BillingPage
    participant C as InvoicesController
    participant S as PaymentsService
    participant I as InvoicesRepository
    participant R as PaymentsRepository
    St->>P: record a counter payment: amount, method, receipt reference
    P->>C: POST /api/invoices/{id}/payments/counter
    C->>S: recordCounter(invoiceId, dto, actor)
    S->>I: lockWithLines(invoiceId, tx)
    alt refused: invoice not found
        S-->>C: 404 NOT_FOUND
        C-->>P: error envelope
    else refused: receipt reference already registered
        S->>R: referenceExists(reference, tx)
        S-->>C: 409 DUPLICATE_REFERENCE
        C-->>P: error envelope
    else refused: amount above what the invoice still owes
        S-->>C: 400 OVERPAYMENT
        C-->>P: error envelope
    else accepted
        S->>R: insertCounterPayment(row CONFIRMED, tx)
        S->>I: applyPayment(invoice, amount, tx)
        S-)S: emit PAYMENT_CONFIRMED and the audit record after commit
        S-->>C: payment
        C-->>P: 201 envelope
        P->>St: MSG20 with the amount
    end
```

***Figure 7***: UC-22 Record Counter Payment. The same dialog is step 2 of the counter handover; the
amount is applied to the invoice's lines oldest due first.

<!-- sdd: MF-01 seq UC-56 -->
```mermaid
sequenceDiagram
    autonumber
    actor A as TrekLink Admin
    participant P as PricesPage
    participant C as PricingAdminController
    participant S as PricingService
    participant R as PricingRepository
    A->>P: schedule a monthly price for a variant from a date
    P->>C: POST /api/price-schedules
    C->>S: setPrice(input, caller)
    alt refused: effective date in the past
        S-->>C: 400 EFFECTIVE_IN_PAST
        C-->>P: error envelope
    else effective now or later
        S->>R: insertPrice(row, tx)
        alt refused: unknown hardware variant
            R-->>S: foreign key violation
            S-->>C: 404 NOT_FOUND
            C-->>P: error envelope
        else accepted
            S-)S: emit the price.set audit record after commit
            S-->>C: price row
            C-->>P: 201 envelope
        end
    end
```

***Figure 8***: UC-56 Configure Plans and Prices. The schedule is append-only: a new row takes effect at
its date, and a contract keeps the price snapshotted at its request (UC-15).

<!-- sdd: MF-05 seq UC-45 -->
```mermaid
sequenceDiagram
    autonumber
    actor U as Org Manager or TrekLink Staff
    participant P as ContractDetailPage
    participant C as InvoicesController
    participant S as BillingReadsService
    participant B as BalanceService
    participant I as InvoicesRepository
    U->>P: open a contract
    P->>C: GET /api/contracts/{id}/balance
    C->>S: balance(contractId, caller)
    S->>I: organizationOfContract(contractId)
    alt refused: another organization's contract
        S-->>C: 404 NOT_FOUND
        C-->>P: error envelope
    else own contract, or TrekLink Staff
        S->>B: balanceSummary(contractId)
        B->>I: linesOfContract(contractId)
        B->>B: remaining after credits, split at now
        B-->>S: due now, due later, paid, settled
        S-->>C: BalanceSummary
        C-->>P: 200 envelope
    end
```

***Figure 9***: UC-45 Calculate Contract Balance. Due now is what falls due at or before the current time;
a settled contract offers no counter payment.

<!-- sdd: MF-05 seq UC-46 -->
```mermaid
sequenceDiagram
    autonumber
    actor St as TrekLink Staff
    participant P as CounterPage
    participant C as ContractsController
    participant S as ReturnService
    participant Ch as ChargesService
    participant Pm as ParameterService
    participant I as InvoicesRepository
    St->>P: scan a device returned after its due time
    P->>C: POST /api/contracts/{id}/check-ins
    C->>S: checkIn(id, dto, actor)
    loop each checked-in device
        S->>Ch: chargeLate(contract, device, checkedInAt, actor, tx)
        Ch->>Pm: rentals.returnGraceHours, billing.lateFeePerDevicePerDayVnd
        alt within the grace
            Ch-->>S: no charge
        else past the grace
            Ch->>Ch: days = started days after the due time
            Ch->>I: lockClosingInvoice(contractId, tx)
            alt closing invoice open
                Ch->>I: appendLines(closing, LATE_FEE line, tx)
            else no closing invoice yet
                Ch->>I: insert(CLOSING invoice with the LATE_FEE line, tx)
            end
            Ch-->>S: closing invoice
        end
    end
    S-->>C: CheckInDto with the late fee added
    C-->>P: 200 envelope
```

***Figure 10***: UC-46 Apply Late Fee, included in UC-43 Check In Device. One `LATE_FEE` line per late
device (FR-BILL-03, BR-23).

<!-- sdd: MF-05 seq UC-47 -->
```mermaid
sequenceDiagram
    autonumber
    actor St as TrekLink Staff
    participant P as CounterPage
    participant C as ContractsController
    participant S as ReturnService
    participant D as DevicesService
    participant Ch as ChargesService
    participant Pr as PricingService
    participant Pm as ParameterService
    participant Dc as DamageChargesRepository
    participant I as InvoicesRepository
    St->>P: record the inspection as DAMAGED with damage codes
    P->>C: POST /api/contracts/{id}/devices/{deviceId}/inspection
    C->>S: inspect(id, deviceId, dto, actor)
    S->>D: recordInspection(device, DAMAGED, codes, tx)
    S->>Ch: chargeDamage(contract, inspection, actor, tx)
    loop each damage code
        Ch->>Pr: damageRateFor(code, variantId, tx)
    end
    alt refused: a code with no active rate
        Ch-->>S: 400 VALIDATION_FAILED, nothing recorded
        S-->>C: error, rolled back
        C-->>P: error envelope
    else every code priced
        Ch->>Pm: billing.damageApprovalThresholdVnd
        alt above the threshold
            Ch->>Dc: insert(charge PENDING_APPROVAL, tx)
            Ch-->>S: charge waiting for an Admin (UC-48)
        else at or below the threshold
            Ch->>Dc: insert(charge APPROVED, tx)
            Ch->>I: DAMAGE line on the closing invoice (lockClosingInvoice, appendLines or insert)
            Ch-->>S: charge and closing invoice
        end
        S-->>C: InspectionDto
        C-->>P: 201 envelope
    end
```

***Figure 11***: UC-47 Apply Damage Fee, included in the return inspection. Each code is priced from the
damage schedule, the variant's own rate first and the generic rate otherwise (FR-BILL-04, BR-24).
