# Technical Design: devices

> Fulfills `requirements.md` in this folder. Schema: the `// @module devices` block of
> `backend/prisma/schema.prisma` is authoritative.
>
> **Status**: Approved, written by KhoaDD and merged on `dev` (treklink-web PR #30 and #31, 2026-10-18). Changes go through a pull request reviewed by KhoaDD (D-052).

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
        date serviceDueAt
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

The projection (`lastSeenAt`, `batteryPct`, `lastBatteryAt`, `lastLatitude`, `lastLongitude`, `lastPositionAt`) is written by
`gateway-sync` through `projectReading` and never moves backwards (REQ-EVT-08). `lastPositionAt` is the time of
the reading that set the position, because a reading without a position moves `lastSeenAt` only; monitoring
uses it to show an organization only a position from inside its custody interval (monitoring REQ-UBI-04,
D-092 rule 2, migration `20261101210100_devices_last_position_at`). It is null for a position stored before
the column existed. `lastBatteryAt` does the same for `batteryPct` (migration
`20261102040000_devices_last_battery_at`, 2026-11-02): a reading without a battery value leaves the stored
battery, and its time, as they were.

---

## 2. Device lifecycle (D-035, amended by D-045 and D-047)

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
        RETURNED --> MAINTENANCE : inspection damaged or failed, or due for service or firmware
        AVAILABLE --> MAINTENANCE : weekly scan, or fault reported
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
| `IN_INTAKE`, `AVAILABLE` | `MAINTENANCE` | intake failed, or maintenance opened | Staff | reason, expected date |
| `AVAILABLE` | `MAINTENANCE` | `devices.serviceScan` | SYSTEM | service due within 7 days plus lead days, or firmware differs from the baseline; no open record |
| `AVAILABLE` | `RESERVED` | `reserve()` at approval or swap, `takeForReplacement()` | rentals | locked with `SKIP LOCKED`; transition reason `RESERVED` |
| `RESERVED` | `AVAILABLE` | `release()` | rentals | contract cancelled; transition reason `RELEASED` |
| `RESERVED` | `MAINTENANCE` | `failHandoverCheck()` | rentals | swap at the counter (E01-5); opens a `HANDOVER_CHECK_FAILED` maintenance record with the swap reason; transition reason `HANDOVER_CHECK_FAILED` |
| `RESERVED` | `RENTED` | `markRented()` | rentals | handover or replacement, provisioned at the organization's current key version; transition reason `HANDED_OVER` |
| `RENTED` | `RETURNED` | `markReturned()` | rentals | check-in, or the faulty unit of a replacement; transition reason `CHECKED_IN`, or `REPLACED` for the faulty unit |
| any in-service state | `LOST` | report loss | Org Manager (own rented device), Staff | no open loss case (BR-37) |
| `LOST`, or `RETIRED` with a `SETTLED` loss case | `RETURNED` | recover | Staff | loss case `REPORTED`, `SEARCHING` or `SETTLED`; a settled case moved the device to `RETIRED`, so recovery after settlement starts there (REQ-EVT-11, 2026-10-31) |
| `LOST` | `RETIRED` | settle loss case | Admin | case `CONFIRMED`, Admin not the triager |
| `RETURNED` | `AVAILABLE`, `MAINTENANCE` | `recordInspection()` | rentals | reset logged after the last check-in; a passed unit due for service or firmware goes to `MAINTENANCE` (FR-DEV-19) |
| `MAINTENANCE` | `RETIRED` | retire | Admin | not on a live contract row |
| `RETIRED` | `DISPOSED` | dispose | Admin | wipe recorded (BR-42) |

Manual endpoints never reach the system-only rows; those are exported service methods taking `tx`.

Every move a rentals method drives writes one `device_transitions` row per unit that moved, in the caller's
transaction (`DevicesRepository.moveWithTransitions`, or `insertTransitions` after the `SKIP LOCKED` pick of
`reserve()`): `refType` `CONTRACT`, `refId` the contract id, `note` the contract code, `actorId` the Staff or
Org Manager account that acted (a Manager's cancel records the Manager), or null (SYSTEM) for a scheduled job
(2026-10-30, demo smoke defect 2). The monitoring device history (api-design 07) tells these moves through its
contract entries and leaves the `CONTRACT` rows out, so each move appears once. A unit not in the source status neither moves nor gets a row.

**Next step back to `AVAILABLE` (REQ-EVT-23, D-092 rule 4).** `nextStepOf(status, resetSinceReturn,
openMaintenance)` in `next-step.ts` is the one rule, read by `DevicesService.detail` (api-design 07) and by
`DevicesService.nextSteps(deviceIds)`, the exported batch read `rentals` calls for the checked-in rows of a
contract: `RETURNED` without a reset since `statusChangedAt` is `RESET`, with one is `INSPECT`; `MAINTENANCE`
with an open record is `COMPLETE_MAINTENANCE`, without one `INTAKE`; `IN_INTAKE` is `INTAKE`; every other state
has none. `RESET` and `INSPECT` carry the contract of the last `RENTED` to `RETURNED` transition with `refType`
`CONTRACT`, because the inspection endpoint is the contract's (rentals api-design 16); a unit recovered outside a
contract carries none. A passed inspection still goes straight to `AVAILABLE` (leader ruling 2026-11-01): the
intake check follows only a maintenance record.

`DevicesService.openLossCases(deviceIds, tx)` gives `rentals` the open loss case (`REPORTED`, `SEARCHING` or
`CONFIRMED`) of each unit, for the close check of rentals api-design 20 (D-092 rule 3).

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

Custody is decided at triage from `CUSTODY_RESOLVER.custodyAt(deviceId, lastSeenAt)`, the same custody intervals that
attribute field events (D-040), checked against `custodyAt(deviceId, reportedAt)`. The interval of the
last seen time counts only when it is the same rental as the interval at the report time; otherwise the
custody at the report time counts, and that is `TREKLINK` only when no rental holds the unit at the
report time (leader rulings 2026-10-31 and 2026-11-01). So a unit lost in the store after check-in, last
heard while still out, is `TREKLINK`; a unit last heard in an earlier rental, or outside any rental
(only at provisioning), and out with a renter at the report time is that renter's. A unit never heard
is read at `reportedAt` alone. A `RENTER` case
therefore always names an interval still open at the report time, which `rentals` closes with `lostAt`
when the case settles. `RENTER` custody marks the organization's channel key exposed through
`ChannelKeyService.markKeyExposed` of `organizations`, and confirmation charges the remaining value through the `LOSS_CASE_LISTENERS` port, which `billing` provides with `chargeLoss`;
`TREKLINK` custody is written off. The `devices.lossSearch` job confirms `SEARCHING` cases whose
`searchEndsAt` has passed, with the usual compare-and-set on state and version. A device recovered after
settlement goes to `RETURNED` while its case stays `SETTLED`; any refund is a billing adjustment (E05-10). A device
recovered before settlement goes to `RETURNED` with no `lostAt`, so a `RENTER` case leaves its custody
interval open and the contract counts the unit out until the counter checks it in; that check-in closes
the row, and the device, already `RETURNED`, does not move again (2026-11-01). A unit recovered while its monthly contract is `ACTIVE` stays `RETURNED`, counted out on that contract, until the term ends, because check-in accepts a monthly contract only from `ENDING` on (`RETURNING` in `rentals/return.service.ts`, REQ-STA-01). Until then the unit
cannot reach `AVAILABLE`: its reset, its inspection and a passing intake answer 409
`INVALID_STATE_TRANSITION` while `CUSTODY_RESOLVER.custodyAt` finds the open row (leader ruling 2026-11-01).

## 2.2 Maintenance record and the weekly service scan (D-047)

```mermaid
stateDiagram-v2
    [*] --> OPEN : opened by Staff, the weekly scan or an inspection
    OPEN --> PENDING_APPROVAL : estimate above the threshold, or actual cost above the approved amount
    PENDING_APPROVAL --> OPEN : Admin approves an amount, or rejects with a reason
    OPEN --> COMPLETED : work, cost and checklist recorded
    OPEN --> UNREPAIRABLE : beyond repair
    COMPLETED --> [*]
    UNREPAIRABLE --> [*]
```

***Figure 2b***: Maintenance record lifecycle; SRS Figure 25.

| Rule | Design |
|---|---|
| Service plan | `HardwareVariant.serviceIntervalDays` and `serviceChecklist`; no interval means no periodic service |
| Due date | `Device.serviceDueAt`: the first passed intake check plus the interval; each completed `SCHEDULED` record sets it to its completion date plus the interval (FR-DEV-17) |
| Weekly scan | `ServiceScanJob`, registered as `devices.serviceScan` (`platform` design §4.6), Monday at `devices.serviceScanHourLocal`. Window: `serviceDueAt < runDate + 7 days + devices.maintenanceLeadDays`, or `firmwareVersion <> variant.firmwareBaseline`. `AVAILABLE` devices without an open record get one, `openedById` null (SYSTEM), `expectedAt` the due date, in one transaction each with the transition; the list goes to Staff by email after commit (FR-DEV-18) |
| On a contract | `RESERVED` and `RENTED` devices are listed, never moved (BR-45); `recordInspection()` checks the same window and the baseline and opens the record when the inspection passes (FR-DEV-19) |
| Cost approval | `estimate()` and `complete()` compare against `devices.maintenanceApprovalThresholdVnd` or `approvedCostVnd`; `decide()` refuses the estimator (`maintenance_records_decider_not_estimator`) |
| Firmware | `complete()` writes `Device.firmwareVersion` from the record; a `FIRMWARE_UPDATE` record requires it (`maintenance_records_firmware_on_completion`) |
| One open record | `maintenance_records_one_open_per_device`; the scan skips a device that has one |

Paying the vendor happens outside the platform. A renter's share of a repair is the damage charge of the
inspection (BR-24), never the maintenance cost.

---

## 3. Services other modules call

| Method | Caller |
|---|---|
| `reserve(variantId, quantity, contractId, tx)` returns device ids or throws `INSUFFICIENT_DEVICES` | rentals |
| `reserveExplicit(deviceIds, contractId, tx)` | rentals |
| `release(deviceIds, tx)`, `failHandoverCheck(deviceId, reason, tx)` | rentals |
| `recordProvisioning(deviceId, orgId, keyVersion, actor, tx)` | rentals |
| `clearProvisioning(deviceId, tx)`: undoes the record before the handover (rentals api-design 19); the `DeviceProvisioning` row stays | rentals |
| `assertReadyForHandover(deviceIds, keyVersion)` | rentals |
| `markRented(ids, tx)`, `markReturned(id, tx)` | rentals |
| `openLossForReplacement(deviceId)` returns whether the device has an open loss case | rentals |
| `recordInspection(deviceId, dto, contractDeviceId, actor, tx)` returns the inspection | rentals |
| `valueAt(deviceId, date)` | billing |
| `projectReading(nodeNum, reading, tx)` returns the device id or null | gateway-sync |
| `byNodeNum(nodeNum)`, `projections(ids)`, `trail(id)` | gateway-sync, monitoring |
| `availability(variantId?)` | rentals, monitoring |
| `dockedNow(deviceIds?)` returns the open dock sessions (§12.8) | monitoring |

**Ports declared here (corrected 2026-10-18).** `rentals` and `billing` both import `devices` (`platform`
design Figure 3), so the loss-case flow of D-045 reaches them through ports, never by import:

```typescript
export const CUSTODY_RESOLVER = Symbol('CUSTODY_RESOLVER'); // provided by rentals
export interface CustodyResolver {
  // Reads in the caller's transaction, so a check-in committed before the read is seen (2026-11-01).
  custodyAt(deviceId: string, at: Date, tx: Prisma.TransactionClient):
    Promise<{ contractId: string; organizationId: string; contractDeviceId: string } | null>;
}

export const LOSS_CASE_LISTENERS = Symbol('LOSS_CASE_LISTENERS'); // multi: billing, rentals
export interface LossCaseListener {
  onConfirmed(lossCase: LossCaseView, tx: Prisma.TransactionClient): Promise<void>;
  onSettled(lossCase: LossCaseView, decision: LossDecision, tx: Prisma.TransactionClient): Promise<void>;
}
```

`billing` charges the remaining value in `onConfirmed` for `RENTER` custody (`chargeLoss`) and writes the
`ADJUSTMENT` line of a reduction or waiver in `onSettled` (`adjustLoss`, dated at the view's `settledAt`); `rentals` sets the contract row's
`lostAt` to the confirmation time in `onSettled` (rentals REQ-EVT-12). Both run inside the loss-case
transaction. `LossCaseView` carries the deciding Admin's `decidedById` and `decidedByRoles`, so the
`RETURNED` transition rentals writes when the last unit out settles audits the actor with its roles
(review of #228, 2026-11-01).

**Organization actions of a triage (added 2026-10-31, task 2.7).** For `RENTER` custody triage calls
`ChannelKeyService.markKeyExposed(orgId, at, actor, tx)` directly, in the triage transaction
(REQ-EVT-14); organizations tells the Managers after commit. A suspected theft in renter custody reaches
`ComplianceCasesService.openOrLink` (organizations 2.10) through the port `LOSS_ORGANIZATION_ACTIONS`
(`ports/loss-organization-actions.port.ts`), which `DevicesModule` binds to it; the loss case stores the
returned case id. In the other direction `DevicesComplianceLossCases` provides the organizations port
`COMPLIANCE_LOSS_CASES`: the loss case codes of a compliance case and the link of the loss cases Staff
name when they open one.

```typescript
export const LOSS_ORGANIZATION_ACTIONS = Symbol('LOSS_ORGANIZATION_ACTIONS');
export interface LossOrganizationActions {
  openOrLinkComplianceCase(input: { organizationId: string; lossCaseId: string; lossCaseCode: string;
    evidence: string; policeReference: string | null; actorId: string; actorRoles: string[] },
    tx: Prisma.TransactionClient): Promise<string | null>; // the compliance case id, or null
}
```

A loss case stores the custody interval's `contractId` and `organizationId` beside `contractDeviceId`
(migration `20261101180000_loss_case_custody_contract`), because `devices` cannot read the rentals
tables and `LossCaseView.custodyContract` needs all three. They are set at report from
`custodyAt(deviceId, now)` and replaced at triage by the triage custody of §2.1, or
cleared for `TREKLINK` custody; the Org Manager's list reads `organizationId`.

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
| `SEPARATION_OF_DUTY` | 403 |
| `LOSS_CASE_OPEN` | 409 |
| `WIPE_INCOMPLETE` | 400 |
| `CHECKLIST_INCOMPLETE` | 400 |
| `CHECKLIST_REQUIRED` | 400 |
| `FIRMWARE_VERSION_REQUIRED` | 400 |
| `VENDOR_REQUIRED` | 400 |
| `FIRMWARE_SOURCE_UNAVAILABLE` | 502 |
| `FIRMWARE_IMAGE_INVALID` | 502 |
| `FIRMWARE_IMAGE_TOO_LARGE` | 502 |
| `VARIANT_MEDIA_INVALID` | 400 |
| `NODE_MISMATCH` (api-design 31, §12.8; the same code as rentals) | 409 |

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

State-matrix test over all 81 pairs; reservation race with two transactions on Postgres; reset-before-
inspection guard; remaining-value lookup by age; projection ignores older readings. Service scan with a fake
clock: the window boundary of AC-09, a rented unit listed but not moved, no second record; inspection routing
of AC-10; the approval path of AC-11 including the estimator's 403; firmware update of AC-12; the four
maintenance constraints on Postgres.

---

## 7. Detailed design for Report 4 (D-044)

Layering as in `organizations` design §9. Figures 4, 7 and 12 are the class views, core, loss cases and
maintenance; Figures 5, 6, 8 to 11 and 13 to 16 are the MF-05 reset, inspection, loss case, disposal, service
scan, maintenance and cost approval interactions.

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
        +clearProvisioning(deviceId, tx)
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
    opt reset failed on the counter tool
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
    alt passed, not due for service or firmware
        S->>R: transition(id, RETURNED, AVAILABLE, version, tx)
    else passed, due for service or firmware differs
        S->>R: insertMaintenance(SCHEDULED or FIRMWARE_UPDATE, tx)
        S->>R: transition(id, RETURNED, MAINTENANCE, version, tx)
    else damaged or failed
        S->>R: transition(id, RETURNED, MAINTENANCE, version, tx)
        RS->>Ch: chargeDamage(contract, inspection, tx)
    end
    RS-->>C: InspectionDto
    C-->>P: 200 envelope
```

***Figure 6***: UC-44 Reset and Inspect Device, part 2 of 2: inspection. A device reaches `AVAILABLE`
only after a logged reset and a passed inspection (BR-28), and a unit due for service goes to maintenance
instead (FR-DEV-19, BR-45).

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
    class CustodyResolver
    class LossCaseListener
    class ChannelKeyService
    class ComplianceCaseService
    LossCasesController --> LossCaseService
    LossSearchJob --> LossCaseService
    LossCaseService --> LossCasesRepository
    LossCaseService --> DevicesService : LOST, RETURNED, RETIRED
    LossCaseService ..> CustodyResolver : custodyAt (port, rentals provides)
    LossCaseService --> ChannelKeyService : markKeyExposed
    LossCaseService --> ComplianceCaseService : openOrLink
    LossCaseService ..> LossCaseListener : onConfirmed, onSettled (port, billing and rentals provide)
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
    alt refused: a loss case is already open
        S-->>C: 409 LOSS_CASE_OPEN
    else accepted: no open loss case
        S->>D: transition(deviceId, current, LOST, tx)
        S->>R: insert(case REPORTED, last seen time and position, tx)
        S->>S: COMMIT, notify TrekLink Staff
        S-->>C: LossCaseDto REPORTED
        C-->>P: 201 envelope
    end
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
    participant Rt as CustodyResolver
    participant O as ChannelKeyService
    participant R as LossCasesRepository
    St->>P: triage, suspected theft no
    P->>C: POST /api/loss-cases/{id}/triage
    C->>S: triage(id, dto, actor)
    S->>Rt: custodyAt(deviceId, lastSeenAt)
    alt a custody interval contains the time
        S->>O: markKeyExposed(orgId, at, actor, tx)
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
    participant B as LossCaseListener
    participant R as LossCasesRepository
    actor Ad as TrekLink Admin
    participant C as LossCasesController
    J->>R: SEARCHING cases with searchEndsAt passed
    J->>S: confirm(id, SYSTEM)
    S->>R: compareAndSet(id, SEARCHING, CONFIRMED, tx)
    opt RENTER custody
        S->>B: onConfirmed(case, tx), billing chargeLoss
    end
    Ad->>C: POST /api/loss-cases/{id}/decision, REDUCED
    C->>S: decide(id, dto, actor)
    alt refused: the actor triaged the case
        S-->>C: 403 SEPARATION_OF_DUTY
    else accepted: another Admin
        S->>B: onSettled(case, REDUCED, tx), billing adjustLoss, rentals lostAt
        S->>R: compareAndSet(id, CONFIRMED, SETTLED, decision, tx)
        S->>S: device LOST to RETIRED
        S-->>C: LossCaseDto SETTLED
    end
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
    alt refused: a wipe step not done
        L-->>C: 400 WIPE_INCOMPLETE
    else accepted: every wipe step done
        L->>R: insertDisposal(row, tx)
        L->>R: transition(id, RETIRED, DISPOSED, version, tx)
        L-->>C: DeviceDto DISPOSED
        C-->>P: 201 envelope
    end
```

***Figure 11***: UC-62 Dispose Device (BR-42).

<!-- sdd: MF-05 class devices-maintenance -->
```mermaid
classDiagram
    class MaintenanceController {
        +open(deviceId, dto, actor) MaintenanceDto
        +estimate(recordId, dto, actor) MaintenanceDto
        +decide(recordId, dto, actor) MaintenanceDto
        +complete(recordId, dto, actor) MaintenanceDto
        +list(query) Page
    }
    class MaintenanceService {
        +open(deviceId, dto, actor) MaintenanceRecord
        +openScheduled(device, reason, dueAt, tx) MaintenanceRecord
        +estimate(recordId, dto, actor) MaintenanceRecord
        +decide(recordId, dto, actor) MaintenanceRecord
        +complete(recordId, dto, actor) MaintenanceRecord
        +isDue(device, at) bool
    }
    class ServiceScanJob {
        +run()
    }
    class MaintenanceRepository {
        +insert(row, tx) MaintenanceRecord
        +compareAndSet(id, from, to, patch, tx) bool
        +dueDevices(windowEnd) Device[]
        +list(query) Page
    }
    class DevicesRepository
    class ParametersService
    class MailerService
    MaintenanceController --> MaintenanceService
    ServiceScanJob --> MaintenanceService
    MaintenanceService --> MaintenanceRepository
    MaintenanceService --> DevicesRepository : transition, serviceDueAt, firmwareVersion
    MaintenanceService --> ParametersService : lead days, threshold
    ServiceScanJob --> MailerService : week's list to Staff
```

***Figure 12***: devices classes for maintenance (D-047). `DevicesService.recordInspection()` calls
`MaintenanceService.isDue()` and `openScheduled()` for FR-DEV-19.

<!-- sdd: MF-05 seq UC-65 -->
```mermaid
sequenceDiagram
    autonumber
    participant J as ServiceScanJob
    participant S as MaintenanceService
    participant Pm as ParametersService
    participant R as MaintenanceRepository
    participant D as DevicesRepository
    participant Ml as MailerService
    J->>Pm: devices.maintenanceLeadDays
    Pm-->>J: 5
    J->>R: dueDevices(runDate + 7 + 5 days)
    R-->>J: due devices, by status
    loop each due device
        alt AVAILABLE without an open record
            J->>S: openScheduled(device, SCHEDULED or FIRMWARE_UPDATE, dueAt, tx)
            S->>R: insert(record OPEN, opener SYSTEM, tx)
            S->>D: transition(id, AVAILABLE, MAINTENANCE, version, tx)
            S-->>J: record
        else RESERVED or RENTED, or a record already open
            J->>J: add to the list only
        end
    end
    J->>Ml: send the week's list to TrekLink Staff
```

***Figure 13***: UC-65 Scan for Due Service. A unit on a contract is listed, never moved (BR-45).

<!-- sdd: MF-05 seq UC-52 part 1 of 2: open and estimate -->
```mermaid
sequenceDiagram
    autonumber
    actor St as TrekLink Staff
    participant P as MaintenancePage
    participant C as MaintenanceController
    participant S as MaintenanceService
    participant R as MaintenanceRepository
    participant D as DevicesRepository
    St->>P: reason, expected date, vendor, estimate
    P->>C: POST /api/devices/{id}/maintenance
    C->>S: open(deviceId, dto, actor)
    S->>D: lock and require AVAILABLE
    alt refused: not AVAILABLE, or a record already open
        S-->>C: 409 INVALID_STATE_TRANSITION or MAINTENANCE_OPEN
        C-->>P: failure envelope
    else accepted
        S->>R: insert(record, estimator, tx)
        S->>D: transition(id, AVAILABLE, MAINTENANCE, version, tx)
        alt estimate above devices.maintenanceApprovalThresholdVnd
            S->>R: status PENDING_APPROVAL, tx
            S->>S: COMMIT, notify TrekLink Admins
        else within the threshold, or no estimate yet
            S->>S: COMMIT, status OPEN
        end
        S-->>C: MaintenanceDto
        C-->>P: 201 envelope
    end
```

***Figure 14***: UC-52 Record Maintenance, part 1 of 2: opening with an estimate (FR-DEV-08, FR-DEV-20).
A record the scan opened gets its estimate through `PATCH .../estimate` with the same threshold check.

<!-- sdd: MF-05 seq UC-52 part 2 of 2: completion -->
```mermaid
sequenceDiagram
    autonumber
    actor St as TrekLink Staff
    participant P as MaintenancePage
    participant C as MaintenanceController
    participant S as MaintenanceService
    participant R as MaintenanceRepository
    participant D as DevicesRepository
    St->>P: work done, actual cost, checklist, firmware
    P->>C: PATCH /api/devices/{id}/maintenance/{recordId}
    C->>S: complete(recordId, dto, actor)
    S->>R: lock and require OPEN
    alt refused: checklist item or firmware version missing
        S-->>C: 400 CHECKLIST_INCOMPLETE or FIRMWARE_VERSION_REQUIRED
        C-->>P: failure envelope
    else actual cost above the approved amount
        S->>R: compareAndSet(id, OPEN, PENDING_APPROVAL, actual cost, tx)
        S-->>C: MaintenanceDto PENDING_APPROVAL
        C-->>P: 200 envelope, approval required
    else accepted
        S->>R: compareAndSet(id, OPEN, COMPLETED, patch, tx)
        S->>D: set firmwareVersion, and serviceDueAt for SCHEDULED, tx
        S-->>C: MaintenanceDto COMPLETED
        C-->>P: 200 envelope, intake check next
    end
```

***Figure 15***: UC-52 Record Maintenance, part 2 of 2: completion (FR-DEV-17, FR-DEV-21). The device stays
`MAINTENANCE` until it passes the intake check (UC-12).

<!-- sdd: MF-05 seq UC-64 -->
```mermaid
sequenceDiagram
    autonumber
    actor Ad as TrekLink Admin
    participant P as MaintenanceApprovalPage
    participant C as MaintenanceController
    participant S as MaintenanceService
    participant R as MaintenanceRepository
    Ad->>P: approve 1 800 000 VND
    P->>C: POST /api/devices/{id}/maintenance/{recordId}/decision
    C->>S: decide(recordId, dto, actor)
    S->>R: lock and require PENDING_APPROVAL
    alt refused: the Admin recorded the estimate
        S-->>C: 403 SEPARATION_OF_DUTY
        C-->>P: failure envelope
    else accepted: another Admin
        S->>R: compareAndSet(id, PENDING_APPROVAL, OPEN, decision, tx)
        S->>S: COMMIT, notify the estimator
        S-->>C: MaintenanceDto OPEN
        C-->>P: 200 envelope
    end
```

***Figure 16***: UC-64 Approve Maintenance Cost (BR-44). A rejection takes the same path with a reason.

---

## 8. Docking at the counter over Web Serial (D-080, D-082)

> **Status**: Decided (leader rulings D-082, 2026-10-30, and the D-080 amendment, 2026-11-02, both on
> treklink-web#126). §8.6 records the ruling on each point D-080 left open; the options table is kept for
> its rationale. §8.8 adds the Stage A uplink configuration the D-093 amendment requires this week.
> Amendment (2026-11-04, approved with §12): the device connector of §12 becomes the only holder of the
> port, and the pages of §8.1 open it instead of docking on their own; the protocol of §8.2 to §8.8 is unchanged.

### 8.1 Scope and placement

Docking is the Staff device station, not only a key writer (D-082 decision 1). Staff plug a unit in to
register it at intake, read and record its state, adjust its configuration (owner names, channel), and
provision it at handover; each is a step of the existing device and handover flows, done through the
docked unit instead of typed values. The backend never talks to a unit; it only checks the docked
`nodeNum` when provisioning is recorded, and issues the channel key once that check passes (§8.5, §8.6
decision 1). Two frontend slices (FSD):

| Slice | Contents |
|---|---|
| `shared/lib/meshtastic-dock.ts` | One adapter around `@meshtastic/transport-web-serial` and `@meshtastic/core` (D-082 decision 3, pinned exact versions): opens the Web Serial port, runs the config-only handshake (`want_config_id` 69420), and exposes `readUnit()` and `writeOwnerAndChannel()` to the feature slice below it. A later fork of the libraries replaces this one file. |
| `features/dock-device/` | `DockingService` with `readUnit()`, `provision(expected, key, keyVersion)` and `configureUplink(settings)`, and the `useDocking` hook that pages call: it fetches the key from rentals api-design 21 and hands it to `provision`; the key lives in one local variable of the hook and of `provision` and is dropped when they return |

Pages: the Register panel of screen 4.2 (intake) and step 1 of `CounterPage` (screen 5.4, handover; the
replacement tab of screen 5.5 reuses it). Web Serial needs a secure context and a Chromium browser; every
other browser sees the banner of screens 4.2 and 5.4 and keeps manual entry ("Enter manually").

### 8.2 Protocol facts the client relies on (firmware 2.7.19, `treklink-firmware` at `f062a35`)

Firmware `dev` has since taken upstream `v2.7.26` (D-087); the facts of §8.8 are cited at `a4aa98d`, and the
lines below are checked again on the current `dev` when task 7.2 is built.

The adapter of §8.1 relies on the Meshtastic libraries for framing and the protobuf codec; these facts
about the firmware's admin authorization are still recorded here because they are what the adapter and
the vetting record's §3.2 depend on, and the library's own passkey machinery goes unused on this path.

| Fact | Source |
|---|---|
| A client packet is stamped `from = 0` | `src/mesh/MeshService.cpp:186` |
| Local admin is accepted unless `security.is_managed`; the session passkey is checked only for `from != 0` | `src/modules/AdminModule.cpp:85-89`, `:132-138` |
| The serial API needs `security.serial_enabled`, default true | `src/SerialConsole.cpp:129`, `src/mesh/NodeDB.cpp:669` |
| `want_config_id = 69420` sends `myInfo`, the own `NodeInfo`, `metadata`, channels, config and `config_complete_id`, without the node database | `src/mesh/PhoneAPI.h:23`, `src/mesh/PhoneAPI.cpp:248-300` |
| Set owner saves and, outside an edit transaction, reboots the unit 7 s later when a name changed (`saveChanges` defaults to a reboot); set channel saves without a reboot; so the dock writes both inside `begin_edit_settings` and `commit_edit_settings` and reads back after the one reboot (firmware `dev` `a4aa98d`) | `AdminModule.cpp:595-630`, `:1022-1030`, `:330-341`, `AdminModule.h:44`, `src/configuration.h:372` |
| Get channel returns the PSK to the local client | `AdminModule.cpp:1323-1336` (at `f062a35`) |
| Long name holds 39 characters, short name 4 | `mesh.pb.h:704`, `:707` |
| PSK is 0, 1, 16 or 32 bytes; TrekLink writes 32 | `channel.pb.h:42` |

Field numbers used (`src/mesh/generated/meshtastic/*.pb.h`): `ToRadio` packet 1, want_config_id 3,
heartbeat 7; `FromRadio` id 1, packet 2, my_info 3, node_info 4, config_complete_id 7, channel 10,
metadata 13; `MeshPacket` from 1, to 2, channel 3, decoded 4, id 6, want_ack 10; `Data` portnum 1 (`ADMIN_APP`
= 6), payload 2, want_response 3, request_id 6; `AdminMessage` get_channel_request 1, get_channel_response 2,
get_owner_request 3, get_owner_response 4, set_owner 32, set_channel 33; `User` id 1, long_name 2,
short_name 3; `Channel` index 1, settings 2, role 3; `ChannelSettings` psk 2 (others kept as read);
`MyNodeInfo` my_node_num 1, pio_env 13; `NodeInfo` num 1, user 2; `DeviceMetadata` firmware_version 1.

### 8.3 Intake (screen 4.2, Register panel)

1. Staff press **Read from unit**; the browser's own port chooser opens (a user gesture is required).
2. `readUnit()` runs the config-only handshake and returns `nodeNum`, `pioEnv`, `firmwareVersion` and
   the current owner names.
3. The panel fills Node number, preselects the variant whose code the build environment maps to
   (`treklink-v2` to `treklink-v2`, `treklink-v3-tbeam` to `treklink-v3`, `treklink-v4-supreme` to
   `treklink-v4`, a table in `shared/config`), and shows the reported firmware version next to the
   firmware field. The unit reports `major.minor.build.<sha7>` (`bin/readprops.py`), while variant
   baselines read `2.7.19-treklink.N`, so the field keeps the baseline and the page warns when the build
   part differs; it does not overwrite it.
4. Registration is devices api-design 05, unchanged. Manual entry ("Enter manually") stays possible;
   uniqueness is still the server's (REQ-ERR-01).

### 8.4 Handover (screen 5.4, step 1, per reserved device)

1. Staff press **Dock and provision** on the row; the first docking of the visit opens the port chooser,
   later ones reuse the granted port (`navigator.serial.getPorts()`).
2. `readUnit()`; the docked `nodeNum` is compared with the row's `nodeNum` (rentals api-design 03 gains
   `devices[].nodeNum`, §8.5). A mismatch writes nothing and the page names the docked node id
   (REQ-ERR-12).
3. On a match `useDocking` calls rentals api-design 21, the Staff-only channel-key endpoint (§8.6
   decision 1), sending the docked `nodeNum`. The endpoint requires the device reserved to this `APPROVED`
   contract, re-checks the `nodeNum` match, and has `ChannelKeyService.deriveKey(organizationId)`
   (organizations) read the current key version and derive the key; it returns the key and its version
   with `Cache-Control: no-store` and audits the call. Each call derives the key again and is audited.
4. `provision()` sends `begin_edit_settings`, `set_owner` (long name the asset tag, short name the last
   four characters per §8.6 decision 2), `set_channel` for index 0 with role `PRIMARY` and the settings
   read in step 2 with field 2 replaced, and `commit_edit_settings`. The commit saves both and reboots the
   unit once (§8.2: outside a transaction `set_owner` alone would reboot the unit between the two
   writes). The page waits for the port to come back, asks Staff to reconnect when the browser dropped
   it, then repeats the config-only handshake and compares the owner names and the primary PSK.
5. On a match the page records provisioning (rentals api-design 09) with `keyVersion` and the docked
   `nodeNum`; the key variable is cleared before the request is sent. A write, read-back or disconnect
   failure at any point records nothing and asks Staff to dock the unit again (REQ-ERR-13).

```mermaid
sequenceDiagram
    autonumber
    actor St as TrekLink Staff
    participant P as Counter Page
    participant DS as :DockingService
    participant C as :HandoverController
    participant H as :HandoverService
    participant K as :ChannelKeyService
    participant D as :DevicesService
    participant R as :DevicesRepository
    participant DB as Postgres
    participant U as TrekLink unit (Web Serial)
    St->>P: press Dock and provision on TL-0042
    P->>+DS: readUnit()
    DS->>+U: ToRadio want_config_id 69420
    U-->>-DS: myInfo(myNodeNum), NodeInfo(owner), channel 0
    DS-->>-P: UnitInfo(nodeNum, owner, primaryChannel)
    alt docked nodeNum equals the device record
        P->>+C: POST /api/contracts/{id}/devices/{deviceId}/channel-key<br/>{ nodeNum }
        C->>+H: issueChannelKey(id, deviceId, dto, actor)
        H->>+D: byNodeNum(nodeNum)
        D->>+R: findByNodeNum(nodeNum)
        R->>+DB: SELECT devices WHERE node_num
        DB-->>-R: device row
        R-->>-D: DeviceIdentity
        D-->>-H: DeviceIdentity (matches deviceId)
        H->>+K: deriveKey(organizationId)
        K-->>-H: key (32 bytes), current keyVersion
        Note over H: audit row with actor, device, organization<br/>and keyVersion, never the key
        H-->>-C: { keyHex, keyVersion }
        C-->>-P: 200 envelope, Cache-Control: no-store
        P->>+DS: provision(expected, key, keyVersion)
        DS->>+U: AdminMessage begin_edit_settings
        U-->>-DS: routing ack
        DS->>+U: AdminMessage set_owner(TL-0042, 0042)
        U-->>-DS: routing ack
        DS->>+U: AdminMessage set_channel(index 0, PSK of version n)
        U-->>-DS: routing ack
        DS->>+U: AdminMessage commit_edit_settings
        U-->>-DS: saved, unit restarts once
        DS->>+U: ToRadio want_config_id 69420 (after the port returns)
        U-->>-DS: owner and channel 0 read back
        DS-->>-P: ReadBack(match), key dropped
        Note over P: a read-back that differs records nothing<br/>and asks Staff to dock again (REQ-ERR-13)
        P->>+C: POST /api/contracts/{id}/devices/{deviceId}/provisioning<br/>{ keyVersion, nodeNum }
        C->>+H: provision(id, deviceId, dto, actor)
        H->>+D: recordProvisioning({ deviceId, organizationId, keyVersion, actorId }, at, tx)
        D->>+R: recordProvisioning(provisioning, at, tx)
        R->>+DB: UPDATE devices, INSERT device_provisionings
        DB-->>-R: updated row
        R-->>-D: device with keyVersion
        D-->>-H: provisioned, key version only
        H-->>-C: ContractDeviceDto
        C-->>-P: 201 envelope
        P-->>St: row shows Provisioned v n
    else docked nodeNum differs
        P-->>St: The docked unit is !a4b1c2d4, not TL-0042. Nothing was written.
    end
```

***Figure 17***: UC-14 Provision Device by docking at handover

### 8.5 Contract changes (made in the catalog)

| Endpoint | Change |
|---|---|
| rentals api-design 03 `GET /api/contracts/:id` | `devices[].nodeNum` (read-only) |
| rentals api-design 09 provisioning | body gains `nodeNum`, sent by every docked record and omitted only by the manual fallback (§8.6 decision 3); 409 `NODE_MISMATCH` when it differs from the device record, nothing recorded |
| rentals api-design 21, new: `POST /api/contracts/:id/devices/:deviceId/channel-key` | Staff-only, permission `contract.issueChannelKey`. Body: `nodeNum`. Requires the contract `APPROVED` and the device reserved to it; 409 `NODE_MISMATCH` when the docked `nodeNum` differs. Returns `{ keyHex, keyVersion }`, `Cache-Control: no-store`; writes an audit row (actor, device, organization, version, never the key) |

No schema change for the device or contract tables. `NODE_MISMATCH` joins the error catalogue of
`rentals`. A forward migration adds the `contract.issueChannelKey` permission to `catalog.py` and the
seed.

### 8.6 Docking rulings (D-082, 2026-10-30)

**Decision 1, how the counter obtains the channel key: option A.** D-021 keeps only the key version in
the platform, REQ-UBI-03 says a key is never stored, displayed, returned or logged, and `organizations`
design §1 put the key "only in the counter's provisioning tool". The counter page is now that tool, so it
must hold the key for one write.

| Option | How | Security | Demo cost |
|---|---|---|---|
| **A. Derived on the server, issued once per docking (chosen)** | One master secret `CHANNEL_KEY_MASTER` in the deployment's secret store, never in the database or the seed; a dev-only value in `backend/.env.example`. Key = HKDF-SHA256(master, salt = organization id, info = `treklink-channel-key/v{version}`), 32 bytes, via `node:crypto` `hkdfSync`. A Staff-only endpoint returns it for a device reserved to an `APPROVED` contract, after the docked `nodeNum` matched, with a new permission and an audit row (actor, device, organization, version, never the key), `Cache-Control: no-store` | Nothing stored per organization; rotation is a version bump; escrow is one secret. A leak of the master exposes every organization's keys, past and future; a stolen Staff session can fetch keys for reserved units, each fetch audited. Amends REQ-UBI-03 ("returned once to the counter, never stored, displayed or logged") | Endpoint, permission row with a forward migration, `crypto.hkdfSync`, env var: about half a day of backend |
| B. Staff paste the key from the escrow | The key stays in TrekLink's escrow (a password manager); Staff paste it into the counter for the visit; the platform holds a non-secret fingerprint per version (SHA-256 of the key, first 8 bytes) so a wrong paste is refused before any write | Closest to D-021 as written; no key on the server. The key passes through people and the clipboard; a fingerprint is needed or a wrong key is written and "verified" against itself | Fingerprint column and its entry at rotation, or none without it: lowest |
| C. Stored encrypted at rest | A random key per organization and version, AES-256-GCM under a key-encryption key in the secret store, issued like A | Independent random keys; a database dump alone reveals nothing; database plus secret store reveals all. Contradicts D-021 directly; needs its own amendment | New table, encryption, endpoint: about a day |
| D. The organization brings its own key | The Org Manager keeps the channel (as the Meshtastic app needs it anyway, D-021) and pastes or shows its channel URL at the counter | TrekLink never holds a key, but loses the escrow D-021 requires and depends on the customer at every visit; a lost key is re-keying the whole fleet | Parsing the channel URL: low |

**Rejected: B, C and D.** A is chosen: no per-device human handling of a secret, the binding to a matched
`nodeNum` and a reserved unit limits what a Staff account can fetch, rotation needs no storage, and the
escrow D-021 asks for becomes one secret. D-021 is amended: the escrowed secret is the master, and
per-organization keys are derived, never stored.

Note (2026-11-03, review of treklink-web#126): HKDF is deterministic, so the endpoint returns the same key on
every call; "once per docking" means one call per docking by the page, not a server limit. The `nodeNum`
match proves little on its own, because rentals api-design 03 returns `devices[].nodeNum` to Staff; the
effective limit is the device reserved to an `APPROVED` contract and the `contract.issueChannelKey`
permission, and every call is audited.

Ruling (2026-11-03, leader, review of treklink-web#341, REQ-ERR-20): while `channelKeyExposedAt` is set,
endpoint 21 answers 409 `CHANNEL_KEY_EXPOSED` and 09 and 15 refuse to record the key the same way. Writing a
key that is known to be exposed into a fresh unit spreads the exposure; the rotation (organizations
api-design 27) clears the flag first.

**Decision 2, the short name: the last four characters of the asset tag.** It holds four characters
(`mesh.pb.h:707`), so `TL-0009` does not fit. The last four characters of the asset tag (`0009`) are the
short name; the long name carries the full tag (`TL-0009`).

**Decision 3, provisioning without a dock: manual entry stays until every rented variant docks.**
D-082 kept "Enter manually" at handover as a fallback until after the 2026-11-01 demo, and the D-080
amendment (2026-11-02) removes manual provisioning once docking ships. Docking ships for the fleet only when
v2 units answer over USB (decision 4), so until the v2 build flag lands the fallback stays, labelled "Enter
manually" under the dock action, and rentals api-design 09 accepts a record without `nodeNum` from it (the
audit row marks it manual). The release that brings v2 docking makes `nodeNum` required on 09 and removes
the fallback at handover. Intake keeps manual entry.

**Decision 4 (v2 units): docking waits for the v2 build flag.** The missing
`-DARDUINO_USB_CDC_ON_BOOT=1` build flag (vetting record §3.3) is a class S firmware change that waits
for a hardware run with the leader present (D-077). The dock shows "No response over USB. v2 units
cannot dock yet; enter the node number manually." when a docked unit answers nothing over USB; v3 and v4
units dock, and v2 units go through the fallback of decision 3 until the flag lands (D-093 amendment
item 3).

**Related, not a decision here.** The reset step "Owner cleared" (screen 4.2, devices api-design 10)
conflicts with the asset tag as owner name; it should read "Owner set back to the asset tag" when the
reset is next edited.

### 8.7 Testing and size

Unit tests on `meshtastic-dock.ts` against a fake `SerialPort` (timeouts, disconnect mid-write, a unit
that answers nothing within the timeout, mapped to the v2 "no response" message), and `DockingService`
(mismatch writes nothing, read-back mismatch records nothing, the key is not reachable after
`provision` returns). Backend unit tests on `HandoverService.issueChannelKey` (nodeNum match required,
HKDF derivation deterministic per organization and version, the response carries no key when the match
fails) and on the `nodeNum` check inside `provision`. Component tests for the banner, the dock buttons,
the "Enter manually" fallback and each error state. A hardware run on v3 and v4, and on v2 once the USB
build flag lands (vetting record §3.3).

Estimated size (estimate, not measured): `shared/lib/meshtastic-dock.ts` about 120 lines plus
`@meshtastic/core` and `@meshtastic/transport-web-serial` as dependencies, `features/dock-device` about
150, page changes about 150, tests about 350; backend channel-key endpoint, `nodeNum` check and rentals
03 field about 150 lines with tests, plus a forward migration for the new permission.

### 8.8 Stage A uplink configuration (D-005, D-093 amendment item 3)

Stage A (D-005) needs nodes that publish to the broker over their own Wi-Fi with the frozen transport
settings. The dock writes those settings, so a member does not need the Meshtastic app or CLI to prepare an
uplink node. It is configuration only (D-080 rule 2): no firmware change and no server call.

**Where.** Screen 4.2, `DeviceDetailPage`, action **Configure uplink**, Staff only, shown for a device that
is not `RETIRED` or `DISPOSED` while Web Serial is available.

**Form.** Wi-Fi network name (1 to 32 characters, `config.pb.h` `wifi_ssid[33]`), Wi-Fi password (0 to 64,
`wifi_psk[65]`), broker address as host or host:port (1 to 63, `module_config.pb.h` `address[64]`), broker
user name (0 to 63, `username[64]`) and password (0 to 31, `password[32]`), and a TLS switch, off by default
(the laptop broker of the checkpoint runs on the local network; a node built without TLS support refuses it,
`MQTT.cpp` `isValidConfig`). Shown read-only, because D-005 froze them: root `treklink`, JSON on, MQTT
encryption off, uplink on the primary channel. Nothing typed is kept after the docking (REQ-UBI-05).

**Steps.**
1. `readUnit()`; the docked `nodeNum` must equal the device's (REQ-ERR-12). The handshake also returns the
   unit's current network config, MQTT module config and primary channel, which step 2 keeps as read except
   for the fields named here.
2. `begin_edit_settings`; `set_config` network with Wi-Fi on and the typed name and password;
   `set_module_config` MQTT with enabled, the typed address, user name, password and TLS switch, JSON on,
   encryption off, root `treklink`; `set_channel` index 0 with `uplink_enabled` on; `commit_edit_settings`.
3. The commit saves every segment and reboots the unit once. The page waits for the port to come back, asks
   Staff to reconnect when the browser dropped it, repeats the handshake and compares the MQTT fields, the
   Wi-Fi name and the channel's uplink flag. A difference or a unit that does not come back shows which
   check failed (REQ-ERR-15).

**Constraint.** An uplink node relays only the channel it holds: with MQTT encryption off it decrypts with
its own primary key before publishing. A node that uplinks an organization's units therefore carries that
organization's channel, so Staff configure the uplink on a unit already provisioned for that organization
(§8.4). Otherwise the backend receives nothing from those units.

| Fact (firmware `dev` `a4aa98d`) | Source |
|---|---|
| `AdminMessage` set_config 34, set_module_config 35, begin_edit_settings 64, commit_edit_settings 65, reboot_seconds 97 | `src/mesh/generated/meshtastic/admin.pb.h:585-608` |
| `Config` network 4; `NetworkConfig` wifi_enabled 1, wifi_ssid 3, wifi_psk 4 | `config.pb.h:843-845`, `:900` |
| `ModuleConfig` mqtt 1; `MQTTConfig` enabled 1, address 2, username 3, password 4, encryption_enabled 5, json_enabled 6, tls_enabled 7, root 8 | `module_config.pb.h:626-633`, `:746` |
| `ChannelSettings` uplink_enabled 5 | `channel.pb.h:145` |
| Inside an open edit transaction a set is held; the commit saves config, module config, channels and device state, then reboots once (`saveChanges` defaults to a reboot) | `src/modules/AdminModule.cpp:330-341`, `:1364-1375`, `AdminModule.h:44` |
| A set MQTT config is checked by `MQTT::isValidConfig`; a broker connection is tried only when the node is already on a network, so a node docked without Wi-Fi accepts it | `AdminModule.cpp:924-938`, `src/mqtt/MQTT.cpp:661-726` |

---

## 9. Firmware flash from the maintenance page (D-093 amendment item 3)

> **Status**: Spec, 2026-11-03 (treklink-web#326; D-093 amendment of 2026-11-02, item 3). Library: `esptool-js` 0.7.1, adopted in
> `vetting/esptool-js.md`. Needs the firmware release workflow of §9.1 before it can flash a real image.

A unit gets new firmware inside the existing `FIRMWARE_UPDATE` maintenance record (§2.2): the weekly scan
opens the record when `firmwareVersion` differs from the variant's `firmwareBaseline`, Staff flash the unit
from the record, and completing the record writes `Device.firmwareVersion` as today (REQ-EVT-22, AC-12). A
flash outside a record is not offered, so a unit on a contract is never flashed (BR-45).

### 9.1 Where the images come from

- `treklink-firmware` publishes a GitHub release per TrekLink version (`v2.7.26-treklink.N`), built by a
  release workflow for `treklink-v2`, `treklink-v3-tbeam` and `treklink-v4-supreme`. Each release carries,
  per variant, the app image (`firmware.bin`, written at `0x10000`), the merged factory image
  (`firmware.factory.bin`, written at `0x0`, `bin/platformio-custom.py:75`) and one manifest asset
  `treklink-manifest.json`: `version`, and per variant `variantCode`, `pioEnv`, `chip`, and for `app` and
  `factory` the file name, offset, size and SHA-256. The workflow is a leader item (workflow token scope);
  until a release exists the panel shows "No firmware release is published yet."
- The browser cannot download a GitHub release asset (no `Access-Control-Allow-Origin`, vetting record
  §3.3), so the backend reads the releases and serves the images: devices api-design 28 lists the releases
  for a variant, 29 returns one image after comparing its SHA-256 with the manifest.
- Parameters (`platform` configuration matrix): `devices.firmwareReleaseRepo` (`TrekLink-Team/treklink-firmware`)
  and `devices.firmwareReleaseCacheSeconds` (`300`). The repository is public, so the backend calls the GitHub
  API without a token (built 2026-11-06, task 8.2): 60 unauthenticated requests an hour per address, one list
  read and one manifest read per release per cache window. No `GITHUB_TOKEN` is read.
- Manifest shape (`treklink-manifest.json`), as firmware task 8.1 publishes it (treklink-firmware#30; spec edit of
  2026-11-06 on the orchestrator's ruling, replacing the shape first written that day):

  ```json
  { "version": "<tag>",
    "variants": [
      { "variantCode": "v2", "pioEnv": "treklink-v2", "chip": "esp32s3",
        "app":     { "fileName": "firmware-treklink-v2.bin",         "offset": 65536, "size": n, "sha256": "<hex>" },
        "factory": { "fileName": "firmware-treklink-v2.factory.bin", "offset": 0,     "size": n, "sha256": "<hex>" } },
      { "variantCode": "v3", "pioEnv": "treklink-v3-tbeam", "chip": "esp32", "app": { ... }, "factory": { ... } },
      { "variantCode": "v4", "pioEnv": "treklink-v4-supreme", "chip": "esp32s3", "app": { ... }, "factory": { ... } } ] }
  ```

  The release assets are the two file names per variant above plus the manifest; offsets and sizes are integers.
  The reader maps the short `variantCode` to the platform's variant code `treklink-<code>` (`v3` to `treklink-v3`)
  and drops the tag's leading `v`, so a release version reads as `firmwareBaseline` and the record's firmware
  version do (`2.7.26-treklink.2`); api-design 29 takes the version with or without it. `chip` stays in the
  manifest's lower-case form on api-design 28 and 29, and the flash panel compares it with the chip `esptool-js`
  reports (`ESP32-S3`) in one form, letters and digits only, lower case. An entry missing a field is skipped, a
  release without a valid manifest is not listed, and the list is newest first by GitHub's `published_at`. An
  unknown version or variant on api-design 29 is 404.
- Module: `FirmwareReleaseService` and `FirmwareReleasesController` in `devices`, which owns the variants and
  `firmwareBaseline`. The release list needs `device.read`, the image `device.operate` (TrekLink Staff; Admin
  inherits both).
- Size: api-design 29 returns the image as base64 in the D-002 envelope, as rentals api-design 08 returns its
  PDF. A Vercel Function answers at most 4.5 MB ("The maximum payload size for the request body or the response
  body of a Vercel Function is 4.5 MB", vercel.com/docs/functions/limitations, read 2026-11-03), so the raw image
  must stay under 3 300 000 bytes (4 400 000 bytes as base64); the service refuses a larger manifest entry with 502 `FIRMWARE_IMAGE_TOO_LARGE`. A
  4 MB-flash variant's app partition holds 2.42 MB, so only an 8 MB variant's factory image can come near it.

### 9.2 Flash panel (screen 4.3, on an `OPEN` `FIRMWARE_UPDATE` record)

1. The panel lists the releases that carry the device's variant (api-design 28), the variant's baseline
   preselected, and two modes: **Update** (app image, default: keeps the unit's channel, owner names and
   settings) and **Full install** (erase, then the factory image; the unit loses its settings and must be
   provisioned again before its next handover).
2. Staff press **Flash** and choose the port in the browser's prompt. For a v2 unit the page first says
   "Hold the power button of {assetTag} until the flash finishes; a reset turns a v2 unit off otherwise."
   (bench record 2026-10-29).
3. The page connects through `esptool-js` (`ESPLoader.main("default_reset")`). The library picks the reset
   from the port: the USB Serial/JTAG reset on the ESP32-S3 native USB (v2, v4), the classic DTR and RTS reset
   through a USB to UART bridge (v3) (`lib/esploader.js:534-540`). For v2 it sets `baudrate` and `romBaudrate`
   both to 115200, which skips the port reopen (`lib/types/loaderOptions.d.ts:29-36`). Other units run at
   460800 baud with the ROM rate left to the library (spec silent; chosen 2026-11-06 in task 8.3, esptool's
   upload default; to be confirmed on the bench).
4. Two checks before any write (REQ-ERR-16): the chip must match the manifest's `chip` for the variant, and
   the unit must be this device. The firmware derives the node number from the MAC address, bytes 2 to 5
   (`treklink-firmware` `src/mesh/NodeDB.cpp:1160`), so the page reads the MAC (`readMac`) and compares the
   derived number with the device's `nodeNum`. A unit whose node number was re-picked after a collision
   (`NodeDB.cpp:1162-1171`) fails this check and is flashed on the bench instead. v2 and v4 are both ESP32-S3,
   so the chip alone cannot tell them apart; the node number does.
5. It fetches the image (api-design 29, which also returns the image's MD5, taken over the image padded to 4
   bytes with `0xFF` as `esptool-js` pads it before hashing, `lib/esploader.js:1596`), writes it compressed at the
   manifest offset, and passes `calculateMD5Hash` returning that MD5, so `esptool-js` compares each written
   region with the chip's `flashMd5sum` (`lib/types/flashOptions.d.ts:46-49`, `lib/esploader.d.ts:396`) with no
   MD5 library in the browser. `flashMode`, `flashFreq` and `flashSize` stay `"keep"`: otherwise the library rewrites the
   header of an image written at `0x0` before hashing it (`lib/esploader.js:1466-1471`, `:1598-1600`), and a Full
   install would fail its own verification. Then it resets the unit; a v2 unit turns off at the reset unless its power
   button is still held.
6. On a verified write the panel fills the record's firmware version with the release version and opens
   Complete (devices api-design 14); Staff complete the record as today. Built (2026-11-06, task 8.3): the
   panel runs in the device hub (§12.7), so Complete the record goes to `/t/maintenance` with the record id
   and the release version in the navigation state, and the maintenance page opens Complete with the version
   filled. The record's Update firmware opens the hub on its unit (REQ-EVT-41). A failed or unverified write
   records nothing and keeps the record `OPEN` (REQ-ERR-17).
7. When docking is available (§8), the page also reads the unit back after the reset and shows the
   firmware version the unit reports beside the release version.

### 9.3 Testing

Backend unit tests: manifest parsing, variant filter, SHA-256 mismatch answers 502 `FIRMWARE_IMAGE_INVALID`
and returns no image, the cache window. Frontend tests with a fake `ESPLoader`: chip mismatch writes
nothing, a verify failure records nothing, the v2 notice, Update and Full install offsets. Hardware run on
v3 and v4 by the leader, v2 with the power button held.

---

## 10. Variant image and spec sheet (gap G1 and element E-2 of the UI flow audit, branch `docs/ux-flow-audit`)

> **Status**: Spec, 2026-11-03. The leader ruled the UI review answers on 2026-11-03: contracts and devices get
> the entity home, lifecycle header, action bar, device references and variant media before Friday 2026-11-06.

A variant is fixed hardware (leader, 2026-11-03): its image and spec sheet describe every unit of it, while the
firmware version stays per unit (`Device.firmwareVersion`) and organization settings stay on the unit's
provisioning (§8). Two fields on `HardwareVariant`, edited on screen 4.1 by an Admin:

| Field | Type | Rule |
|---|---|---|
| `imageUrl` | `String?` | Up to 500 characters: an `https://` URL with a host, or an app path `/variants/<file>` whose file name has no `/`, no `..` and a `.jpg`, `.jpeg`, `.png` or `.webp` extension (a file in `frontend/public/variants/`, shipped with the frontend: Vercel has no persistent disk for uploads). Null shows the labelled empty slot "Variant image not added yet". The value names the detail render; the icon render is derived from it ("Two renders" below). No stock photo is ever seeded |
| `specSheet` | `Json`, default `{}` | An object whose keys come from this fixed list, shown in this order, each value a string of 1 to 80 characters after trimming (a non-string or whitespace-only value is refused): `mcu`, `radio`, `gnss`, `motionSensor`, `display`, `battery`, `sosControl`, `localAlarm`, `enclosure`. An unknown key, an empty or longer value answers 400 `VARIANT_MEDIA_INVALID`. A missing key is not shown |

The capability flags (`hasGps`, `hasMotionSensor`, `mqttCapable`) stay the source of logic; the spec sheet is
display text only and never drives behaviour.

**Seed (verified facts only).** From `treklink-firmware` `docs/variants.md` at `dev` `a4aa98d`: v2 `mcu` ESP32-S3,
`radio` SX1268, `motionSensor` ICM-20948, `sosControl` "Dedicated SOS button", `localAlarm` "Buzzer and
vibrator"; v3 (LilyGo T-Beam v1.2) `mcu` ESP32, `sosControl` "3 s hold on the user button", `localAlarm` "LED
blinks"; v4 (LilyGo T-Beam Supreme) `mcu` ESP32-S3, `motionSensor` QMI8658, `sosControl` "3 s hold on the user
button", `localAlarm` "None"; v1 `mcu` ESP32, `radio` SX1278, `motionSensor` MPU6050. Radio, GNSS, display,
battery and enclosure of v3 and v4 are left empty until the leader records them.

**Two renders per variant (W17, 2026-11-04).** The leader supplied two product renders per variant under
`frontend/public/variants/` (commit `048e1e6`, 1254 by 1254 px, transparent background):
`treklink-vN-detail.png`, photorealistic, and `treklink-vN-icon.png`, flat. The **detail render** shows in
detail panes and on the device page; the **icon render** shows in lists and cards. One `imageUrl` column carries
both by convention, with no new column: `imageUrl` names the detail render, and the icon is derived by name,
replacing a final `-detail.<ext>` with `-icon.<ext>` (`/variants/treklink-v3-detail.png` gives
`/variants/treklink-v3-icon.png`). A value without the `-detail.` suffix, for example an `https://` photo,
serves both places. An icon that fails to load falls back to the detail render, and that one to the labelled
empty slot. The forward migration `20261104200000_variant_renders` sets
`imageUrl = /variants/treklink-vN-detail.png` on the rows of v1 to v4, and the demo seed writes the same values.

**treklink-v1 in the catalog (W17, leader 2026-11-04).** v1 joins the seed and the catalog: the grey box with
three side buttons and a side antenna. Recorded facts: the spec sheet above, `hasGps` true (a GPS Neo-6M on
UART1, TX 16 and RX 17, `treklink-firmware` `variants/esp32/treklink_v1_0/variant.h:10`, `:20-23`),
`hasMotionSensor` true (MPU6050) and `mqttCapable` false (`-D MESHTASTIC_EXCLUDE_MQTT=1`, the schema comment);
so a v1 unit is never a Stage A uplink (§8.8, D-005). **Unverified**, set only because the column is required:
`firmwareBaseline` `2.7.19-treklink.1`, the pattern of v2 to v4 on the firmware version 2.7.19 of
`treklink-firmware` `version.properties`. Its monthly price, 350 000 VND, is a demo
value. The migration inserts the variant only when absent, and its price schedule only when none exists and an
active Admin account can be named as its author; the seed adds two AVAILABLE demo units, TL-0020 and TL-0021
(placeholder node numbers `0xde000014` and `0xde000015`).

**Where it shows (E-2).** Screen 4.1 (the admin panel edits both fields and previews the card), the device detail
of screen 4.2, the device cards of the contract home's Devices tab, and the variant picker of the request form,
which shows the variants as cards with the image slot and the spec summary in place of a `select`. Which render
goes where: the icon in the fleet table's Variant column and the fleet list, the variant picker cards, the
variant card above the Devices tab list and the rows of screen 4.1; the detail render on the device page, in the
details pane of the fleet and of the Devices tab, and in the screen 4.1 panel preview. Each image has fixed width
and height, loads lazily, takes the alt text "{variant name} unit" and sits on a theme surface token, so the
transparent renders read in both themes and nothing shifts while they load. A card
shows, besides the spec sheet, the capability flags as text (GPS, motion sensor, MQTT) and the firmware
baseline. Devices api-design 01 returns both fields to Staff, Admin and the Org Manager. Unit payloads carry
only `hardwareVariant {id, code}` today and the Org Operator cannot read api-design 01, so task 9.1 widens the
variant summary of every unit payload (devices 05 to 07, rentals 03 `devices[]`, the monitoring console rows)
to `{id, code, name, imageUrl, specSheet, hasGps, hasMotionSensor, mqttCapable, firmwareBaseline}`, one shared
shape (E-1); the card shows `firmwareBaseline` as "Firmware baseline" (leader ruling 2026-11-03). The monitoring rows keep their
variant code string until W10: the live map and the organization API read it.

## 11. Variant administration and stock-take (W20A, 2026-11-05, KhoaDD under D-078)

**Variants (api-design 02 to 04, screen 4.1).** `VariantsService` in `variants.service.ts` owns the writes,
`VariantsRepository` the `hardware_variants` rows. The forward migration `20261105120000_variant_version` adds
`version INT NOT NULL DEFAULT 0` to `hardware_variants`, so an edit is a compare-and-set
(`UPDATE ... WHERE id = :id AND version = :expectedVersion`, then `version + 1`) and a lost race answers 409
`STALE_VERSION` (REQ-ERR-19). The PATCH body carries `expectedVersion`; deactivation is the same PATCH with
`isActive` false. Rules, checked before any write:

| Rule | Error |
|---|---|
| `code` matches `^[a-z0-9]+(-[a-z0-9]+)*$`, 3 to 40 characters, and is unique ignoring case | 400 `VALIDATION_FAILED`, 409 `CONFLICT_UNIQUE` |
| Schedule: at least one row, the first at `fromMonths` 0, months strictly increasing, `valueVnd` never increasing, whole numbers at or above 0 | 400 `SCHEDULE_INVALID` |
| A service interval needs at least one checklist item; each item 1 to 120 characters | 400 `CHECKLIST_REQUIRED` |
| Image link and spec sheet as in §10 | 400 `VARIANT_MEDIA_INVALID` |
| A sensor flag that differs from the stored one while units are registered | 409 `VARIANT_IN_USE` |
| Delete while any unit was ever registered on it | 409 `VARIANT_IN_USE` |

`code` is fixed after create (the PATCH whitelist refuses it). A delete counts the units inside its
transaction; a variant that another module's row still names (a contract, a price schedule, a damage rate)
fails the foreign key, and that failure answers 409 `VARIANT_IN_USE` too, so `devices` never reads those
tables. Deactivate such a variant instead. Every write emits `audit.record` after commit (`hardwareVariant.create`, `.update`,
`.delete`, subject `HardwareVariant`, values before and after). Every answer carries `version` and
`deviceCount`.

**Stock-take (api-design 25 and 26, screen 4.5).** One request is one count: the screen keeps the scanned
tags in session storage until Finish, so a count survives a reload without a server-side open session.
`StockTakeService.run` reads every device not `RETIRED` or `DISPOSED` and classifies it (REQ-EVT-30):

| Unit | Group |
|---|---|
| Scanned, any status | `inStockConfirmed` (a scanned `RENTED` unit is on the shelf, so it is confirmed too) |
| Not scanned, `RENTED`, `lastSeenAt` within `devices.stockTakeSeenHours` (ParameterService) | `rentedSeen` |
| Not scanned, any other case | `unconfirmed[]` with `id`, `assetTag`, `status` and `lastSeenAt` |
| A scanned tag matching no unit above | `unknownTags[]` |

The stored `result` JSON holds the counts, the unconfirmed rows and the unknown tags. The list (api-design 26)
reads `takenBy` names through platform's `ACCOUNT_DIRECTORY` port, never the `users` table, and returns
`scannedCount`, `unconfirmedCount` and `unknownCount` per run, newest first. A run emits `audit.record`
`stockTake.run` after commit with the counts.

---

## 12. Device connector: the Staff device hub (brief of 2026-11-04 and its scope addition)

> **Status**: Approved, 2026-11-04 (the hub approved by the leader; §12.12 decided the same day). Source:
> `docs/design/2026-11-04-device-connector-brief.md` (the request, the four answers and the scope addition of
> 02:05, all binding). Requirements: REQ-UBI-07 to REQ-UBI-10, REQ-EVT-31 to REQ-EVT-43, REQ-STA-05, REQ-STA-06,
> REQ-ERR-21 to REQ-ERR-31, AC-25 to AC-40. Builds on §8 (docking), §9 (flash) and §10 (variant media); it does
> not change their protocol facts. Layout follows chapter 06 §9 and §10 (D-096, text in
> `docs/design/2026-11-03-collectionview-and-layout.md`).

### 12.1 Scope

One shared hub for TrekLink Staff and Admin, "connect a unit and see what you can do with it": every unit
plugged into the Staff computer over USB is one row; a registered unit is recognized by its `nodeNum`; an
unknown unit is offered for registration; and from the same place Staff provision a unit for a contract
(with the quick swap and hot provisioning), configure its uplink, read its info and flash its firmware.
Organizations never dock units (brief answer 2), so the hub exists only in the Staff shell (REQ-UBI-07).

The hub replaces the per-page docking of §8.1: the counter rows, the Register panel's Read from unit, the
device page's Configure uplink and the maintenance page's flash panel become entry points that open the hub
on their unit and action (REQ-UBI-10, REQ-EVT-41). The protocol work of §8.2 to §8.8 and §9.2 is unchanged;
only who holds the port changes.

Out of scope: any write the leader has not asked for (no node database edit, no channel other than the
primary); the Organization console; a unit reached over Bluetooth or the network. The reboot and the factory
reset of a returned unit were asked for in brief W18 (2026-11-04) and are specified in §12.13.

### 12.2 Module, panel and device view

**Slices.**

| Slice | Content |
|---|---|
| `shared/lib/meshtastic-dock.ts` (§8.1, task 7.2) | Unchanged role: one adapter over the Meshtastic packages. `openDock(port)` takes a port the hub gives it instead of choosing one; the single-port helper `grantedPort()` of the docking branch goes away |
| `shared/lib/esp-flasher.ts` (§9.2, task 8.3) | Unchanged role; it takes a port the hub hands over (§12.7) |
| `features/device-connector/model/` | `ConnectorRegistry`: one instance per tab, outside React, holding one `Connection` per open port (§12.4); the write lock of REQ-UBI-09; the page context (§12.3); the dock session heartbeat (§12.8). A `useConnector()` hook subscribes to it with `useSyncExternalStore` |
| `features/device-connector/actions/` | The `DockingService` of §8.1 (`readUnit`, `provision`, `configureUplink`) moved here and given a `Connection` instead of a port; the quick swap (§12.6); the flash hand-over (§12.7) |
| `features/device-connector/ui/` | `ConnectorPanel` (the rows), `DeviceView` (one unit), `ConnectorButton` (the header entry with the count) |
| `entities/device/api.ts` | `useDevicesByNode(nodeNums)` over api-design 30; `openDockSession`, `endDockSession` over 31 and 32 |
| `entities/contract/api.ts` | `exchangeDevice` over rentals api-design 32 |

The `features/dock-device/` slice of the docking branch (`feat/devices-docking-frontend`, Phase 7, not merged)
folds into `features/device-connector/` when Phase 10 starts; its tests move with it.

**Panel placement.** A header button "Devices" with the number of connected units opens the panel on every
Staff page. The panel follows §10.8: from 1100 px a non-modal `aside` pushed beside the page (focus moves to
its heading, Escape or Close closes it); from 600 px the design system `Drawer` from the right over the page;
below 600 px the same `Drawer` as a bottom sheet; both drawers trap focus and return it on close. On the
full-bleed map routes it opens only as the `Drawer`. The shell's Info pane uses the same right side at 1280 px
(`specs/frontend/design-system.md` §5); one right panel shows at a time (§12.12 Q6, decided A): opening the hub
closes the Info pane, and opening the Info pane closes the hub.

**Rows.** One row per connected unit, in connection order, built as a `CollectionView` in the List view
(§9.2) with no command bar while two or fewer units are connected (§9.3):

| Field | Registered unit | Unknown unit |
|---|---|---|
| Image | `/variants/<code>-icon.png` | the generic unit icon |
| Title | asset tag | "Unknown unit" |
| Subtitle | node id, variant name | node id, build environment |
| Status | the device status as text (§8.3 of chapter 06) | "Not registered" |
| Contract | live contract code and its status, or none | none |
| Connection | the state of §12.4 as text ("Ready", "Writing settings", "No response over USB") | same |
| Actions | Show device view first (§9.5), then the actions of §12.3 for this unit on this page, as icon buttons with the §9.5 tooltip, or one Actions menu below 600 px (§10.5) | same |

A row with no action names why on its own line ("Reserved to RC-2026-0040"), never by an absent button alone
(REQ-EVT-34).

**Device view.** Show device view replaces the list inside the panel with one unit, with Back to the list as
its first control:

| Block | Content | Source |
|---|---|---|
| Render | The variant's upright product render, `/variants/<code>-detail.png`, fixed 240 px high, `alt` "{variant name}, front view"; on a load failure the labelled empty slot of §10 with the variant name (REQ-ERR-31) | variant `code` (§12.12 Q5, decided A) |
| From the unit | node id, `nodeNum`, owner long and short names, build environment, reported firmware version, and a note when the build differs from the variant baseline (§8.3) | the handshake (§8.2: `MyNodeInfo.my_node_num`, `pio_env`; `User.long_name`, `short_name`; `DeviceMetadata.firmware_version`) |
| From the server | asset tag, variant card (§10), status, firmware on record, battery and its time, last seen, service due, key version and its organization (never the key) | api-design 30 `device` |
| Contract | live contract code, organization code, status, whether this unit is provisioned at the organization's current version | api-design 30 `contract` |
| Actions | every action of §12.3 as a labelled button, with the reason of an unavailable one as text (§9.8) | §12.3 |

Battery comes from the server projection (`batteryPct`, `lastBatteryAt`, §1), which is what the Staff
already trust on the fleet table. Reading the battery from the unit itself needs a firmware fact §8.2 does
not record (§12.12 Q4, decided A: the server projection only).

### 12.3 Page context and the actions a unit allows

A page tells the hub what it is about with `useConnectorContext(context)` on mount; the context is cleared on
unmount. Entry points call `openConnector({ action, expected })`, which opens the panel, focuses the row
whose `nodeNum` equals `expected.nodeNum` if one is connected, and otherwise shows "Connect {assetTag} to
continue." with Connect a unit (REQ-EVT-41).

| Context | Set by | Carries |
|---|---|---|
| `counter` | `/t/counter/:contractId` with an `APPROVED` contract (screen 5.4) | contract id, code, status, variant code, `version`, reserved rows (`deviceId`, `assetTag`, `nodeNum`, `provisionedKeyVersion`), the organization's `channelKeyVersion` |
| `intake` | `/t/fleet` with the Register panel open (screen 4.2) | none |
| `device` | `/t/devices/:id` (screen 4.2) | the device id |
| `maintenance` | `/t/maintenance` (screen 4.3) | the record open in the drawer, if any |
| `fleet` | `/t/fleet` and `/t/stock-take` | none |
| none | every other Staff page | none |

Actions are computed by one pure function, `actionsFor(unit, context, abilities)`, from the unit's
recognition (api-design 30) and the context, then filtered by the caller's CASL abilities:

| Unit | Actions on any Staff page | Added in the `counter` context of contract C |
|---|---|---|
| Unknown | New device: register it? (opens the Register panel on `/t/fleet` prefilled, REQ-EVT-33) | none: register it first |
| `IN_INTAKE` | Record intake check (opens the device page) | none |
| `AVAILABLE` | Configure uplink | Put it on C in place of a reserved unit (§12.6) when its variant is C's and C has a reserved unit with no provisioning record; otherwise the reason (REQ-ERR-25, REQ-ERR-26) |
| `RESERVED` to C | Configure uplink | Provision for C (REQ-EVT-25), or "Provisioned v{n}" when done |
| `RESERVED` to another contract, or held for a request | Open its counter | the reason (REQ-ERR-22) |
| `RENTED` | Open its contract | the reason and the return counter link (REQ-ERR-23) |
| `RETURNED` | Open its counter (reset and inspection, REQ-EVT-23) | none |
| `MAINTENANCE` with an `OPEN` `FIRMWARE_UPDATE` record | Update firmware (§12.7), Configure uplink | none |
| `MAINTENANCE` otherwise, `LOST` | Open device page | none |
| `RETIRED`, `DISPOSED` | Open device page | none |

Show device view and Open device page are on every registered row. Configure uplink follows §8.8 and needs
the unit already provisioned for an organization; the button is shown and states that reason when it is not.

### 12.4 One connection and its states

A `Connection` is one open `SerialPort` and what REQ-UBI-08 allows beside it. The registry builds one for each
port `navigator.serial.getPorts()` returns on load, for each `connect` event, and for each port Staff choose
with Connect a unit (REQ-EVT-31). Granted ports are remembered by the browser for the origin; whether a grant
survives a browser restart on every Chromium build the counter uses is (unverified) and is checked on the
bench in task 10.10.

```mermaid
stateDiagram-v2
    [*] --> Opening: getPorts, connect event or chooser
    Opening --> Busy: port open in another tab or app
    Busy --> Opening: Retry
    Opening --> Handshake: port open
    Handshake --> NoResponse: no answer within the link timeout
    NoResponse --> Handshake: Retry
    Handshake --> LookingUp: nodeNum, build env, firmware read
    LookingUp --> NotChecked: api-design 30 fails
    NotChecked --> LookingUp: Retry
    LookingUp --> Ready: recognized or unknown
    Ready --> Writing: provision or uplink, write lock taken
    Writing --> Restarting: commit sent, unit reboots once
    Restarting --> Reconnect: port dropped and not back
    Reconnect --> Checking: Staff reconnect, same nodeNum
    Restarting --> Checking: handshake again, same nodeNum
    Checking --> Ready: read-back matches, lock released
    Writing --> Failed: refused, timeout or port lost
    Checking --> Failed: read-back differs
    Failed --> Ready: Staff dismiss
    Ready --> Flashing: Update firmware, port handed over
    Flashing --> Restarting: verified write, unit resets
    Flashing --> Failed: flash step fails
    Ready --> Unplugged: disconnect event
    Unplugged --> Opening: connect event, same port
    Unplugged --> [*]: Forget or tab closed
    Ready --> [*]: Forget
```

***Figure 18***: one connection. Every state is shown on the row as text.

Rules:

1. A row is keyed by `nodeNum` once the handshake gives it, not by the port object: after the reboot of §8.4
   step 4 a unit on a native USB port may come back as a new port, and the registry joins it to the waiting
   row when its handshake answers the same `nodeNum` (REQ-EVT-36). A different `nodeNum` is a new row.
2. The handshake's channel settings are dropped as soon as the identity is read (REQ-UBI-08); the provisioning
   write of §8.4 step 4 reads the primary channel again inside its own transaction.
3. The write lock (REQ-UBI-09) is one per tab. While it is held every other row's write actions are disabled
   with the reason "Another unit is being written." (REQ-STA-06).
4. Disconnect while `Writing`, `Restarting` or `Checking` ends in `Failed` with the step named; nothing is
   recorded (REQ-ERR-13, REQ-ERR-21).
5. An `Unplugged` row stays for 10 seconds with "Unplugged" and then leaves the list, so a replug during a
   restart keeps its place; Forget calls `SerialPort.forget()` where the browser has it (unverified on the
   counter's Chromium version) and removes the grant.
6. A unit that answers nothing is `NoResponse` with the message of REQ-ERR-24 (§8.6 decision 4). The brief
   records that a v2 unit answers over USB with the firmware of treklink-firmware#27 (bench run of
   2026-11-04); that is not yet a fact of §8, so the message names the firmware and not the variant.

### 12.5 Recognition

The hub asks the server once per new `nodeNum`, batching the units that finished their handshake within the
same 300 ms: devices api-design 30, `GET /api/devices/by-node?nodeNum=...&nodeNum=...` (`device.read`, at
most 20 numbers). Each answer row carries the `nodeNum`, its node id, and either `device: null` (unknown) or
the device summary of api-design 07 with the open maintenance record, plus `contract`: the live contract row
of the unit (`id`, `code`, `status`, organization `id` and `code`, `provisionedKeyVersion`) or null, and
`docked`: the open dock session (§12.8) or null.

`devices` cannot read the rentals tables (§3), so the contract comes through a new port provided by
`rentals`, the same way `CUSTODY_RESOLVER` is:

```typescript
export const DEVICE_CONTRACTS = Symbol('DEVICE_CONTRACTS'); // provided by rentals (RentalsPortsModule)
export interface DeviceContracts {
  // The live ContractDevice row of each device (releasedAt, checkedInAt and lostAt null), if any.
  liveContractsOf(deviceIds: string[], tx?: Prisma.TransactionClient): Promise<Array<{
    deviceId: string; contractId: string; code: string; status: string;
    organizationId: string; organizationCode: string; provisionedKeyVersion: number | null }>>;
}
```

The answer is cached under `['devices-by-node', nodeNum]` and invalidated by every action the hub runs on
that unit, by registration, and by the `device.handedOver` and `device.released` stream entries.

### 12.6 Quick swap at the counter

The leader's answer 1: any `AVAILABLE` unit of the contract's variant may replace a reserved one; the replaced
unit goes back to `AVAILABLE`; price, spec and stock stay as they are.

**Why not rentals api-design 07.** 07 is the failed-check swap of E01-5: the reserved unit goes to
`MAINTENANCE` with a `HANDOVER_CHECK_FAILED` record and the server picks the replacement
(`reserve(variantId, 1, ...)`); its body takes `reason` only in the built code, and it carries no
`expectedVersion`. The quick swap differs on all three points: the replaced unit goes back to `AVAILABLE`
with no record, the replacement is the docked unit the caller names, and the counter must not act on a
contract it read before an undo or another swap. So the spec adds rentals api-design 32,
`POST /api/contracts/:id/devices/:deviceId/exchange` (`contract.operate`), and leaves 07 as it is. Folding it
into 07 with an outcome flag was option B of §12.12 Q1, not chosen.

Body: `replacementDeviceId`, the docked `nodeNum` of the replacement, and the contract `expectedVersion`. In one
transaction, after locking the contract and then the two device rows (`FOR UPDATE`, the replacement by id,
never `SKIP LOCKED`):

1. the contract is `APPROVED` and its `version` equals `expectedVersion` (409 `INVALID_STATE_TRANSITION`,
   `STALE_VERSION`);
2. `:deviceId` has a live row on the contract and is `RESERVED` (409 `DEVICE_NOT_ON_CONTRACT`);
3. `:deviceId` has no provisioning record at any version (409 `DEVICE_PROVISIONED`; §12.12 Q2, decided A);
4. the replacement's `nodeNum` equals the docked one (409 `NODE_MISMATCH`);
5. the replacement is of the contract's variant (409 `VARIANT_MISMATCH`) and `AVAILABLE` with no live row
   (409 `DEVICE_NOT_AVAILABLE`, which covers a unit held for a request, reserved elsewhere or `RENTED`);
6. the replaced row gets `releasedAt`; `DevicesService.release([deviceId])` moves it `RESERVED` to
   `AVAILABLE` with reason `EXCHANGED`; `DevicesService.reserve(variant, 1, contractId, tx, [replacementId])`
   moves the replacement `AVAILABLE` to `RESERVED`; a new live `ContractDevice` row is inserted; the contract
   `version` increases; one `DeviceTransition` row per unit names the contract; the audit row
   `contract.deviceExchanged` carries both devices and the docked `nodeNum`.

Quantity, plan, price and variant are untouched (rentals REQ-UBI-03), and the fleet's `AVAILABLE` count is the
same after as before. The response names both units and the new contract `version`, which the counter keeps
for its later requests.

Which reserved unit is replaced: on a counter row's Dock, the row's unit (REQ-EVT-37); from the panel, the
first reserved unit with no provisioning record in the contract's order, which Staff may change in the
confirmation dialog (§12.12 Q7, decided A).

### 12.7 Hot provisioning, uplink and flash from the hub

**Hot provisioning.** When api-design 30 of rentals answers, the hub runs §8.4 steps 2 to 5 on the
`Connection` it already holds, with the new device (`assetTag`, `nodeNum`) as the expected unit
(REQ-EVT-36): the docked `nodeNum` check, rentals api-design 21 for the key, the owner and channel writes in
one edit transaction, the one restart, the read-back, and rentals api-design 09 with the docked `nodeNum`.
No port chooser opens. A failure after the exchange leaves the exchange in place and the unit not provisioned
(REQ-ERR-21); the counter row shows "Dock {assetTag} again before handover.", and a later Provision on the
same row finishes it.

**Uplink.** Configure uplink in the device view runs §8.8 on the held `Connection` (REQ-EVT-42). The device
page's own button only opens the hub on that unit.

**Flash.** The Meshtastic session and the ESP ROM loader cannot share the port. Update firmware therefore:
takes the write lock, closes the Meshtastic session, hands the same `SerialPort` to `esp-flasher.ts` for §9.2
(chip check, MAC node-number check, write, verify), and after the unit resets opens a new `Connection` on
whichever port answers with the same `nodeNum` (§12.4 rule 1), then reads it again so the row shows the new
reported firmware (REQ-EVT-43). The record's firmware version is filled for completion as §9.2 says. A step
that fails names itself and records nothing (REQ-ERR-30).

**Where the flash panel plugs in (task 10.10, built 2026-11-04).** The hub owns the action and task 8.3 owns
the panel: 8.3 registers its component once with `useConnectorStore.getState().registerFlashPanel(panel)`, and
the hub opens it with the unit (`id`, `assetTag`, `nodeNum`, `variantCode`, the `OPEN` record's id) and
`withPort(work)`, which runs `work` on the unit's port under the hub's write lock and reads the unit again
afterwards. Until a panel registers, Update firmware shows disabled with the reason as text, "Firmware
releases are not published yet" (chapter 06 §9.8).

### 12.8 The docked-unit pin on the Staff map

The leader's answer 3: a unit docked for provisioning shows on the Staff map only, pinned at
`monitoring.counterLocation` with "Docked at the counter" while the browser holds its port; organizations see
it only after handover (D-092 unchanged).

**What tells the backend.** The browser holds the port, so only the browser knows. The hub opens a dock session
for a registered unit (api-design 31, `PUT /api/devices/:id/dock`, `device.operate`, body `nodeNum`), renews it
every third of `devices.dockPresenceTtlSeconds` with the same request, and ends it with api-design 32
(`DELETE /api/devices/:id/dock`) when the port is released, unplugged or forgotten, and on `pagehide` with a
`fetch` `keepalive` request. The units that open a session are the registered units held while the page context is
`counter` (§12.12 Q3, decided A). Any Staff or Admin caller may end the open session of a unit, whoever opened it: counters change hands, and
a stale session must be clearable (leader ruling on treklink-web#351).

**Where it lives.** A new `DeviceDockSession` row (`id`, `deviceId`, `nodeNum`, `openedById`, `openedAt`,
`renewedAt`, `endedAt`, `endReason` `RELEASED`, `EXPIRED` or `REPLACED`), with a partial unique index on
`deviceId` where `endedAt` is null, in a forward migration of task 10.3. A PUT for a device with an open session
renews it when the caller opened it and otherwise ends it `REPLACED` and opens a new one (a unit is plugged
into one computer at a time). The `devices.dockSweep` job, every third of the TTL, ends sessions not renewed
within `devices.dockPresenceTtlSeconds` as `EXPIRED`. Rows are kept as a record of who held which unit; they
do not enter the device history of monitoring api-design 07. §12.12 Q3 lists the in-memory and client-only
alternatives that were not chosen.

**How long.** From the first PUT to the DELETE, or at most `devices.dockPresenceTtlSeconds` after the last
renewal. The new parameter is `devices.dockPresenceTtlSeconds`, default 30, bounds 10 to 300, seconds, added to
`scripts/specs/catalog.py` with its forward migration by task 10.1 (not in this spec branch, which writes no
migration).

**Who can read it.** `devices` emits `device.docked` and `device.undocked` after commit; `monitoring` writes
them to the stream with no organization, so they reach the `fleet` room only (monitoring REQ-UBI-01) and
never an organization room, the organization API or its replay (REQ-EVT-39). Monitoring api-design 02 gives
TrekLink callers `docked: { since, byName }` on every entry and adds, for a docked unit outside any custody
interval, an entry with `state` `DOCKED`, `position` null and `counterLocation` set; an organization caller
gets `docked: null` and no `DOCKED` entry (REQ-STA-05). The Staff `LiveMapPage` (screen 9.1) pins a docked
unit at `counterLocation` with the label "Docked at the counter" and the asset tag, and drops the pin on
`device.undocked`. The pin is its own marker state (a double-bordered pin with the chip "Docked at the counter"), and the list beside the map reaches it by keyboard.

### 12.9 Sequence: connect, recognize, swap, provision

```mermaid
sequenceDiagram
    autonumber
    actor S as TrekLink Staff
    participant Hub as ConnectorRegistry
    participant U as Unit (Web Serial)
    participant Dev as devices API
    participant Rent as rentals API
    participant Mon as monitoring
    S->>Hub: open /t/counter/RC-2026-0042
    Hub->>Hub: navigator.serial.getPorts()
    Hub->>U: open port, want_config_id 69420
    U-->>Hub: my_node_num, pio_env, firmware_version, owner
    Hub->>Hub: drop channel settings (REQ-UBI-08)
    Hub->>Dev: GET /api/devices/by-node?nodeNum=n (api-design 30)
    Dev->>Rent: DEVICE_CONTRACTS.liveContractsOf(ids)
    Dev-->>Hub: TL-0051, treklink-v3, AVAILABLE, no contract
    Hub->>Dev: PUT /api/devices/TL-0051/dock (api-design 31)
    Dev-->>Mon: device.docked
    Mon-->>S: fleet room, pin at counterLocation
    S->>Hub: Put TL-0051 on RC-2026-0042 in place of TL-0001
    Hub->>Rent: POST /contracts/:id/devices/TL-0001/exchange (rentals 32)
    Rent-->>Hub: TL-0001 AVAILABLE, TL-0051 RESERVED, version
    Hub->>Rent: POST /contracts/:id/devices/TL-0051/channel-key (rentals 21)
    Rent-->>Hub: keyHex, keyVersion (no-store)
    Hub->>U: begin_edit, set_owner, set_channel 0, commit
    U-->>Hub: reboots once, handshake again, same nodeNum
    Hub->>Hub: read-back matches, key variable cleared
    Hub->>Rent: POST /contracts/:id/devices/TL-0051/provisioning (rentals 09)
    Rent-->>Hub: Provisioned v1
    S->>Hub: unplug TL-0051
    Hub->>Dev: DELETE /api/devices/TL-0051/dock (api-design 32)
    Dev-->>Mon: device.undocked
```

***Figure 19***: the quick swap with hot provisioning. A refusal at any step stops the sequence with the
message of the matching REQ-ERR, and nothing after the refusal runs.

### 12.10 Errors

| Case | Where it is caught | Row text | Server code |
|---|---|---|---|
| Port lost mid-write, after a quick swap | hub, §12.4 rule 4 | the failed step, then "Dock {assetTag} again before handover." | none; exchange stands (REQ-ERR-21) |
| Unit on another contract or held for a request | `actionsFor` | "{assetTag} is reserved to {contractCode}." | `DEVICE_NOT_AVAILABLE` (REQ-ERR-22) |
| `RENTED` unit | `actionsFor` | "{assetTag} is rented on {contractCode}. Check it in at the return counter." | `DEVICE_NOT_AVAILABLE` (REQ-ERR-23) |
| Unit answers nothing (v2 on an image without the USB console) | hub handshake | REQ-ERR-24 message | none |
| Variant mismatch | `actionsFor` | "{assetTag} is {variant}; {contractCode} rents {contractVariant}." | `VARIANT_MISMATCH` (REQ-ERR-25) |
| Replaced unit already provisioned | `actionsFor`, rentals 32 | "{assetTag} is provisioned; only units not provisioned can be swapped out." | `DEVICE_PROVISIONED` (REQ-ERR-26) |
| Port open elsewhere | hub open | "In use by another tab or app." | none (REQ-ERR-27) |
| Lookup failed | hub recognition | "Not checked: the server did not answer." | any (REQ-ERR-28) |
| Dock session for another unit | api-design 31 | none, the hub never sends it | `NODE_MISMATCH` (REQ-ERR-29) |
| Flash cannot take the port, no bootloader, no return | hub flash | the failed step | none (REQ-ERR-30) |
| Render missing | `DeviceView` | the labelled empty slot of §10 | none (REQ-ERR-31) |
| No Web Serial | hub | the Chromium banner of REQ-ERR-11 in the panel; Connect a unit disabled | none |

### 12.11 Testing

Unit tests over a fake `SerialPort` set (the fake of the docking branch, extended to several ports and to
`connect` and `disconnect` events): two units at once, replug without chooser, a reboot that returns a new
port with the same `nodeNum`, the write lock, `actionsFor` over every row of §12.3, and no PSK, key or payload
in storage, the query cache or the console after a session (AC-35). Backend tests: api-design 30 with known,
unknown and contracted units; 31 and 32 with renewal, replacement, `NODE_MISMATCH` and the sweep; rentals 32
with each refusal and the reservation race against a concurrent approval; monitoring 02 for a Staff and an
organization caller. Hardware run by the leader on v2 (treklink-firmware#27 image), v3 and v4: AC-25, AC-29,
AC-30, AC-34, AC-40.

### 12.12 Questions and decisions

Decided 2026-11-04 for the leader (every recommended option, option A), with the hub approved for building the
same night. The options not chosen are kept for their rationale.

| # | Question | Options | Recommendation | Decision |
|---|---|---|---|---|
| Q1 | How does the quick swap reach the server? | A. New rentals api-design 32 `exchange` (caller-chosen replacement, replaced unit to `AVAILABLE`, `expectedVersion`, docked `nodeNum`). B. Extend rentals 07 with `outcome: CHECK_FAILED or EXCHANGE`, `replacementDeviceId` and `nodeNum`. C. Two calls from the client: release the reserved unit, then reserve the docked one (two new or widened endpoints) | A: 07 keeps its E01-5 meaning and audit trail, and the two outcomes never share a code path that a flag can flip; C cannot be one transaction | Decided 2026-11-04: A |
| Q2 | May a reserved unit that is already provisioned be swapped out? Its hardware carries the organization's key, and an undo (rentals 19) does not remove it | A. Refuse with 409 `DEVICE_PROVISIONED`. B. Allow, and send the replaced unit to `MAINTENANCE` for a reset before it is rented again. C. Allow, unit to `AVAILABLE`, key version cleared, key left on the hardware | A: a unit with another organization's key must never reach `AVAILABLE`; B can come later if counters need it | Decided 2026-11-04: A |
| Q3 | Which docked units get the map pin, and how does the server learn of them? | A. Units held while the page context is `counter`, through the dock session table with heartbeat. B. Every registered unit the hub holds on any Staff page, same table. C. Only units `RESERVED` to the counter's contract, same table. D. No server state: the pin is drawn only on the same browser's map | A: the brief says "docked for provisioning" at the counter; the table survives a restart and several backend instances, and D would not show on a second Staff screen | Decided 2026-11-04: A |
| Q4 | Where does the device view's battery come from? | A. The server projection (`batteryPct`, `lastBatteryAt`). B. The unit's own reading over serial, after the firmware fact is checked and added to §8.2. C. Both, the unit's reading first | A now; B as a follow-up once the fact is recorded | Decided 2026-11-04: A |
| Q5 | How does the client find the detail and icon renders? | A. By convention from the variant `code`: `/variants/<code>-detail.png` and `/variants/<code>-icon.png`, no schema change; `imageUrl` stays the card photo. B. Two new variant fields, `detailImageUrl` and `iconImageUrl`, edited on screen 4.1 under the §10 rules. C. Replace `imageUrl` with the detail render and derive the icon by convention | A: it matches the leader's paths with no migration, and the labelled slot covers a missing file | Decided 2026-11-04: A |
| Q6 | The shell's Info pane docks on the right at 1280 px; the hub uses the right side from 1100 px (§10.8). Which yields? | A. One right panel at a time: opening the hub closes the Info pane and the reverse. B. The hub always opens as a `Drawer` over the page and never pushes the content. C. Both pushed side by side from 1600 px, A below | A: one predictable right side, and §10.8 placement kept | Decided 2026-11-04: A |
| Q7 | Which reserved unit does a panel-started quick swap replace (a counter row's Dock always replaces that row)? | A. The first reserved unit with no provisioning record, changeable in the dialog. B. Staff must always pick. C. Only from a counter row, never from the panel | A: one click in the common case, and the choice stays visible | Decided 2026-11-04: A |

### 12.13 The device hub page: device info, reboot and factory reset (brief W18, 2026-11-04)

> **Status**: Built on the leader's brief W18 of 2026-11-04 (due 2026-11-06). Q8 to Q10 below are built as the
> recommended option and wait for the leader's ruling; the options not chosen are kept. Requirements:
> REQ-EVT-44 to REQ-EVT-46, REQ-ERR-32, REQ-ERR-33, AC-41 to AC-44; amends REQ-UBI-08 and REQ-UBI-09. Screen 4.7.
> This section lifts the "no factory reset" exclusion of §12.1 for the reset of a returned unit only.

**Why a page.** The panel of §12.2 is 360 px wide; the brief asks for "one device page with everything about
it and its maintenance actions", laid out like a phone utility: the unit on the left, its facts and actions on
the right. The page is `/t/device-hub` (Staff and Admin, nav entry "Device hub"), a view over the same
`ConnectorRegistry`: it opens no port of its own and sets no page context, so the actions of §12.3 for the
context "none" apply. The panel's device view links to it ("Open in the device hub"). The unit shown is chosen
on the page from the connected units and kept in component state only; no `nodeNum` or node id goes into the
address bar (REQ-UBI-08).

**Layout.**

| Region | Content |
|---|---|
| Unit switcher (two or more units connected) | one toggle button per connection, asset tag or "Unknown unit {nodeId}", its connection state as text; the first connected unit is selected |
| Left: the unit | the variant's detail render (`/variants/<code>-detail.png`, Q5 A of §12.12; the labelled slot of REQ-ERR-31), the asset tag (or "Unknown unit"), the device status and the connection state as text |
| Right: Device info | the card of the table below, each value labelled with where it comes from |
| Right: Actions | the six actions below, always listed, each as a labelled button or with its unavailable reason as text beside it (chapter 06 §9.8) |
| Not connected | "No unit connected. Plug a unit in with its USB cable, then choose Connect a unit." with Connect a unit; the Chromium banner of REQ-ERR-11 when Web Serial is missing |

**Device info.**

| Fact | Source |
|---|---|
| Asset tag, variant, status, firmware on record, last seen | devices api-design 30 `device` |
| Node number and node id, owner long and short names, build environment, reported firmware | the handshake (§8.2) |
| Hardware model | the handshake: `DeviceMetadata.hw_model` as its enum name (table below) |
| Battery and voltage | the unit's own `DeviceMetrics` when the handshake carries them, labelled "from the unit"; else the server projection `batteryPct` with `lastBatteryAt` (Q10) |
| Region and modem preset | the handshake: `Config.lora.region` and `modem_preset` as enum names |
| Primary channel name | the handshake: channel 0 `settings.name`, or "Preset default" when empty; never the PSK |
| Contract and organization | devices api-design 30 `contract` (code, status, organization code), or "None" |
| Key version | devices api-design 30 `device.keyVersion` and `keyOrganization` (never the key) |
| Last reset, next step | devices api-design 07 `lastReset`, `nextStep` |

**Actions.**

| Action | Available when | Otherwise, as text |
|---|---|---|
| Provision | §12.3 offers it (the `counter` context only) | "Provision from the counter of its contract." with Open its counter when the unit is `RESERVED` |
| Quick swap | §12.3 offers it (the `counter` context only) | "Quick swap runs from a contract's counter." |
| Configure uplink | §12.3 offers it | §12.3's reason, or "Configure uplink needs a registered unit that is not retired." |
| Update firmware | §12.7 (task 8.3 registered its panel) | "Firmware releases are not published yet" |
| Reboot | any `Ready` unit while no write runs | "Another unit is being written." (REQ-STA-06) |
| Factory reset | a registered `RETURNED` unit with no open custody row (api-design 30 `contract` null) whose next step is `RESET` (api-design 07) | the reasons of REQ-ERR-32 |

**Reboot (REQ-EVT-45).** Under the write lock: open a session, send `AdminMessage.reboot_seconds` with 2, close
the session, wait for the restart as §8.4 step 4 does (`awaitRestart`, the Reconnect prompt when the port does not
return), read the unit again and require the same `nodeNum`. No server call and no audit: a reboot changes no
record. A failure names the step and changes nothing on the server.

**Factory reset (REQ-EVT-46).** It wipes what an organization left on a returned unit: its channel key, the owner
names it carried and every setting it may have changed (Wi-Fi, broker, module config), and the node database the
unit learned in the field. Steps, under the write lock:

1. The device view reads api-design 07 for the unit; the action is offered only for `RETURNED` with next step
   `RESET` and no open custody row (api-design 30 `contract` null). Before the wipe the hub asks api-design 30
   again and refuses a unit still in custody, so nothing is written to it (REQ-ERR-32). A confirmation `Dialog` names what is wiped (the organization's channel key, the owner names, the node
   database, Wi-Fi and broker settings), that the region is written back, that the unit restarts twice, and that
   the reset is recorded for this return.
2. Open a session; the docked `nodeNum` must equal the device's (REQ-ERR-12). Keep the region and the LoRa config
   as read. A unit that reports no LoRa config, or the region `UNSET` (0), is refused here with nothing written,
   since that region could not be written back.
3. `AdminMessage.factory_reset_config` (99). The firmware removes `/prefs`, installs the default node database,
   device state, config, module config and channels, saves, and reboots 7 s later. The node number is derived from
   the MAC address and does not change.
4. Wait for the restart (`awaitRestart`, Reconnect when needed); the unit must answer the same `nodeNum`.
5. In one edit transaction: `set_owner` with the asset tag and its last four characters (§8.6 decision 2, the note
   "Owner set back to the asset tag"), and `set_config` lora with the region read in step 2 and the rest as the
   unit now reports it; `commit_edit_settings` reboots once.
6. Wait for the restart again and read back: same `nodeNum`, owner names as written, region as written, the
   primary PSK equals the firmware default (one byte `0x01`), Wi-Fi off, MQTT off. A difference names the check
   and records nothing (REQ-ERR-33).
7. Record the reset with devices api-design 10, all three steps true and the docked `nodeNum`. The server checks
   the `nodeNum` (409 `NODE_MISMATCH`), the `RETURNED` state, the closed custody row and one reset per return,
   clears the key version, and writes the audit record `device.reset` with the method `DOCKED` after commit.

The region write in step 5 is needed: with `config.lora.region` `UNSET` the firmware drops every received LoRa
packet (`RadioLibInterface.cpp:547-552`), and no TrekLink variant sets a region in its user preferences; the
variants' `REGULATORY_LORA_REGIONCODE` (MY_433) only fixes the frequency plan (`RadioInterface.cpp:498-511`).

**Server record.** No new table, permission or state: api-design 10 already records a reset (`DeviceReset`), needs
`device.operate`, refuses a unit that is not `RETURNED` (which covers `RENTED`) and a unit whose custody row is
still open ("Check this device in on its contract first."), and clears `keyVersion` and `keyOrganizationId`. Two
additions: an optional body field `nodeNum`, the docked unit, checked against the device (409 `NODE_MISMATCH`) and
marking the record as made by the hub; and the audit record `device.reset` after commit for every reset (actor,
device, the key version and organization before, the method `DOCKED` or `MANUAL`, the docked `nodeNum`). The
device's status does not change: the inspection that follows moves it, as before (REQ-EVT-07).

**Firmware facts** (`treklink-firmware` `dev` at `c74ddfd`, read 2026-11-04; to be copied into the ground truth
file of treklink-docs, which this branch cannot edit).

| Fact | Source |
|---|---|
| `AdminMessage` reboot_seconds 97, factory_reset_device 94, factory_reset_config 99, nodedb_reset 100 | `src/mesh/generated/meshtastic/admin.pb.h:605-611` |
| reboot_seconds reboots after the given seconds | `src/modules/AdminModule.cpp:233-236`, `:1356-1362` |
| factory_reset_config runs `NodeDB::factoryReset()` and reboots after `DEFAULT_REBOOT_SECONDS` (7) | `AdminModule.cpp:297-304`, `src/configuration.h:372` |
| `factoryReset` removes `/prefs`, installs the default node database, device state, config (private key kept), module config and channels, then saves; with `eraseBleBonds` (factory_reset_device) it also erases NVS | `src/mesh/NodeDB.cpp:509-554` |
| The default owner of a TrekLink build is "TrekLink {last 4 hex}" and its short name the 4 hex digits; the node number is kept from memory or derived from the MAC | `NodeDB.cpp:1110-1146`, `:1154-1176` |
| The default channel's PSK is one byte, value 1 | `src/mesh/Channels.cpp:135-137` |
| The default region is `UNSET` unless `USERPREFS_CONFIG_LORA_REGION` is set; `userPrefs.jsonc` sets none | `NodeDB.cpp:617-621`, `userPrefs.jsonc` |
| With region `UNSET` received LoRa packets are dropped | `src/mesh/RadioLibInterface.cpp:547-552` |
| TrekLink variants set `REGULATORY_LORA_REGIONCODE` MY_433, which overrides the region table lookup only | `variants/esp32/treklink_v3_tbeam/variant.h:21-22`, `variants/esp32s3/treklink_v4_supreme/variant.h:21-22`, `variants/esp32s3/treklink_v2_0/variant.h:80`, `src/mesh/RadioInterface.cpp:498-511` |
| `DeviceMetadata` hw_model 9, set to `HW_VENDOR` | `src/mesh/generated/meshtastic/mesh.pb.h:1837`, `src/main.cpp:1095` |
| The handshake's own `NodeInfo` carries `device_metrics` (battery_level 1, voltage 2) once the unit has recorded its own telemetry | `src/mesh/PhoneAPI.cpp:309-320`, `src/mesh/TypeConversions.cpp:43-45`, `src/modules/Telemetry/DeviceTelemetry.cpp:194`, `telemetry.pb.h:543-544` |
| `Config` lora 6; `LoRaConfig` region 7 | `config.pb.h:873`, `:902` |

The client library sends these as `MeshDevice.reboot(seconds)` and `MeshDevice.factoryResetConfig()`
(`@meshtastic/core` 2.6.7). The behaviour on the bench (two restarts, the read-back of step 6) is (unverified)
until task 10.12 runs it on v3 and v4.

**Errors.**

| Case | Where | Text | Server code |
|---|---|---|---|
| Unit not registered | page | "Register this unit first." | none |
| `RENTED` | page, api-design 10 | "{assetTag} is rented on {contractCode}. Check it in at the return counter first." | `INVALID_STATE_TRANSITION` |
| Not `RETURNED` otherwise | page, api-design 10 | "Factory reset is for returned units. {assetTag} is {status}." | `INVALID_STATE_TRANSITION` |
| Already reset for this return | page, api-design 10 | "{assetTag} is already reset for this return." | `ALREADY_RESET` |
| Custody row still open (the recognition's `contract` is set) | page and hub before the wipe, api-design 10 | "{assetTag} is still in custody on {contractCode}. Check it in on its contract first." (the server's text: "Check this device in on its contract first.") | `INVALID_STATE_TRANSITION` |
| Docked unit is another device | hub, api-design 10 | "The docked unit is {nodeId}, not {assetTag}. Nothing was written." | `NODE_MISMATCH` |
| Region `UNSET` or no LoRa config reported | hub, before the wipe | "{assetTag} reports no LoRa region, so it could not be written back after the reset. Set its region first. Nothing was written." | none (REQ-ERR-32) |
| Write, restart or read-back fails | hub | the failed step, "Nothing was recorded. Dock {assetTag} and run Factory reset again." | none (REQ-ERR-33) |
| The server refuses after the wipe | hub | the server's message; the unit stays wiped and the reset can be recorded again from the counter | any |

**Testing.** `hubActionsFor` over every row of the Actions table; the reboot and the factory reset on the fake
port (the admin calls in order, the two restarts, a read-back that differs records nothing, a mismatch writes
nothing); the page at 1280, 900 and 360 px in both themes with a mocked adapter (connected, several units, not
connected, no Web Serial); backend unit tests for the `nodeNum` check and the audit record.

**Questions for the leader (built as A, pending).**

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q8 | Which firmware command wipes a returned unit? | A. `factory_reset_config` (99), then owner and region written back in one transaction (two restarts). B. `factory_reset_device` (94): the same and an NVS erase, which also drops the Wi-Fi and BLE data the ESP32 keeps there. C. No factory command: write owner, a random channel key, Wi-Fi off and MQTT off in one transaction, and `nodedb_reset` (100) | A: one command clears everything api-design 10's three steps name and keeps the unit's private key; B erases more than the brief asks; C needs four writes to reach what A does in one |
| Q9 | The brief's "refuse while its contract is not closed": the unit's custody row, or the contract itself? | A. The custody row: the unit must be checked in (`RETURNED`, the existing api-design 10 guard). B. The contract `CLOSED` | A: the inspection needs the reset first (REQ-ERR-02) and a damage charge needs a contract not yet `CLOSED` (rentals REQ-EVT-11), so B would stop damage being charged |
| Q10 | Battery in the device info: §12.12 Q4 chose the server projection; the brief asks for battery and voltage read live | A. The unit's `DeviceMetrics` when present, labelled "from the unit", else the server projection. B. The server projection only (Q4 as decided) | A: the fact is now cited above; a unit that has not measured yet shows the server value |
