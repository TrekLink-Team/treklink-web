# Requirements Specification: devices

**User Story**: As **Staff running the device fleet**, I want every physical TrekLink unit registered once, moved through one 7-state lifecycle with every transition recorded, provisioned with the fleet channel key, and taken into maintenance or retirement with a reason, so that I never hand out a unit that is double-booked, faulty or unprovisioned, and so that its whole history can be audited.
**Story IDs**: US-011 to US-022 (E2) | **Priority**: High | **Main Flows**: MF-01 (allocation, check-out), MF-05 (return, maintenance, retirement) | **Lane**: KhoaDD (`devices` owner per charter)

> **Authority**: charter §2 (7-state lifecycle), D-008 and D-019 (firmware), D-015, D-021 (PSK provisioning belongs here), `04-firmware-ground-truth.md` §3 (node number) and §5 (variants). Clarification answers **Q47 to Q54** are **Recorded, not Confirmed**; requirements resting on them are tagged `[Qnn]`. **Q47 states the device FSM is not final**, so §2's transition table is a proposal for approval, and it is the part of this spec most likely to change.

---

## 1. Domain Context & Scope

- **In-Scope**:
  - Hardware-variant catalogue (US-011), seeded with `treklink-v1` to `treklink-v4` and their capability flags `[Q49, Q50]`
  - Device registration with asset tag, variant, firmware version, Meshtastic node number and MAC (US-012) `[Q49]`
  - The **7-state lifecycle FSM** `AVAILABLE, RESERVED, RENTED, IN_FIELD, RETURNED, MAINTENANCE, RETIRED` as an explicit transition table, with every transition written to an append-only history (US-013, US-022, charter §2) `[Q47, Q48, Q54]`
  - Current-state projection written by `gateway-sync`: last seen, battery, last position, buffering (US-017)
  - Battery advisory: telemetry informs, never blocks `[Q52]`
  - Channel PSK provisioning record (D-021): which key version a unit carries, who provisioned it, when `[Q51]`
  - Maintenance records: open, repair, complete, unrepairable (US-018, US-019)
  - Retirement with reason, including loss (US-020, FR-DEV-09)
  - Fleet list, detail and availability count for a time window (US-015, US-016, US-021)
- **Out-of-Scope**:
  - Booking, allocation windows and check-out, owned by `rentals`. This module enforces the device-side guards `rentals` calls.
  - Ingesting telemetry, owned by `gateway-sync`; this module only exposes the projection writer.
  - Flashing firmware or writing the PSK onto a unit from the browser. The platform **records** provisioning done with the Meshtastic app or CLI; it does not perform it.
  - Storing the PSK itself. It is a managed secret in environment configuration (D-021), never in the database.
- **Depends on**: `platform`, `auth`.

### Traceability

| Group | MF | UC | FR | BR | Exception | Story |
|---|---|---|---|---|---|---|
| Variant catalogue | MF-01 | UC-51 Manage Hardware Variants (new) | FR-DEV-02 (new) | | | US-011 |
| Registration | MF-01 | UC-38 Register Device (new) | FR-DEV-03 (new) | | | US-012 |
| 7-state FSM, history | MF-01, MF-05 | UC-05, UC-08, UC-09 | FR-DEV-01 | BR-05 | | US-013, US-022 |
| Battery advisory, handover threshold | MF-01 | UC-08 | FR-DEV-05 | BR-04 | E01-3 | US-017 |
| PSK provisioning | MF-01 | UC-39 Provision Device (new) | FR-DEV-06 (new) | | | none, gap (C-004) |
| Maintenance | MF-05 | UC-41 Record Maintenance (new) | FR-DEV-07 (new) | | E05-2, E05-6 | US-018, US-019 |
| Retirement and loss | MF-05 | UC-42 Retire Device (new) | FR-DEV-09 | BR-22 | E05-3 | US-020 |
| Fleet views | MF-04 | UC-14 | FR-DEV-08 (new) | | | US-015, US-016, US-021 |

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL hold every device in exactly one of the seven states `AVAILABLE`, `RESERVED`, `RENTED`, `IN_FIELD`, `RETURNED`, `MAINTENANCE`, `RETIRED`. [charter §2, FR-DEV-01]
- **REQ-UBI-02**: The system SHALL change a device's state only through one service method that checks the transition table in `design.md` §2.1, and SHALL reject every other transition with 409 `INVALID_STATE_TRANSITION`. No state may be skipped. [BR-05]
- **REQ-UBI-03**: The system SHALL record every state transition in an append-only history row with from state, to state, actor (or `SYSTEM`), reason, the referenced rental, allocation, inspection or maintenance record, and UTC timestamp, in the same transaction as the transition. [NFR-SEC-04, Q54]
- **REQ-UBI-04**: The system SHALL store the Meshtastic node number as an unsigned 32-bit value in a 64-bit column, unique across devices, and SHALL accept it in either decimal or the `!xxxxxxxx` hexadecimal form the Meshtastic app displays. [`04-firmware-ground-truth.md` §3]
- **REQ-UBI-05**: The system SHALL never hard-delete a device. [`04-architecture-conventions.md` §2]
- **REQ-UBI-06**: The system SHALL NOT store a channel PSK, or any value from which it can be derived, in the database, a log or an API response. It SHALL store only the PSK **version** a device was provisioned with. [D-021]
- **REQ-UBI-07**: The system SHALL NOT block allocation, check-out or retirement on telemetry values. Telemetry battery readings SHALL only produce an advisory. [Q52]

### Event-Driven

- **REQ-EVT-01**: WHEN Staff registers a device with a unique asset tag, an active hardware variant and optional node number, MAC and firmware version, the system SHALL create it in `AVAILABLE` with an initial history row. [US-012] `[Q49]`
- **REQ-EVT-02**: WHEN a registration names a variant whose `mqttCapable` flag is false (`treklink-v1`, whose image compiles MQTT out), the system SHALL register it and return a warning that the unit cannot uplink directly. [`04-firmware-ground-truth.md` §5] `[Q50]`
- **REQ-EVT-03**: WHEN `rentals` creates or confirms an allocation for a device that is `AVAILABLE`, the system SHALL move the device to `RESERVED`. WHEN the last open future allocation of a `RESERVED` device is released or expires, the system SHALL move it back to `AVAILABLE`. [MF-01 step 3]
- **REQ-EVT-04**: WHEN `rentals` checks a device out, the system SHALL move it `RESERVED` to `RENTED`. [MF-01 step 7]
- **REQ-EVT-05**: WHEN the trip a rented device belongs to enters `IN_PROGRESS`, the system SHALL move the device `RENTED` to `IN_FIELD`. `[Q48]` *(Proposal: automatic on trip start. Alternatives in C-003.)*
- **REQ-EVT-06**: WHEN `rentals` checks a device in, the system SHALL move it from `IN_FIELD` or `RENTED` to `RETURNED`. [MF-05 step 1]
- **REQ-EVT-07**: WHEN a return inspection marks a device serviceable, the system SHALL move it `RETURNED` to `AVAILABLE`, and then, IF it has an open future allocation, to `RESERVED`, as two history rows in one transaction. [MF-05 step 6]
- **REQ-EVT-08**: WHEN a return inspection marks a device not serviceable, or a Guide's handover check fails, the system SHALL move it to `MAINTENANCE` and open a maintenance record referencing the inspection or check. [E01-3, E05-2, E05-6]
- **REQ-EVT-09**: WHEN a device enters `MAINTENANCE` or `RETIRED` while it holds open future allocations, the system SHALL emit `device.unavailable` so `rentals` can flag those allocations for re-allocation, and SHALL NOT silently cancel them. [E01-3: re-allocate without redoing the booking]
- **REQ-EVT-10**: WHEN a maintenance record is completed as repaired, the system SHALL move the device `MAINTENANCE` to `AVAILABLE` (then `RESERVED` per REQ-EVT-07 rule); WHEN it is closed as unrepairable, the system SHALL move it to `RETIRED` with reason `UNREPAIRABLE`.
- **REQ-EVT-11**: WHEN Staff records a PSK provisioning for a device, the system SHALL store the key version, channel name, method and actor, and update the device's current PSK version. [D-021] `[Q51]`
- **REQ-EVT-12**: WHEN `gateway-sync` reports a field event for a device, the system SHALL update `lastSeenAt`, and where present `batteryPct`, last position and buffering, without writing a history row (projection updates are not transitions). [US-017]
- **REQ-EVT-13**: WHEN Staff confirms a device lost, the system SHALL move it from `RENTED` or `IN_FIELD` to `RETIRED` with reason `LOST` and a reference to the rental. [E05-3, FR-DEV-09, BR-22]

### State-Driven

- **REQ-STA-01**: WHILE a device is in `MAINTENANCE` or `RETIRED`, the system SHALL reject any new allocation referencing it. [`02-spec-driven-development-workflow.md` EARS example]
- **REQ-STA-02**: WHILE `devices.requireCurrentPskForCheckout` is true, the system SHALL reject check-out of a device whose PSK version differs from `devices.currentPskVersion`, with 409 `PSK_NOT_CURRENT`. [D-021]
- **REQ-STA-03**: WHILE a device's telemetry battery is below `devices.batteryAdvisoryPct`, the system SHALL return `batteryAdvisory = CHARGE_ADVISED` on reads, so Staff advise the Guide to charge first. [Q52]
- **REQ-STA-04**: WHILE a device is `RETIRED`, the system SHALL keep it readable with its full history and SHALL reject every transition out of `RETIRED`.

### Unwanted Behaviour

- **REQ-ERR-01**: IF a registration reuses an asset tag, node number or MAC of another device, THEN the system SHALL return 409 naming the field (`ASSET_TAG_TAKEN`, `NODE_NUM_TAKEN`, `MAC_TAKEN`).
- **REQ-ERR-02**: IF two transitions of the same device race, THEN exactly one SHALL succeed and the other SHALL receive 409 `INVALID_STATE_TRANSITION` computed against the committed state; the device row is locked for the duration of a transition. [Q48 "preventing state race conditions"]
- **REQ-ERR-03**: IF a manual transition request names a transition reserved to the system (for example `RESERVED` to `RENTED`, which only check-out may perform), THEN the system SHALL return 409 `TRANSITION_NOT_MANUAL`.
- **REQ-ERR-04**: IF a maintenance record is opened for a device that already has an open one, THEN the system SHALL return 409 `MAINTENANCE_ALREADY_OPEN`.
- **REQ-ERR-05**: IF a variant is deactivated while devices of it are not retired, THEN the system SHALL allow it (existing units keep working) and SHALL reject new registrations on it with 409 `VARIANT_INACTIVE`.
- **REQ-ERR-06**: IF a manual transition to `RETIRED` omits a reason, THEN the system SHALL return 400 `VALIDATION_FAILED`.

### Optional Features

- **REQ-OPT-01**: WHERE a trip restricts accepted hardware variants, the system SHALL expose `isVariantAccepted(deviceId, acceptedVariantIds)` for `rentals` to enforce at allocation. [Q50]

---

## 3. Non-Functional Requirements

| Property | Target | Source |
|---|---|---|
| Fleet scale | ≥50 devices, list and availability queries within NFR-PERF-01 | NFR-PERF-03 |
| Audit | 100 % of transitions have a history row written in the same transaction | NFR-SEC-04 |
| Concurrency | 20 concurrent transition attempts on one device yield exactly one success | REQ-ERR-02 |

---

## 4. Configuration Matrix entries

| Parameter | Default | Location | Admin-editable | Source of default |
|---|---|---|---|---|
| `devices.batteryAdvisoryPct` | 90 | DB | yes | Q52 |
| `devices.minHandoverBatteryPct` | 50 | DB | yes | Q52 ("target ≥50 %"); read by `rentals` handover check |
| `devices.currentPskVersion` | 1 | DB | yes | D-021 |
| `devices.requireCurrentPskForCheckout` | true | DB | yes | D-021 (proposal) |
| `FLEET_CHANNEL_PSK` | none | env, secret, never read by the backend | no | D-021; listed so the Configuration Matrix records where the secret lives |

---

## 5. Acceptance Criteria

- **AC-01**: Every row of the transition table in `design.md` §2.1 has a passing test, and every pair of states **not** in the table has a test asserting 409.
- **AC-02**: Registering node `!a4b1c2d3` and then node `2763113171` (the same value in decimal) returns 409 `NODE_NUM_TAKEN`.
- **AC-03**: A node number of `4294967295` registers and round-trips without overflow.
- **AC-04**: 20 concurrent `MAINTENANCE` requests on one `AVAILABLE` device produce one success, 19 × 409, and exactly one history row.
- **AC-05**: A device with PSK version 1 cannot be checked out after an Admin sets `devices.currentPskVersion` to 2; recording provisioning at version 2 unblocks it (D-015 demo).
- **AC-06**: A device reporting 40 % battery by telemetry can still be allocated; its detail shows `CHARGE_ADVISED`.
- **AC-07**: Moving a `RESERVED` device to `MAINTENANCE` emits `device.unavailable` with its open allocation ids, and the allocations are not cancelled.
- **AC-08**: `GET /api/devices/{id}/status-history` for a device that went through a full MF-01 and MF-05 cycle shows the seven states in order with actors.

---

## 6. Open Questions

Carried into QUESTION entry C-003: FSM finality (Q47), which transitions are automatic (Q48), lost-device handling (automatic retirement or Staff confirmation), and whether check-out is blocked on PSK version.
