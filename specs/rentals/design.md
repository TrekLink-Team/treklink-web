# Technical Design: rentals

> Fulfills `requirements.md` in this folder. Schema: the `// @module rentals` block of
> `backend/prisma/schema.prisma` is authoritative.

---

## 1. Data model

```mermaid
erDiagram
    ORGANIZATION ||--o{ RENTAL_CONTRACT : "rents under"
    HARDWARE_VARIANT ||--o{ RENTAL_CONTRACT : "of variant"
    RENTAL_CONTRACT ||--|{ CONTRACT_TERM : "terms"
    RENTAL_CONTRACT ||--|{ CONTRACT_DEVICE : "commits"
    DEVICE ||--o{ CONTRACT_DEVICE : "committed as"
    RENTAL_CONTRACT ||--o{ CONTRACT_TRANSITION : "history"
    RENTAL_CONTRACT {
        uuid id PK
        string code UK
        enum planType
        int quantity
        bigint monthlyUnitPriceVnd
        enum status
        int version
    }
    CONTRACT_DEVICE {
        uuid id PK
        datetime releasedAt
        datetime handedOverAt
        datetime checkedInAt
        datetime lostAt
    }
```

***Figure 1***: rentals slice. A `ContractDevice` row is live while `releasedAt`, `checkedInAt` and
`lostAt` are all null; one live row per device (BR-03).

---

## 2. Rental-contract lifecycle (D-035)

```mermaid
stateDiagram-v2
    [*] --> REQUESTED : Manager requests
    REQUESTED --> APPROVED : Staff approve, devices reserved
    REQUESTED --> REJECTED : Staff reject
    REQUESTED --> CANCELLED : cancelled
    APPROVED --> CANCELLED : cancelled before handover
    APPROVED --> ACTIVE : first payment and handover signed
    ACTIVE --> ENDING : monthly notice given
    ACTIVE --> RETURN_DUE : day plan ends
    ENDING --> RETURN_DUE : current term ends
    RETURN_DUE --> RETURNED : every device back or lost
    RETURN_DUE --> OVERDUE : grace elapsed, devices out
    OVERDUE --> RETURNED : every device back or lost
    OVERDUE --> DEFAULTED : default threshold elapsed
    DEFAULTED --> RETURNED : devices recovered or recorded lost
    RETURNED --> CLOSED : nothing owed, no open incident
    REJECTED --> [*]
    CANCELLED --> [*]
    CLOSED --> [*]
```

***Figure 2***: Rental-contract lifecycle; SRS Figure 28. Devices checked in early, while a day plan is
`ACTIVE` or a monthly contract `ENDING`, stay checked in; when the plan or term ends, the job moves the
contract to `RETURN_DUE` and, finding every device back or lost, straight on to `RETURNED` in the same
transaction. No edge outside D-035 is needed.

| From | To | Trigger | Actor |
|---|---|---|---|
| `REQUESTED` | `APPROVED`, `REJECTED` | approve, reject | Staff |
| `REQUESTED`, `APPROVED` | `CANCELLED` | cancel | Manager, Staff |
| `APPROVED` | `ACTIVE` | handover | Staff |
| `ACTIVE` | `ENDING` | notice (monthly) | Manager |
| `ACTIVE` | `RETURN_DUE` | day plan end | `SYSTEM` |
| `ENDING` | `RETURN_DUE` | term end | `SYSTEM` |
| `RETURN_DUE` | `OVERDUE` | grace elapsed | `SYSTEM` |
| `OVERDUE` | `DEFAULTED` | default threshold | `SYSTEM` (suspends the organization) |
| `RETURN_DUE`, `OVERDUE`, `DEFAULTED` | `RETURNED` | last device checked in or lost | Staff |
| `RETURNED` | `CLOSED` | close | Staff |

`returnDueAt` is the day-plan end, or the current term's end for an `ENDING` contract.

---

## 3. Terms and money

Terms are anchored to the **requested start date** at 09:00 UTC+7, not to the handover moment, so an
invoice's due dates are known when it is issued and never move (REQ-UBI-02 of `billing`). A **monthly**
contract's term *n* runs from the start date plus *n−1* calendar months to plus *n* months. At approval
term 1 is created and `billing.issueTermInvoice(contract, term, tx)` issues one invoice with two dated
lines (D-037): the holding fee (ratio × monthly unit price × quantity) due at the term start, and the
balance due at the term end. The handover may happen on the start date or later; a later handover does not
move the term, so Staff reschedule by rejecting and re-requesting before approval if the date slips. A
handover before the start date is refused. At each term end the rollover job, in one transaction, closes
the term and either opens the next with its invoice (no notice) or moves the contract to `RETURN_DUE`
(after notice).

A **day plan** has one term from the start date for its length, created at approval; its invoice has one `DAY_PLAN_FEE` line due at the start date, paid at the latest at the counter.

Every charge is computed by `billing` from the contract's snapshot; this module never does money
arithmetic.

---

## 4. Handover at the counter

1. Staff open the approved contract; the counter app lists the reserved devices.
2. Each device: Staff write the organization channel key with the provisioning tool, then record it
   (`POST .../provisioning`); the platform keeps only the key version (D-021).
3. Each device: battery and GPS fix are checked; a failing unit is swapped (E01-5).
4. The Manager reads the preview note and signs on the screen; Staff enter the identity document seen.
5. `HandoverService.complete` checks the first payment through `billing`, readiness through `devices`,
   renders the PDF with the signature, stores it under `HANDOVER_NOTE_STORAGE_DIR` with its SHA-256, and
   commits the `RENTED` devices and `ACTIVE` together.

---

## 5. Scheduler jobs

| Job | Rule | Idempotency |
|---|---|---|
| `rentals.termRollover` | terms with `endsAt <= now` and status `OPEN`; day plans past their end; a contract reaching `RETURN_DUE` with every device back or lost continues to `RETURNED` | each term closed by compare-and-set; a re-run finds nothing |
| `rentals.overdueAndDefault` | `RETURN_DUE` past grace to `OVERDUE`; `OVERDUE` past threshold to `DEFAULTED` and `organizations.suspendForDefault` | state compare-and-set |
| `rentals.reservationReminders` | `APPROVED` past `reservationExpiresAt`, not yet reminded | reminder flag in the transition reason |

---

## 6. Services and ports

| Export | Used by |
|---|---|
| `RentalsService.custodyAt(deviceId, at, marginSeconds)` returns the `ContractDevice` whose interval (`handedOverAt` to `checkedInAt` or `lostAt`, open-ended while neither is set) contains `at`, with its contract and organization and a `nearBoundary` flag, whatever state the contract is in now; none when no interval contains `at` (D-040) | gateway-sync |
| `RentalsService.currentHolder(deviceId)` returns the contract and organization holding the device now | monitoring (`device.*` entries) |
| `RentalsService.visibleDevices(ctx)`, `rentalPeriods(deviceId, orgId)` | monitoring |
| `RentalsService.contractsOfDevice(deviceId)`, `statusOf(contractId)`, `utilization(range)` | monitoring, incidents |
| provider of `ORGANIZATION_EXIT_CHECKS.canClose` | organizations |

Declares `CONTRACT_CLOSE_CHECKS` (multi): `{ blockingReason(contractId, deviceIds): Promise<Reason | null> }`.

Events emitted: `contract.statusChanged`, `device.handedOver`, `device.checkedIn`, `device.labelChanged`, `audit.record`.

---

## 7. Error catalogue

| Code | HTTP |
|---|---|
| `BELOW_MOQ` | 400 |
| `DAY_PLAN_LENGTH` | 400 |
| `ORGANIZATION_NOT_ACTIVE` | 409 |
| `INSUFFICIENT_DEVICES` | 409 |
| `DEVICE_NOT_ON_CONTRACT` | 409 |
| `FIRST_PAYMENT_MISSING` | 409 |
| `DEVICE_NOT_PROVISIONED` | 409 |
| `DEVICE_CHECK_FAILED` | 409 |
| `LOW_BATTERY` | 409 |
| `SIGNER_NOT_MANAGER` | 400 |
| `NOTE_NOT_SIGNED` | 409 |
| `BEFORE_START_DATE` | 409 |
| `DAY_PLAN_NO_NOTICE` | 409 |
| `BALANCE_OUTSTANDING` | 409 |
| `OPEN_INCIDENTS` | 409 |
| `KEY_VERSION_MISMATCH` | 409 |
| `RESET_REQUIRED` | 409 |

---

## 8. Sequence: approval under contention

```mermaid
sequenceDiagram
    autonumber
    actor S1 as Staff 1
    actor S2 as Staff 2
    participant L as ContractLifecycleService
    participant D as DevicesService
    participant B as BillingService
    participant DB as Postgres
    par
        S1->>L: approve(C1, 5 x v3)
        L->>D: reserve(v3, 5, C1, tx1)
        D->>DB: SELECT AVAILABLE FOR UPDATE SKIP LOCKED LIMIT 5
    and
        S2->>L: approve(C2, 5 x v3)
        L->>D: reserve(v3, 5, C2, tx2)
        D->>DB: SELECT AVAILABLE FOR UPDATE SKIP LOCKED LIMIT 5
    end
    Note over D,DB: 7 available: tx1 locks 5, tx2 sees only 2
    D-->>L: tx2 gets 2 of 5, INSUFFICIENT_DEVICES, rollback
    L->>B: issueTermInvoice(C1, term 1, tx1)
    L->>DB: C1 APPROVED, COMMIT
```

***Figure 3***: E01-1. `SKIP LOCKED` makes the loser count only unlocked rows, so it fails fast instead of
waiting and then over-allocating.

---

## 9. Testing strategy

Lifecycle matrix; the approval race on Postgres; term rollover across month ends (31 to 30 days) and
across a scheduler outage; overdue and default timing with a fake clock; close guards through stubbed
ports; holder labels erased on close.

---

## 10. Detailed design for Report 4 (D-044)

Layering as in `organizations` design §9. Figure 4 is the class view; Figures 5 to 11 are the
contract interactions of MF-01 and MF-05.

<!-- sdd: MF-01 class rentals -->
```mermaid
classDiagram
    class ContractsController {
        +request(dto, caller) ContractDto
        +approve(id, dto, actor) ContractDto
        +provision(id, deviceId, dto, actor) ContractDeviceDto
        +handover(id, dto, actor) ContractDto
        +checkIn(id, dto, actor) CheckInDto
        +inspect(id, deviceId, dto, actor) InspectionDto
        +close(id, dto, actor) ContractDto
    }
    class ContractsService {
        +request(dto, caller) RentalContract
        +custodyAt(deviceId, at, margin) Custody
        +currentHolder(deviceId) Holder
    }
    class ContractLifecycleService {
        +approve(id, dto, actor) RentalContract
        +close(id, dto, actor) RentalContract
        -apply(id, from, to, reason, tx)
    }
    class HandoverService {
        +provision(id, deviceId, dto, actor)
        +complete(id, dto, actor) RentalContract
    }
    class ReturnService {
        +checkIn(id, dto, actor)
        +inspect(id, deviceId, dto, actor)
    }
    class ReplacementService {
        +replace(id, deviceId, dto, actor) ContractDevice
    }
    class ContractsRepository {
        +insertRequested(data, tx) RentalContract
        +lockById(id, tx) RentalContract
        +insertContractDevices(rows, tx)
        +findCustody(deviceId, at) ContractDevice
        +transition(id, from, to, version, reason, tx)
    }
    class OrganizationsService
    class DevicesService
    class PricingService
    class InvoicesService
    class BalanceService
    class ChargesService
    ContractsController --> ContractsService
    ContractsController --> ContractLifecycleService
    ContractsController --> HandoverService
    ContractsController --> ReturnService
    ContractsController --> ReplacementService
    ReplacementService --> ContractsRepository
    ReplacementService --> DevicesService : reserveExplicit, markRented
    ContractsService --> ContractsRepository
    ContractLifecycleService --> ContractsRepository
    HandoverService --> ContractsRepository
    ReturnService --> ContractsRepository
    ContractsService --> OrganizationsService : assertActive
    ContractsService --> PricingService : snapshot
    ContractLifecycleService --> DevicesService : reserve
    ContractLifecycleService --> InvoicesService : issueTermInvoice
    HandoverService --> BalanceService : firstPaymentConfirmed
    HandoverService --> DevicesService : markRented
    ReturnService --> DevicesService : markReturned
    ReturnService --> ChargesService : chargeLate, chargeDamage
```

***Figure 4***: rentals classes. Services on the right belong to `organizations`, `devices` and `billing`.

<!-- sdd: MF-01 seq UC-15 -->
```mermaid
sequenceDiagram
    autonumber
    actor M as Org Manager
    participant P as ContractRequestPage
    participant C as ContractsController
    participant S as ContractsService
    participant O as OrganizationsService
    participant Pr as PricingService
    participant R as ContractsRepository
    M->>P: plan, variant, quantity, start date
    P->>C: POST /api/contracts
    C->>S: request(dto, caller)
    S->>O: assertActive(orgId)
    alt organization not ACTIVE
        S-->>C: 409 ORGANIZATION_NOT_ACTIVE
    end
    S->>S: minimum order quantity, day-plan length
    S->>Pr: snapshot(variantId)
    S->>R: insertRequested(contract, snapshot, tx)
    R->>R: INSERT REQUESTED and transition
    S-->>C: ContractDto REQUESTED
    C-->>P: 201 envelope
```

***Figure 5***: UC-15 Request Rental Contract. The quote shown before the request is `POST /api/quotes`,
answered by `PricingService.quote`.

<!-- sdd: MF-01 seq UC-17 -->
```mermaid
sequenceDiagram
    autonumber
    actor St as TrekLink Staff
    participant P as ContractApprovalPage
    participant C as ContractsController
    participant L as ContractLifecycleService
    participant D as DevicesService
    participant I as InvoicesService
    participant R as ContractsRepository
    St->>P: approve contract
    P->>C: POST /api/contracts/{id}/approve
    C->>L: approve(id, dto, actor)
    L->>R: lockById(id, tx)
    L->>D: reserve(variantId, quantity, id, tx)
    alt fewer AVAILABLE than requested
        L-->>C: 409 INSUFFICIENT_DEVICES, rolled back
    end
    L->>R: insertContractDevices(rows, tx)
    L->>I: issueTermInvoice(contract, term 1, tx)
    L->>R: transition(id, REQUESTED, APPROVED, version, tx)
    L-->>C: ContractDto APPROVED
    C-->>P: 200 envelope
```

***Figure 6***: UC-17 Approve Rental Contract. `reserve` locks `AVAILABLE` devices with `SKIP LOCKED`
(Figure 3).

<!-- sdd: MF-01 seq UC-20 part 1 of 2: provisioning -->
```mermaid
sequenceDiagram
    autonumber
    actor St as TrekLink Staff
    participant P as CounterPage
    participant C as ContractsController
    participant H as HandoverService
    participant O as OrganizationsService
    participant D as DevicesService
    loop each reserved device
        St->>P: channel key written with the provisioning tool
        P->>C: POST /api/contracts/{id}/devices/{deviceId}/provisioning
        C->>H: provision(id, deviceId, dto, actor)
        H->>O: channelKeyVersion(orgId)
        H->>D: recordProvisioning(deviceId, orgId, keyVersion, actor, tx)
        D-->>H: provisioned, key version only
        H-->>C: ContractDeviceDto
        C-->>P: 200 envelope
    end
```

***Figure 7***: UC-20 Hand Over Devices, part 1 of 2: UC-14 Provision Device for each reserved device.

<!-- sdd: MF-01 seq UC-20 part 2 of 2: signed handover -->
```mermaid
sequenceDiagram
    autonumber
    actor M as Org Manager
    participant P as CounterPage
    participant C as ContractsController
    participant H as HandoverService
    participant B as BalanceService
    participant D as DevicesService
    participant R as ContractsRepository
    M->>P: sign the handover note on screen
    P->>C: POST /api/contracts/{id}/handover
    C->>H: complete(id, dto, actor)
    H->>B: firstPaymentConfirmed(id)
    alt not paid
        H-->>C: 409 FIRST_PAYMENT_MISSING, MSG23
    end
    H->>D: assertReadyForHandover(deviceIds, keyVersion)
    H->>H: render PDF with signature, store it with its SHA-256
    H->>D: markRented(deviceIds, tx)
    H->>R: setHandedOver(rows, now, tx)
    H->>R: transition(id, APPROVED, ACTIVE, version, tx)
    H-->>C: ContractDto ACTIVE
    C-->>P: 200 envelope
```

***Figure 8***: UC-20 Hand Over Devices, part 2 of 2: UC-21 Sign Handover Note and activation.
`setHandedOver` opens each device's custody interval (D-040).

<!-- sdd: MF-05 seq UC-43 -->
```mermaid
sequenceDiagram
    autonumber
    actor St as TrekLink Staff
    participant P as CounterPage
    participant C as ContractsController
    participant S as ReturnService
    participant D as DevicesService
    participant Ch as ChargesService
    participant R as ContractsRepository
    St->>P: scan returned asset tags
    P->>C: POST /api/contracts/{id}/check-ins
    C->>S: checkIn(id, dto, actor)
    S->>R: lockById(id, tx)
    alt tag not on this contract
        S-->>C: 409 DEVICE_NOT_ON_CONTRACT, MSG12
    end
    loop each device
        S->>R: setCheckedIn(contractDeviceId, now, actor, tx)
        S->>D: markReturned(deviceId, tx)
        S->>Ch: chargeLate(contract, device, checkedInAt, tx)
    end
    opt every device back or lost
        S->>R: transition(id, current, RETURNED, version, tx)
    end
    S-->>C: CheckInDto
    C-->>P: 200 envelope
```

***Figure 9***: UC-43 Check In Device. `setCheckedIn` closes the custody interval (D-040); late events
from the organization's Field Station are still attributed to it.

<!-- sdd: MF-05 seq UC-51 -->
```mermaid
sequenceDiagram
    autonumber
    actor St as TrekLink Staff
    participant P as ContractDetailPage
    participant C as ContractsController
    participant L as ContractLifecycleService
    participant K as CONTRACT_CLOSE_CHECKS
    participant R as ContractsRepository
    St->>P: close contract
    P->>C: POST /api/contracts/{id}/close
    C->>L: close(id, dto, actor)
    L->>R: lockById(id, tx)
    R->>R: BEGIN, SELECT contract FOR UPDATE
    L->>K: blockingReason(id, deviceIds)
    Note over K: billing reports a balance, incidents report an open incident
    alt a check blocks
        L-->>C: 409 BALANCE_OUTSTANDING or OPEN_INCIDENTS
        C-->>P: failure envelope
    end
    L->>R: eraseHolderLabels(id, tx)
    L->>R: transition(id, RETURNED, CLOSED, version, tx)
    R->>R: UPDATE, INSERT transition, COMMIT
    L-->>C: ContractDto CLOSED
    C-->>P: 200 envelope
```

***Figure 10***: UC-51 Close Rental Contract.

<!-- sdd: MF-05 seq UC-61 -->
```mermaid
sequenceDiagram
    autonumber
    actor St as TrekLink Staff
    participant P as CounterPage
    participant C as ContractsController
    participant S as ReplacementService
    participant D as DevicesService
    participant R as ContractsRepository
    St->>P: replace faulty TL-0042 with TL-0051, Manager signs
    P->>C: POST /api/contracts/{id}/devices/{deviceId}/replacement
    C->>S: replace(id, deviceId, dto, actor)
    S->>R: lockById(id, tx), require ACTIVE or ENDING
    opt faulty unit at the counter
        S->>R: setCheckedIn(oldRow, now, tx)
        S->>D: markReturned(oldDeviceId, tx)
    end
    S->>D: reserveExplicit([newDeviceId], id, tx)
    S->>D: recordProvisioning(newDeviceId, orgId, keyVersion, tx)
    S->>S: render the signed replacement note, SHA-256
    S->>R: insert(contract device, replacesId, handedOverAt now, tx)
    S->>D: markRented([newDeviceId], tx)
    S-->>C: ReplacementDto
    C-->>P: 201 envelope
```

***Figure 11***: UC-61 Replace Device on Contract. The new row opens its own custody interval; plan, variant
and quantity are unchanged (BR-41).
