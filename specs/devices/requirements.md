# Requirements Specification: devices (asset management)

**User Story**: As **TrekLink Staff**, I want every device registered with two permanent identities, checked on intake, tracked through its whole life and reset between renters, so that each organization gets a clean, working unit and the fleet keeps its value.
**Story ID**: assigned when the backlog is regenerated | **Priority**: High | **Milestone**: MF-01 (intake), MF-05 (return loop)

> **Authority**: Report 3 SRS (2026-10-04) UC-11 to UC-14, UC-44, UC-49, UC-52 to UC-54, FR-DEV-01 to FR-DEV-11, BR-04, BR-09, BR-10, BR-28; D-035 (device lifecycle) as amended by D-038 (lost from `RETURN_DUE`); D-021 (key versions only). Rewritten 2026-10-04 (D-036).

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
| Lifecycle | FR-DEV-01, BR-10, D-035, D-038 |
| Registration and intake | UC-11, UC-12, FR-DEV-02, FR-DEV-03 |
| Variants | UC-13, FR-DEV-04 |
| Provisioning | UC-14, FR-DEV-05, BR-09 |
| Projection | UC-26, FR-DEV-06 |
| Reset and inspection | UC-44, FR-DEV-07, BR-28 |
| Maintenance, retirement | UC-52, UC-53, FR-DEV-08, FR-DEV-09 |
| Stock-take | UC-54, FR-DEV-10 |
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
- **REQ-EVT-05**: WHEN `rentals` completes a handover, the system SHALL move each device `RESERVED` to `RENTED`; WHEN it checks a device in, `RENTED` to `RETURNED`; WHEN it releases a cancelled reservation, `RESERVED` to `AVAILABLE`; WHEN it records a loss, `RENTED` to `LOST`. [D-035, D-038]
- **REQ-EVT-06**: WHEN Staff record a reset of a `RETURNED` device with all three steps done, the system SHALL append a `DeviceReset` row and clear the device's key version and key organization. [FR-DEV-07, BR-28]
- **REQ-EVT-07**: WHEN `rentals` records an inspection of a `RETURNED` device that has a reset logged after its last check-in, the system SHALL append the inspection and move the device to `AVAILABLE` (`PASSED`) or to `MAINTENANCE` with a record opened (`DAMAGED`, `FAILED`). [FR-DEV-07, BR-04, BR-28]
- **REQ-EVT-08**: WHEN `gateway-sync` reports a plotted position or telemetry newer than the stored last-seen time, the system SHALL update `lastSeenAt`, battery and last position; an older reading SHALL be discarded. [FR-DEV-06]
- **REQ-EVT-09**: WHEN Staff open maintenance on an `AVAILABLE` device with a reason, the system SHALL move it to `MAINTENANCE`; WHEN they close the record, the device SHALL stay `MAINTENANCE` until an intake check passes. [FR-DEV-08]
- **REQ-EVT-10**: WHEN an Admin retires a `MAINTENANCE` or `LOST` device with a reason, the system SHALL move it to `RETIRED`. [FR-DEV-09]
- **REQ-EVT-11**: WHEN Staff record a `LOST` device as recovered, the system SHALL move it to `RETURNED`, after which reset and inspection apply as for any return. [D-035]
- **REQ-EVT-12**: WHEN Staff run a stock-take with scanned asset tags, the system SHALL report in-stock units confirmed by scan, rented units heard within `devices.stockTakeSeenHours`, every unit confirmed by neither, and unknown tags, and SHALL store the run. [FR-DEV-10]

### State-Driven

- **REQ-STA-01**: WHILE a device is not `AVAILABLE`, the system SHALL NOT reserve it. [FR-CON-11, MSG17]
- **REQ-STA-02**: WHILE a variant has registered devices, the system SHALL refuse to delete it or to change its sensor flags. [FR-DEV-04]

### Unwanted Behaviour

- **REQ-ERR-01**: IF an asset tag or `nodeNum` was ever registered, THEN the system SHALL return 409 `CONFLICT_UNIQUE` (MSG10).
- **REQ-ERR-02**: IF an inspection is attempted with no reset logged since the last check-in, THEN the system SHALL return 409 `RESET_REQUIRED`.
- **REQ-ERR-03**: IF a reset leaves any step undone, THEN the system SHALL return 400 `RESET_INCOMPLETE`.
- **REQ-ERR-04**: IF an intake check lacks the motion result for a variant with a motion sensor, THEN the system SHALL return 400 `MOTION_RESULT_REQUIRED`.

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

---

## 6. Open Questions

None.
