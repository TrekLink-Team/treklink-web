# Requirements Specification: devices (asset management)

**User Story**: As **TrekLink Staff**, I want every device registered with two permanent identities, checked on intake, tracked through its whole life and reset between renters, so that each organization gets a clean, working unit and the fleet keeps its value.
**Story ID**: assigned when the backlog is regenerated | **Priority**: High | **Milestone**: MF-01 (intake), MF-05 (return loop)

> **Authority**: Report 3 SRS (2026-10-14) UC-11 to UC-14, UC-44, UC-49, UC-52 to UC-54, UC-60, UC-62, FR-DEV-01 to FR-DEV-16, BR-04, BR-09, BR-10, BR-28, BR-37, BR-38, BR-42; D-035 (device lifecycle) as amended by D-045 (composite lifecycle, loss case, `DISPOSED`); D-021 (key versions only). Rewritten 2026-10-04 (D-036); loss cases and disposal added 2026-10-14 (D-045).

---

## 1. Domain Context & Scope

- **In-Scope**: hardware variants and their remaining-value schedules; device registration with asset tag
  and `nodeNum`; the eight-state lifecycle; intake checks; provisioning records; resets; inspections;
  maintenance; retirement; recovery; stock-take; the last-seen projection written by `gateway-sync`.
- **Out-of-Scope**: which contract a device is on (`rentals`); damage and loss charges (`billing`); the
  device's history merged with contracts and incidents (served by `monitoring`, FR-DEV-11); the channel
  key itself, which never enters the platform.
- **Depends on**: `platform`, `auth`. Called by `rentals` (reserve, release, provisioning, hand over,
  check-in, inspection, loss), `gateway-sync` (projection), `billing` (remaining value), `monitoring`.

### Traceability

| This spec | SRS |
|---|---|
| Lifecycle | FR-DEV-01, BR-10, D-035, D-045 |
| Registration and intake | UC-11, UC-12, FR-DEV-02, FR-DEV-03 |
| Variants | UC-13, FR-DEV-04 |
| Provisioning | UC-14, FR-DEV-05, BR-09 |
| Projection | UC-26, FR-DEV-06 |
| Reset and inspection | UC-44, FR-DEV-07, BR-28 |
| Maintenance, retirement | UC-52, UC-53, FR-DEV-08, FR-DEV-09 |
| Stock-take | UC-54, FR-DEV-10 |
| Loss cases | UC-49, UC-60, FR-DEV-12 to FR-DEV-15, BR-37, BR-38, E05-8 to E05-10 |
| Disposal | UC-62, FR-DEV-16, BR-42 |
| History | UC-53, FR-DEV-11 (rows owned here, merged by `monitoring`) |

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL change device state only through the transition table of design §2 and SHALL reject any other change with 409 `INVALID_STATE_TRANSITION`; each transition SHALL be one compare-and-set on `version` plus one append-only `DeviceTransition` row with actor or `SYSTEM`, reason and UTC time. [FR-DEV-01, BR-10]
- **REQ-UBI-02**: The system SHALL keep `assetTag` and `nodeNum` unique across every device ever registered, retired devices included, and SHALL never change either after registration. [FR-DEV-02]
- **REQ-UBI-03**: The system SHALL store only the version of an organization channel key on a device, never the key, and SHALL never display, return or log a key. [FR-DEV-05, NFR-SEC-06]
- **REQ-UBI-04**: The system SHALL never delete a device; retirement keeps the device and its history. [FR-DEV-09]

### Event-Driven

- **REQ-EVT-01**: WHEN Staff register a device with a unique asset tag and `nodeNum`, a variant, a firmware version and an acquisition date, the system SHALL create it `IN_INTAKE`. [FR-DEV-02]
- **REQ-EVT-02**: WHEN Staff record an intake check, the system SHALL require GPS, radio and battery results, and the motion result when the variant has a motion sensor, and SHALL move an `IN_INTAKE` device, or a `MAINTENANCE` device with no open maintenance record, to `AVAILABLE` on a pass and to `MAINTENANCE` with a record opened on a failure. [FR-DEV-03, FR-DEV-08]
- **REQ-EVT-03**: WHEN `rentals` reserves devices for an approved contract, the system SHALL lock `AVAILABLE` devices of the variant with `FOR UPDATE SKIP LOCKED`, move exactly the requested number to `RESERVED`, or reserve none and report the shortfall. [FR-CON-03, BR-03]
- **REQ-EVT-04**: WHEN `rentals` records provisioning of a `RESERVED` device, the system SHALL store the organization and key version and append a `DeviceProvisioning` row. [FR-DEV-05]
- **REQ-EVT-05**: WHEN `rentals` completes a handover, the system SHALL move each device `RESERVED` to `RENTED`; WHEN it checks a device in, `RENTED` to `RETURNED`; WHEN it releases a cancelled reservation, `RESERVED` to `AVAILABLE`; WHEN it completes a replacement, the replacement `RESERVED` to `RENTED`. [D-035, D-045]
- **REQ-EVT-06**: WHEN Staff record a reset of a `RETURNED` device with all three steps done, the system SHALL append a `DeviceReset` row and clear the device's key version and key organization. [FR-DEV-07, BR-28]
- **REQ-EVT-07**: WHEN `rentals` records an inspection of a `RETURNED` device that has a reset logged after its last check-in, the system SHALL append the inspection and move the device to `AVAILABLE` (`PASSED`) or to `MAINTENANCE` with a record opened (`DAMAGED`, `FAILED`). [FR-DEV-07, BR-04, BR-28]
- **REQ-EVT-08**: WHEN `gateway-sync` reports a plotted position or telemetry newer than the stored last-seen time, the system SHALL update `lastSeenAt`, battery and last position; an older reading SHALL be discarded. [FR-DEV-06]
- **REQ-EVT-09**: WHEN Staff open maintenance on an `AVAILABLE` device with a reason, the system SHALL move it to `MAINTENANCE`; WHEN they close the record, the device SHALL stay `MAINTENANCE` until an intake check passes. [FR-DEV-08]
- **REQ-EVT-10**: WHEN an Admin retires a `MAINTENANCE` device with a reason, the system SHALL move it to `RETIRED`; a `LOST` device is retired only by settling its loss case. [FR-DEV-09, FR-DEV-15]
- **REQ-EVT-11**: WHEN Staff record a lost device as recovered, the system SHALL move its loss case to `RECOVERED` (a `SETTLED` case stays `SETTLED`) and the device to `RETURNED`, after which reset and inspection apply as for any return. [FR-DEV-14, BR-38, E05-10; formerly D-035]
- **REQ-EVT-12**: WHEN Staff run a stock-take with scanned asset tags, the system SHALL report in-stock units confirmed by scan, rented units heard within `devices.stockTakeSeenHours`, every unit confirmed by neither, and unknown tags, and SHALL store the run. [FR-DEV-10]

- **REQ-EVT-13**: WHEN an Org Manager reports a device its organization rents as lost, or Staff report any device in service as lost, the system SHALL move the device to `LOST` from whichever of `IN_INTAKE`, `AVAILABLE`, `RESERVED`, `RENTED`, `RETURNED` or `MAINTENANCE` it was in, open one `LossCase` in `REPORTED` with the reporter, the description and the device's last seen time and position, and notify TrekLink Staff. [FR-DEV-12, BR-37, E05-8]
- **REQ-EVT-14**: WHEN Staff triage a `REPORTED` loss case, the system SHALL ask `rentals.custodyAt(deviceId, lastSeenAt)` and record `RENTER` custody with the custody interval, or `TREKLINK` when no interval contains the time; for `RENTER` custody it SHALL call `organizations.markKeyExposed(orgId)`; for a suspected theft or fraud it SHALL call `organizations.openOrLinkComplianceCase`; it SHALL move the case to `SEARCHING` and set `searchEndsAt` to the triage time plus `devices.lossSearchDays`. [FR-DEV-13, D-045, D-046]
- **REQ-EVT-15**: WHEN Staff confirm a `SEARCHING` case, or the `devices.lossSearch` job finds `searchEndsAt` passed, the system SHALL move the case to `CONFIRMED` and, for `RENTER` custody, call `billing.chargeLoss` for the contract. [FR-DEV-15, FR-BILL-05, BR-25]
- **REQ-EVT-16**: WHEN an Admin who did not triage the case settles a `CONFIRMED` case as charged, reduced, waived or written off, the system SHALL record the decision and reason, have `billing` adjust the loss line, move the case to `SETTLED` and the device to `RETIRED`. [FR-DEV-15, FR-BILL-11, BR-39]
- **REQ-EVT-17**: WHEN an Admin disposes of a `RETIRED` device with all three wipe steps done and a method, the system SHALL append a `DeviceDisposal` row and move the device to `DISPOSED`. [FR-DEV-16, BR-42]

### State-Driven

- **REQ-STA-01**: WHILE a device is not `AVAILABLE`, the system SHALL NOT reserve it. [FR-CON-11, MSG17]
- **REQ-STA-02**: WHILE a variant has registered devices, the system SHALL refuse to delete it or to change its sensor flags. [FR-DEV-04]

### Unwanted Behaviour

- **REQ-ERR-01**: IF an asset tag or `nodeNum` was ever registered, THEN the system SHALL return 409 `CONFLICT_UNIQUE` (MSG10).
- **REQ-ERR-02**: IF an inspection is attempted with no reset logged since the last check-in, THEN the system SHALL return 409 `RESET_REQUIRED`.
- **REQ-ERR-03**: IF a reset leaves any step undone, THEN the system SHALL return 400 `RESET_INCOMPLETE`.
- **REQ-ERR-04**: IF an intake check lacks the motion result for a variant with a motion sensor, THEN the system SHALL return 400 `MOTION_RESULT_REQUIRED`.
- **REQ-ERR-05**: IF a device already has a loss case outside `RECOVERED` and `SETTLED`, THEN the system SHALL return 409 `LOSS_CASE_OPEN`. [BR-37]
- **REQ-ERR-06**: IF the settling Admin triaged the case, THEN the system SHALL return 403 `SEPARATION_OF_DUTY`. [BR-39]
- **REQ-ERR-07**: IF a disposal leaves any wipe step undone, THEN the system SHALL return 400 `WIPE_INCOMPLETE`. [BR-42]

---

## 3. Non-Functional Requirements

| Property | Target | Source |
|---|---|---|
| Reservation under contention | two concurrent approvals for the last N devices never both succeed | E01-1, TC-03 |
| Projection write | ≤10 ms per event inside the ingestion transaction | NFR-PERF-02 |

---

## 4. Configuration

The `devices` section of the [Configuration Matrix](../platform/configuration-matrix.md).

---

## 5. Acceptance Criteria

- **AC-01**: Every pair in the state matrix is either a listed transition or rejected with 409. (TC-10)
- **AC-02**: A returned device cannot become `AVAILABLE` without a logged reset after its check-in. (TC-28)
- **AC-03**: Registering a second device with a retired device's `nodeNum` returns 409.
- **AC-04**: A stock-take with one rented unit last heard 30 hours ago lists it as unconfirmed.
- **AC-05**: An `AVAILABLE` unit reported lost by Staff is triaged `TREKLINK` custody; after confirmation it is written off with no charge to any organization. (E05-9)
- **AC-06**: A unit reported lost by the Manager mid-term is triaged `RENTER` custody, the organization's key is marked exposed, and confirmation charges the remaining value to that contract. (E05-8, E05-3)
- **AC-07**: The Admin who triaged a case gets 403 when settling it. (BR-39)
- **AC-08**: A recovered device is `RETURNED` and cannot become `AVAILABLE` before reset and inspection. (BR-38)

---

## 6. Open Questions

None.
