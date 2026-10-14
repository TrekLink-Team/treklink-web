# Technical Design: devices

> Fulfills `requirements.md` in this folder. Schema: the `// @module devices` block of
> `backend/prisma/schema.prisma` is authoritative.

---

## 1. Data model

```mermaid
erDiagram
    HARDWARE_VARIANT ||--o{ DEVICE : "models"
    DEVICE ||--o{ DEVICE_TRANSITION : "history"
    DEVICE ||--o{ INTAKE_CHECK : "checked"
    DEVICE ||--o{ DEVICE_PROVISIONING : "keyed"
    DEVICE ||--o{ DEVICE_RESET : "reset"
    DEVICE ||--o{ INSPECTION : "inspected"
    DEVICE ||--o{ MAINTENANCE_RECORD : "serviced"
    DEVICE {
        uuid id PK
        string assetTag UK
        bigint nodeNum UK
        enum status
        int keyVersion
        int version
    }
```

***Figure 1***: devices slice. `Inspection.contractDeviceId` points at the `rentals` row the inspection
closes; `StockTake` stands alone.

`nodeNum` is the unsigned 32-bit radio identity the firmware derives from the MAC
(`04-firmware-ground-truth.md` §3); registration accepts either the number or the `!xxxxxxxx` node id.
Remaining value (FR-BILL-05) is read from the variant's `remainingValueSchedule` by whole months since
`acquiredAt`: `valueAt(device, date)`.

---

## 2. Device lifecycle (D-035, amended by D-045)

```mermaid
stateDiagram-v2
    [*] --> IN_SERVICE : registered
    state "In service" as IN_SERVICE {
        [*] --> IN_INTAKE
        IN_INTAKE --> AVAILABLE : intake passed
        IN_INTAKE --> MAINTENANCE : intake failed
        AVAILABLE --> RESERVED : contract approved
        RESERVED --> AVAILABLE : reservation released
        RESERVED --> MAINTENANCE : failed counter check, swapped
        RESERVED --> RENTED : handover or replacement signed
        RENTED --> RETURNED : checked in, or replaced
        RETURNED --> AVAILABLE : reset and inspection passed
        RETURNED --> MAINTENANCE : inspection damaged or failed
        AVAILABLE --> MAINTENANCE : scheduled or reported
        MAINTENANCE --> AVAILABLE : intake passed again
    }
    IN_SERVICE --> LOST : loss reported, from any state in service
    LOST --> IN_SERVICE : recovered at the counter, to RETURNED
    LOST --> RETIRED : loss case settled
    IN_SERVICE --> RETIRED : retired, from MAINTENANCE
    RETIRED --> DISPOSED : verified wipe
    DISPOSED --> [*]
```

***Figure 2***: Device lifecycle; SRS Figure 23.

| From | To | Trigger | Caller | Guard |
|---|---|---|---|---|
| (none) | `IN_INTAKE` | register | Staff | unique tag and `nodeNum` |
| `IN_INTAKE`, `MAINTENANCE` | `AVAILABLE` | intake passed | Staff | no open maintenance record |
| `IN_INTAKE`, `AVAILABLE` | `MAINTENANCE` | intake failed, or maintenance opened | Staff | reason |
| `AVAILABLE` | `RESERVED` | `reserve()`, `reserveExplicit()` | rentals | locked with `SKIP LOCKED` |
| `RESERVED` | `AVAILABLE` | `release()` | rentals | contract cancelled, or swap |
| `RESERVED` | `MAINTENANCE` | `failHandoverCheck()` | rentals | swap at the counter (E01-5) |
| `RESERVED` | `RENTED` | `markRented()` | rentals | handover or replacement, provisioned at the organization's current key version |
| `RENTED` | `RETURNED` | `markReturned()` | rentals | check-in, or the faulty unit of a replacement |
| any in-service state | `LOST` | report loss | Org Manager (own rented device), Staff | no open loss case (BR-37) |
| `LOST` | `RETURNED` | recover | Staff | loss case `REPORTED`, `SEARCHING` or `SETTLED` |
| `LOST` | `RETIRED` | settle loss case | Admin | case `CONFIRMED`, Admin not the triager |
| `RETURNED` | `AVAILABLE`, `MAINTENANCE` | `recordInspection()` | rentals | reset logged after the last check-in |
| `MAINTENANCE` | `RETIRED` | retire | Admin | not on a live contract row |
| `RETIRED` | `DISPOSED` | dispose | Admin | wipe recorded (BR-42) |

Manual endpoints never reach the system-only rows; those are exported service methods taking `tx`.

---

## 2.1 Loss case (D-045)

```mermaid
stateDiagram-v2
    [*] --> REPORTED : loss reported
    REPORTED --> SEARCHING : triaged, custody decided, key exposure flagged
    REPORTED --> RECOVERED : device back before triage
    SEARCHING --> RECOVERED : device back at the counter
    SEARCHING --> CONFIRMED : Staff confirm, or search window elapsed
    CONFIRMED --> SETTLED : charged, reduced, waived or written off
    RECOVERED --> [*]
    SETTLED --> [*]
```

***Figure 2a***: Loss case lifecycle; SRS Figure 24.

Custody is decided at triage from `rentals.custodyAt(deviceId, lastSeenAt)`, the same custody intervals that
attribute field events (D-040). `RENTER` custody marks the organization's channel key exposed through
`organizations.markKeyExposed`, and confirmation charges the remaining value through `billing.chargeLoss`;
`TREKLINK` custody is written off. The `devices.lossSearch` job confirms `SEARCHING` cases whose
`searchEndsAt` has passed, with the usual compare-and-set on state and version. A device recovered after
settlement goes to `RETURNED` while its case stays `SETTLED`; any refund is a billing adjustment (E05-10).

---

## 3. Services other modules call

| Method | Caller |
|---|---|
| `reserve(variantId, quantity, contractId, tx)` returns device ids or throws `INSUFFICIENT_DEVICES` | rentals |
| `reserveExplicit(deviceIds, contractId, tx)` | rentals |
| `release(deviceIds, tx)`, `failHandoverCheck(deviceId, reason, tx)` | rentals |
| `recordProvisioning(deviceId, orgId, keyVersion, actor, tx)` | rentals |
| `assertReadyForHandover(deviceIds, keyVersion)` | rentals |
| `markRented(ids, tx)`, `markReturned(id, tx)` | rentals |
| `openLossForReplacement(deviceId)` returns whether the device has an open loss case | rentals |
| `recordInspection(deviceId, dto, contractDeviceId, actor, tx)` returns the inspection | rentals |
| `valueAt(deviceId, date)` | billing |
| `projectReading(nodeNum, reading, tx)` returns the device id or null | gateway-sync |
| `byNodeNum(nodeNum)`, `projections(ids)`, `trail(id)` | gateway-sync, monitoring |
| `availability(variantId?)` | rentals, monitoring |

---

## 4. Error catalogue

| Code | HTTP |
|---|---|
| `INVALID_STATE_TRANSITION` | 409 |
| `INSUFFICIENT_DEVICES` | 409 |
| `RESET_REQUIRED` | 409 |
| `RESET_INCOMPLETE` | 400 |
| `MOTION_RESULT_REQUIRED` | 400 |
| `MAINTENANCE_OPEN` | 409 |
| `VARIANT_IN_USE` | 409 |
| `SCHEDULE_INVALID` | 400 |
| `KEY_VERSION_MISMATCH` | 409 |
| `DEVICE_NOT_PROVISIONED` | 409 |

---

## 5. Sequence: return loop (check-in, reset, inspection)

```mermaid
sequenceDiagram
    autonumber
    actor S as TrekLink Staff
    participant R as rentals ReturnService
    participant D as DevicesService
    participant B as BillingService
    participant DB as Postgres
    S->>R: check-in TL-0042
    R->>D: markReturned(id, tx)
    D->>DB: RENTED to RETURNED, transition row
    S->>D: reset(id, all steps)
    D->>DB: INSERT device_resets, clear keyVersion
    S->>R: inspection DAMAGED [ANTENNA_BROKEN]
    R->>D: recordInspection(id, dto, tx)
    D->>DB: guard reset after check-in, INSERT inspection, RETURNED to MAINTENANCE
    R->>B: chargeDamage(contract, inspection, tx)
```

***Figure 3***: The MF-05 return loop; one transaction per arrow from Staff.

---

## 6. Testing strategy

State-matrix test over all 64 pairs; reservation race with two transactions on Postgres; reset-before-
inspection guard; remaining-value lookup by age; projection ignores older readings.

---

## 7. Detailed design for Report 4 (D-044)

Layering as in `organizations` design §9. Figures 4 and 7 are the class views, core and loss cases;
Figures 5, 6 and 8 to 11 are the MF-05 reset, inspection, loss case and disposal interactions.

<!-- sdd: MF-05 class devices -->
```mermaid
classDiagram
    class DevicesController {
        +register(dto, actor) DeviceDto
        +intakeCheck(id, dto, actor) DeviceDto
        +reset(id, dto, actor) DeviceDto
        +maintenance(id, dto, actor) MaintenanceDto
        +retire(id, dto, actor) DeviceDto
    }
    class DevicesService {
        +reserve(variantId, quantity, contractId, tx) string[]
        +recordProvisioning(deviceId, orgId, keyVersion, actor, tx)
        +markRented(ids, tx)
        +markReturned(id, tx)
        +recordInspection(deviceId, dto, contractDeviceId, actor, tx) Inspection
        +projectReading(nodeNum, reading, tx) string
    }
    class DeviceLifecycleService {
        +reset(id, dto, actor) Device
        +retire(id, dto, actor) Device
        +dispose(id, dto, actor) Device
        -apply(id, from, to, reason, tx)
    }
    class DeviceFsm {
        +assertTransition(from, to)
    }
    class DevicesRepository {
        +lockAvailable(variantId, quantity, tx) Device[]
        +transition(id, from, to, version, reason, tx)
        +insertReset(row, tx)
        +insertInspection(row, tx) Inspection
    }
    DevicesController --> DeviceLifecycleService
    DevicesController --> DevicesService
    DeviceLifecycleService --> DeviceFsm
    DevicesService --> DeviceFsm
    DeviceLifecycleService --> DevicesRepository
    DevicesService --> DevicesRepository
```

***Figure 4***: devices classes. `DeviceFsm` holds the transition table of Figure 2.

<!-- sdd: MF-05 seq UC-44 part 1 of 2: reset -->
```mermaid
sequenceDiagram
    autonumber
    actor St as TrekLink Staff
    participant P as DeviceDetailPage
    participant C as DevicesController
    participant L as DeviceLifecycleService
    participant R as DevicesRepository
    St->>P: reset the returned device
    P->>C: POST /api/devices/{id}/reset
    C->>L: reset(id, dto, actor)
    L->>R: lock and require RETURNED
    alt reset failed on the counter tool
        L->>R: transition(id, RETURNED, MAINTENANCE, version, tx)
    end
    L->>R: insertReset(row, tx)
    R->>R: INSERT device_resets, clear key version
    L-->>C: DeviceDto
    C-->>P: 200 envelope
```

***Figure 5***: UC-44 Reset and Inspect Device, part 1 of 2: reset.

<!-- sdd: MF-05 seq UC-44 part 2 of 2: inspection -->
```mermaid
sequenceDiagram
    autonumber
    actor St as TrekLink Staff
    participant P as CounterPage
    participant C as ContractsController
    participant RS as ReturnService
    participant S as DevicesService
    participant R as DevicesRepository
    participant Ch as ChargesService
    St->>P: condition, photos of damage
    P->>C: POST /api/contracts/{id}/devices/{deviceId}/inspection
    C->>RS: inspect(id, deviceId, dto, actor)
    RS->>S: recordInspection(deviceId, dto, contractDeviceId, actor, tx)
    S->>R: insertInspection(row, tx)
    alt condition OK and reset logged
        S->>R: transition(id, RETURNED, AVAILABLE, version, tx)
    else damaged
        S->>R: transition(id, RETURNED, MAINTENANCE, version, tx)
        RS->>Ch: chargeDamage(contract, inspection, tx)
    end
    RS-->>C: InspectionDto
    C-->>P: 200 envelope
```

***Figure 6***: UC-44 Reset and Inspect Device, part 2 of 2: inspection. A device reaches `AVAILABLE`
only after a logged reset and a passed inspection (BR-28).

<!-- sdd: MF-05 class devices-loss -->
```mermaid
classDiagram
    class LossCasesController {
        +report(deviceId, dto, caller) LossCaseDto
        +triage(id, dto, actor) LossCaseDto
        +recover(id, dto, actor) LossCaseDto
        +confirm(id, dto, actor) LossCaseDto
        +decide(id, dto, actor) LossCaseDto
    }
    class LossCaseService {
        +report(deviceId, dto, caller) LossCase
        +triage(id, dto, actor) LossCase
        +confirm(id, actor) LossCase
        +decide(id, dto, actor) LossCase
    }
    class LossSearchJob {
        +run()
    }
    class LossCasesRepository {
        +insert(row, tx) LossCase
        +compareAndSet(id, from, to, patch, tx) bool
        +dueForConfirmation(now) LossCase[]
    }
    class DevicesService
    class RentalsService
    class OrganizationsService
    class ComplianceCaseService
    class ChargesService
    LossCasesController --> LossCaseService
    LossSearchJob --> LossCaseService
    LossCaseService --> LossCasesRepository
    LossCaseService --> DevicesService : LOST, RETURNED, RETIRED
    LossCaseService --> RentalsService : custodyAt
    LossCaseService --> OrganizationsService : markKeyExposed
    LossCaseService --> ComplianceCaseService : openOrLink
    LossCaseService --> ChargesService : chargeLoss, adjustLoss
```

***Figure 7***: devices classes for loss cases (D-045).

<!-- sdd: MF-05 seq UC-49 -->
```mermaid
sequenceDiagram
    autonumber
    actor M as Org Manager
    participant P as ContractDetailPage
    participant C as LossCasesController
    participant S as LossCaseService
    participant D as DevicesService
    participant R as LossCasesRepository
    M->>P: report TL-0042 lost, last seen at Phan Dung camp
    P->>C: POST /api/devices/{id}/loss-cases
    C->>S: report(deviceId, dto, caller)
    S->>D: require in service and rented by the caller's organization
    alt a loss case is already open
        S-->>C: 409 LOSS_CASE_OPEN
    end
    S->>D: transition(deviceId, current, LOST, tx)
    S->>R: insert(case REPORTED, last seen time and position, tx)
    S->>S: COMMIT, notify TrekLink Staff
    S-->>C: LossCaseDto REPORTED
    C-->>P: 201 envelope
```

***Figure 8***: UC-49 Report Lost Device. Staff report a unit missing at stock-take through the same call.

<!-- sdd: MF-05 seq UC-60 part 1 of 2: triage -->
```mermaid
sequenceDiagram
    autonumber
    actor St as TrekLink Staff
    participant P as LossCasePage
    participant C as LossCasesController
    participant S as LossCaseService
    participant Rt as RentalsService
    participant O as OrganizationsService
    participant R as LossCasesRepository
    St->>P: triage, suspected theft no
    P->>C: POST /api/loss-cases/{id}/triage
    C->>S: triage(id, dto, actor)
    S->>Rt: custodyAt(deviceId, lastSeenAt)
    alt a custody interval contains the time
        S->>O: markKeyExposed(orgId)
        S->>S: custody RENTER
    else none
        S->>S: custody TREKLINK
    end
    opt suspected theft or fraud
        S->>O: openOrLink compliance case
    end
    S->>R: compareAndSet(id, REPORTED, SEARCHING, searchEndsAt, tx)
    S-->>C: LossCaseDto SEARCHING
    C-->>P: 200 envelope
```

***Figure 9***: UC-60 Resolve Loss Case, part 1 of 2: triage by custody (D-040, D-045).

<!-- sdd: MF-05 seq UC-60 part 2 of 2: confirmation and settlement -->
```mermaid
sequenceDiagram
    autonumber
    participant J as LossSearchJob
    participant S as LossCaseService
    participant B as ChargesService
    participant R as LossCasesRepository
    actor Ad as TrekLink Admin
    participant C as LossCasesController
    J->>R: SEARCHING cases with searchEndsAt passed
    J->>S: confirm(id, SYSTEM)
    S->>R: compareAndSet(id, SEARCHING, CONFIRMED, tx)
    opt RENTER custody
        S->>B: chargeLoss(contract, device, confirmedAt, tx)
    end
    Ad->>C: POST /api/loss-cases/{id}/decision, REDUCED
    C->>S: decide(id, dto, actor)
    alt actor triaged the case
        S-->>C: 403 SEPARATION_OF_DUTY
    end
    S->>B: adjustLoss(caseId, REDUCED, chargeVnd, tx)
    S->>R: compareAndSet(id, CONFIRMED, SETTLED, decision, tx)
    S->>S: device LOST to RETIRED, rentals sets lostAt
    S-->>C: LossCaseDto SETTLED
```

***Figure 10***: UC-60 Resolve Loss Case, part 2 of 2: confirmation and settlement with the waiver rule
(BR-39).

<!-- sdd: MF-05 seq UC-62 -->
```mermaid
sequenceDiagram
    autonumber
    actor Ad as TrekLink Admin
    participant P as DeviceDetailPage
    participant C as DevicesController
    participant L as DeviceLifecycleService
    participant R as DevicesRepository
    Ad->>P: wipe recorded, method recycled
    P->>C: POST /api/devices/{id}/dispose
    C->>L: dispose(id, dto, actor)
    L->>R: lock and require RETIRED
    alt a wipe step not done
        L-->>C: 400 WIPE_INCOMPLETE
    end
    L->>R: insertDisposal(row, tx)
    L->>R: transition(id, RETIRED, DISPOSED, version, tx)
    L-->>C: DeviceDto DISPOSED
    C-->>P: 201 envelope
```

***Figure 11***: UC-62 Dispose Device (BR-42).
