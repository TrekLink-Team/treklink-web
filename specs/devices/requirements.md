# Requirements Specification: devices (asset management)

**User Story**: As **TrekLink Staff**, I want every device registered with two permanent identities, checked on intake, tracked through its whole life and reset between renters, so that each organization gets a clean, working unit and the fleet keeps its value.
**Story ID**: the Stories row of `tasks.md` (backlog D-051) | **Priority**: High | **Milestone**: MF-01 (intake), MF-05 (return loop)

> **Authority**: Report 3 SRS (2026-10-14; traceability checked 2026-10-19) UC-11 to UC-14, UC-44, UC-49, UC-52 to UC-54, UC-60, UC-62, UC-64, UC-65, FR-DEV-01 to FR-DEV-21, BR-04, BR-09, BR-10, BR-28, BR-37, BR-38, BR-42, BR-44, BR-45; D-035 (device lifecycle) as amended by D-045 (composite lifecycle, loss case, `DISPOSED`) and D-047 (periodic maintenance); D-021 (key versions only). Rewritten 2026-10-04 (D-036); loss cases and disposal added 2026-10-14 (D-045); service plans, weekly scan, cost approval and firmware updates added 2026-10-14 (D-047).

---

## 1. Domain Context & Scope

- **In-Scope**: hardware variants with their remaining-value schedules and service plans; device registration
  with asset tag and `nodeNum`; the nine-state lifecycle; intake checks; provisioning records; resets;
  inspections; maintenance with its estimate, cost approval, checklist and firmware update; the weekly service
  scan; retirement; recovery; stock-take; the last-seen projection written by `gateway-sync`.
- **Out-of-Scope**: which contract a device is on (`rentals`); damage and loss charges (`billing`); paying a
  maintenance vendor, which happens outside the platform (D-047); the
  device's history merged with contracts and incidents (served by `monitoring`, FR-DEV-11); the channel
  key itself, which never enters the platform.
- **Depends on**: `platform`, `auth`. Called by `rentals` (reserve, release, provisioning, hand over,
  check-in, inspection, loss), `gateway-sync` (projection), `billing` (remaining value), `monitoring`.

### Traceability

| This spec | SRS |
|---|---|
| Lifecycle | FR-DEV-01, BR-10, D-035, D-045 |
| Registration and intake | UC-11, UC-12, FR-DEV-02, FR-DEV-03 |
| Variants and service plans | UC-13, FR-DEV-04 |
| Provisioning | UC-14, FR-DEV-05, BR-09 |
| Projection | UC-26, FR-DEV-06 |
| Reset and inspection | UC-44, FR-DEV-07, BR-28 |
| Maintenance, retirement | UC-52, UC-53, FR-DEV-08, FR-DEV-09, FR-DEV-21 |
| Service due date and weekly scan | UC-65, FR-DEV-17 to FR-DEV-19, BR-45, E05-12 |
| Maintenance cost approval | UC-64, FR-DEV-20, BR-44, E05-13 |
| Stock-take | UC-54, FR-DEV-10 |
| Loss cases | UC-49, UC-60, FR-DEV-12 to FR-DEV-15, BR-37, BR-38, E05-8 to E05-10 |
| Disposal | UC-62, FR-DEV-16, BR-42 |
| History | UC-53, FR-DEV-11 (rows owned here, merged by `monitoring`) |
| Docking at the counter (D-080, D-082) | UC-11, UC-14, FR-DEV-02, FR-DEV-05, BR-09, D-021 |

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL change device state only through the transition table of design §2 and SHALL reject any other change with 409 `INVALID_STATE_TRANSITION`; each transition SHALL be one compare-and-set on `version` plus one append-only `DeviceTransition` row with actor or `SYSTEM`, reason and UTC time. [FR-DEV-01, BR-10]
- **REQ-UBI-02**: The system SHALL keep `assetTag` and `nodeNum` unique across every device ever registered, retired devices included, and SHALL never change either after registration. [FR-DEV-02]
- **REQ-UBI-03**: The system SHALL store only the version of an organization channel key on a device, never the key, and a derived key SHALL be returned only to the counter's docking request, each request audited, and never stored, displayed or logged. [FR-DEV-05, NFR-SEC-06, NFR-IF-03, D-082]
- **REQ-UBI-04**: The system SHALL never delete a device; retirement keeps the device and its history. [FR-DEV-09]
- **REQ-UBI-05**: The counter SHALL talk to a docked unit only over Web Serial after Staff choose the port in the browser's own prompt, and SHALL keep no channel key, port handle or unit payload after a docking ends: nothing in `localStorage`, `sessionStorage`, IndexedDB, the query cache or the console. [D-080, NFR-SEC-06]
- **REQ-UBI-06**: The system SHALL hold for each hardware variant an optional image URL and a spec sheet of the keys listed in design §10, SHALL return both with the variant, and SHALL never let the spec sheet drive behaviour, which the capability flags do. [FR-DEV-04, D-093]

### Event-Driven

- **REQ-EVT-01**: WHEN Staff register a device with a unique asset tag and `nodeNum`, a variant, a firmware version and an acquisition date, the system SHALL create it `IN_INTAKE`. [FR-DEV-02]
- **REQ-EVT-02**: WHEN Staff record an intake check, the system SHALL require GPS, radio and battery results, and the motion result when the variant has a motion sensor, and SHALL move an `IN_INTAKE` device, or a `MAINTENANCE` device with no open maintenance record, to `AVAILABLE` on a pass and to `MAINTENANCE` with a record opened on a failure. [FR-DEV-03, FR-DEV-08]
- **REQ-EVT-03**: WHEN `rentals` reserves devices for an approved contract, the system SHALL lock `AVAILABLE` devices of the variant with `FOR UPDATE SKIP LOCKED`, move exactly the requested number to `RESERVED`, or reserve none and report the shortfall. [FR-CON-03, BR-03]
- **REQ-EVT-04**: WHEN `rentals` records provisioning of a `RESERVED` device, the system SHALL store the organization and key version and append a `DeviceProvisioning` row. WHEN `rentals` undoes that record before the handover, the system SHALL clear the key version, key organization and provisioning time and keep the `DeviceProvisioning` row (rentals REQ-EVT-16). [FR-DEV-05]
- **REQ-EVT-05**: WHEN `rentals` completes a handover, the system SHALL move each device `RESERVED` to `RENTED`; WHEN it checks a device in, `RENTED` to `RETURNED`; WHEN it releases a cancelled reservation, `RESERVED` to `AVAILABLE`; WHEN it completes a replacement, the replacement `RESERVED` to `RENTED`. [D-035, D-045]
- **REQ-EVT-06**: WHEN Staff record a reset of a `RETURNED` device with all three steps done, the system SHALL append a `DeviceReset` row and clear the device's key version and key organization. [FR-DEV-07, BR-28]
- **REQ-EVT-07**: WHEN `rentals` records an inspection of a `RETURNED` device that has a reset logged after its last check-in, the system SHALL append the inspection and move the device to `AVAILABLE` (`PASSED`) or to `MAINTENANCE` with a record opened (`DAMAGED`, `FAILED`); a `PASSED` device whose `serviceDueAt` is within `devices.maintenanceLeadDays`, or whose firmware differs from its variant's baseline, SHALL go to `MAINTENANCE` with a `SCHEDULED` or `FIRMWARE_UPDATE` record instead. [FR-DEV-07, FR-DEV-19, BR-04, BR-28, BR-45]
- **REQ-EVT-08**: WHEN `gateway-sync` reports a plotted position or telemetry newer than the stored last-seen time, the system SHALL update `lastSeenAt`, battery and last position; an older reading SHALL be discarded, and a reading of the same second SHALL apply. [FR-DEV-06]
- **REQ-EVT-09**: WHEN Staff open maintenance on an `AVAILABLE` device with a reason and an expected completion date, the system SHALL move it to `MAINTENANCE`; WHEN they complete the record, the device SHALL stay `MAINTENANCE` until an intake check passes. [FR-DEV-08]
- **REQ-EVT-10**: WHEN an Admin retires a `MAINTENANCE` device with a reason, the system SHALL move it to `RETIRED`; a `LOST` device is retired only by settling its loss case. [FR-DEV-09, FR-DEV-15]
- **REQ-EVT-11**: WHEN Staff record a lost device as recovered, the system SHALL move its loss case to `RECOVERED` (a `SETTLED` case stays `SETTLED`) and the device to `RETURNED`, after which reset and inspection apply as for any return. [FR-DEV-14, BR-38, E05-10; formerly D-035]
- **REQ-EVT-12**: WHEN Staff run a stock-take with scanned asset tags, the system SHALL report in-stock units confirmed by scan, rented units heard within `devices.stockTakeSeenHours`, every unit confirmed by neither, and unknown tags, and SHALL store the run. [FR-DEV-10]

- **REQ-EVT-13**: WHEN an Org Manager reports a device its organization rents as lost, or Staff report any device in service as lost, the system SHALL move the device to `LOST` from whichever of `IN_INTAKE`, `AVAILABLE`, `RESERVED`, `RENTED`, `RETURNED` or `MAINTENANCE` it was in, open one `LossCase` in `REPORTED` with the reporter, the description and the device's last seen time and position, and notify TrekLink Staff. [FR-DEV-12, BR-37, E05-8]
- **REQ-EVT-14**: WHEN Staff triage a `REPORTED` loss case, the system SHALL ask `rentals` for the custody interval through the `CUSTODY_RESOLVER` port (`custodyAt(deviceId, lastSeenAt)`, design §3) and at the report time (`custodyAt(deviceId, reportedAt)`); it SHALL record the interval of the last seen time only when it is the same rental as the interval at the report time, and otherwise the custody at the report time, which is `TREKLINK` only when no rental holds the device at the report time, so a device last heard outside any rental (only at provisioning, for example) and with a renter at the report time is that renter's `RENTER` custody; a device never heard SHALL be read at the report time alone (D-040, leader rulings 2026-10-31 and 2026-11-01); for `RENTER` custody it SHALL call `ChannelKeyService.markKeyExposed(orgId, at, actor, tx)` of `organizations` in the triage transaction; for a suspected theft or fraud it SHALL call `organizations.openOrLinkComplianceCase`; it SHALL move the case to `SEARCHING` and set `searchEndsAt` to the triage time plus `devices.lossSearchDays`. [FR-DEV-13, D-045, D-046]
- **REQ-EVT-15**: WHEN Staff confirm a `SEARCHING` case, or the `devices.lossSearch` job finds `searchEndsAt` passed, the system SHALL move the case to `CONFIRMED` and, call every `LOSS_CASE_LISTENERS.onConfirmed`, through which `billing` charges the contract for `RENTER` custody. [FR-DEV-15, FR-BILL-05, BR-25]
- **REQ-EVT-16**: WHEN an Admin who did not triage the case settles a `CONFIRMED` case as charged, reduced, waived or written off, the system SHALL record the decision and reason, call every `LOSS_CASE_LISTENERS.onSettled` (`billing` adjusts the loss line, `rentals` sets `lostAt`), move the case to `SETTLED` and the device to `RETIRED`. [FR-DEV-15, FR-BILL-11, BR-39]
- **REQ-EVT-17**: WHEN an Admin disposes of a `RETIRED` device with all three wipe steps done and a method, the system SHALL append a `DeviceDisposal` row and move the device to `DISPOSED`. [FR-DEV-16, BR-42]
- **REQ-EVT-18**: WHEN a device first passes the intake check and its variant has a service interval, the system SHALL set `serviceDueAt` to that date plus the interval; WHEN a `SCHEDULED` record is completed, it SHALL set `serviceDueAt` to the completion date plus the interval; other records SHALL NOT change it. [FR-DEV-17]
- **REQ-EVT-19**: WHEN the `devices.serviceScan` job runs (weekly, design §2.2), the system SHALL select devices with `serviceDueAt` before the run date plus 7 days plus `devices.maintenanceLeadDays`, and devices whose `firmwareVersion` differs from their variant's `firmwareBaseline`; for each `AVAILABLE` one without an open record it SHALL open a `SCHEDULED` record (or `FIRMWARE_UPDATE` when only the firmware differs) with `SYSTEM` as opener and the due date as expected date, and move it to `MAINTENANCE`; it SHALL email TrekLink Staff the list, including due devices that are `RESERVED` or `RENTED`. [FR-DEV-18, BR-45]
- **REQ-EVT-20**: WHEN Staff record an estimate above `devices.maintenanceApprovalThresholdVnd` on an `OPEN` record, the system SHALL set it `PENDING_APPROVAL`, record the estimator and notify the TrekLink Admins. [FR-DEV-20, BR-44]
- **REQ-EVT-21**: WHEN an Admin who did not record the estimate decides a `PENDING_APPROVAL` record, the system SHALL record the decision, the approved amount or the reason, and return the record to `OPEN`. [FR-DEV-20, BR-44]
- **REQ-EVT-22**: WHEN Staff complete an `OPEN` record, the system SHALL require the resolution and the actual cost, a result for every checklist item of the variant for `SCHEDULED`, and a firmware version for `FIRMWARE_UPDATE`; IF the actual cost exceeds the approved amount, or the threshold when nothing was approved, THEN it SHALL set the record `PENDING_APPROVAL` instead; otherwise it SHALL set `COMPLETED` and update the device's `firmwareVersion` when one is given. [FR-DEV-20, FR-DEV-21]
- **REQ-EVT-23**: WHEN Staff read a device, or `rentals` reads the checked-in units of a contract, the system SHALL give the device's next step back to `AVAILABLE`: `RESET` for a `RETURNED` unit with no reset since it became `RETURNED`, `INSPECT` for a `RETURNED` unit reset since then, `COMPLETE_MAINTENANCE` for a `MAINTENANCE` unit with an open record, `INTAKE` for a `MAINTENANCE` unit with none or an `IN_INTAKE` unit, and none otherwise; a reset or inspect step names the contract of the unit's last check-in, whose counter records it. A `PASSED` inspection still moves the unit to `AVAILABLE` with no intake (REQ-EVT-07; leader ruling 2026-11-01 on D-092 rule 4). [D-092 rule 4]

- **REQ-EVT-24**: WHEN Staff dock a unit on the Register panel, the counter SHALL read its `nodeNum`, build environment and reported firmware version, fill the node number, preselect the variant mapped from the build environment and show the reported firmware version beside the firmware field. [FR-DEV-02, D-080]
- **REQ-EVT-25**: WHEN Staff dock a unit for a reserved device at handover or replacement and its `nodeNum` equals the device's, the counter SHALL fetch the derived channel key through the channel-key endpoint (design §8.6 decision 1), write, in one edit transaction, the owner long name as the asset tag, the short name per design §8.6 decision 2 and the primary channel with that key at the organization's current version keeping every other channel setting as read, wait for the unit's one restart, read both back, and record provisioning with the docked `nodeNum` only when the read-back matches. [FR-DEV-05, BR-09, D-021, D-080, D-082]
- **REQ-EVT-26**: WHEN `rentals` records provisioning with a docked `nodeNum`, the system SHALL compare it with the device's `nodeNum` before storing the key version. [FR-DEV-05, D-080]
- **REQ-EVT-27**: WHEN Staff configure a docked unit as a Stage A uplink and its `nodeNum` equals the device's, the counter SHALL write, in one edit transaction, Wi-Fi on with the typed network, the MQTT module with the typed broker and the D-005 transport values (root `treklink`, JSON on, encryption off), and uplink on the primary channel, keep every other field as read, and read the values back after the unit restarts. [D-005, D-080, D-093]
- **REQ-EVT-28**: WHEN Staff flash a unit from an `OPEN` `FIRMWARE_UPDATE` record, the counter SHALL offer only the releases that carry the device's variant, write the chosen image at the manifest offset after the backend has checked its SHA-256, verify every written region, and on a verified write fill the record's firmware version with the release version for completion. [FR-DEV-21, D-093]
- **REQ-EVT-29**: WHEN an Admin creates, edits, deactivates or deletes a hardware variant, the system SHALL apply an edit or a deactivation only as a compare-and-set on the variant's `version`, and SHALL record one audit entry (`hardwareVariant.create`, `.update` or `.delete`) with the values before and after, after commit. [FR-DEV-04, W20A 2026-11-05]
- **REQ-EVT-30**: WHEN Staff run a stock-take, the system SHALL compare the scanned tags, trimmed and upper-cased, with every device not `RETIRED` or `DISPOSED`: a scanned unit counts as confirmed by scan whatever its status, a `RENTED` unit not scanned counts as heard when its `lastSeenAt` is within `devices.stockTakeSeenHours`, every other unit is unconfirmed with its status, and a scanned tag matching no such unit is unknown; the run SHALL be audited (`stockTake.run`) after commit. [FR-DEV-10, REQ-EVT-12, W20A 2026-11-05]

### State-Driven

- **REQ-STA-01**: WHILE a device is not `AVAILABLE`, the system SHALL NOT reserve it. [FR-CON-11, MSG17]
- **REQ-STA-02**: WHILE a variant has registered devices, the system SHALL refuse to delete it or to change its sensor flags. [FR-DEV-04]
- **REQ-STA-03**: WHILE a device is `RESERVED` or `RENTED`, the system SHALL NOT open a maintenance record for it, however overdue its service. [BR-45]
- **REQ-STA-04**: WHILE a maintenance record is `PENDING_APPROVAL`, the system SHALL refuse to complete it. [FR-DEV-20]

### Unwanted Behaviour

- **REQ-ERR-01**: IF an asset tag or `nodeNum` was ever registered, THEN the system SHALL return 409 `CONFLICT_UNIQUE` (MSG10).
- **REQ-ERR-02**: IF an inspection is attempted with no reset logged since the last check-in, THEN the system SHALL return 409 `RESET_REQUIRED`.
- **REQ-ERR-03**: IF a reset leaves any step undone, THEN the system SHALL return 400 `RESET_INCOMPLETE`.
- **REQ-ERR-04**: IF an intake check lacks the motion result for a variant with a motion sensor, THEN the system SHALL return 400 `MOTION_RESULT_REQUIRED`.
- **REQ-ERR-05**: IF a device already has a loss case outside `RECOVERED` and `SETTLED`, THEN the system SHALL return 409 `LOSS_CASE_OPEN`. [BR-37]
- **REQ-ERR-06**: IF the settling Admin triaged the case, THEN the system SHALL return 403 `SEPARATION_OF_DUTY`. [BR-39]
- **REQ-ERR-07**: IF a disposal leaves any wipe step undone, THEN the system SHALL return 400 `WIPE_INCOMPLETE`. [BR-42]
- **REQ-ERR-08**: IF the Admin deciding a maintenance cost recorded its estimate, THEN the system SHALL return 403 `SEPARATION_OF_DUTY`. [BR-44]
- **REQ-ERR-09**: IF a `SCHEDULED` record is completed without a result for every checklist item, THEN 400 `CHECKLIST_INCOMPLETE`; IF a `FIRMWARE_UPDATE` record is completed without a firmware version, THEN 400 `FIRMWARE_VERSION_REQUIRED`. [FR-DEV-21]
- **REQ-ERR-10**: IF work is `VENDOR` without a vendor name, THEN 400 `VENDOR_REQUIRED`; IF a variant has a service interval and no checklist item, THEN 400 `CHECKLIST_REQUIRED`. [D-047]

- **REQ-ERR-11**: IF the browser exposes no Web Serial, THEN the counter SHALL show the Chromium requirement banner and disable docking; intake and handover keep manual entry ("Enter manually").
- **REQ-ERR-12**: IF the docked unit's `nodeNum` differs from the device being provisioned, THEN the counter SHALL write nothing and name the docked node id; a forced provisioning request or channel-key request SHALL get 409 `NODE_MISMATCH` and change nothing.
- **REQ-ERR-13**: IF a write is not acknowledged, the read-back differs, the unit disconnects or stops answering, or the port is busy or refused, THEN the counter SHALL record nothing, say which step failed and that the unit must be docked again before handover.
- **REQ-ERR-14**: IF a docked unit does not answer the config-only handshake within the link's timeout (a v2 unit's known USB gap, design §8.2), THEN the counter SHALL show "No response over USB. v2 units cannot dock yet; enter the node number manually." and leave the manual fields open.
- **REQ-ERR-15**: IF a Stage A uplink write is refused, the unit does not come back after its restart, or the read-back differs, THEN the counter SHALL name the failed check and say the unit is not configured as an uplink. [D-005, D-080]
- **REQ-ERR-16**: IF the chip of the unit on the port does not match the chip of the device's variant in the release manifest, or the node number derived from its MAC address differs from the device's `nodeNum`, THEN the counter SHALL write nothing and name what differs.
- **REQ-ERR-17**: IF the image fails its SHA-256 check (502 `FIRMWARE_IMAGE_INVALID`), the write fails, or a written region does not verify, THEN the counter SHALL record nothing, keep the record `OPEN` and ask Staff to flash again; a v2 unit is flashed again with its power button held.
- **REQ-ERR-18**: IF an Admin saves a variant whose image URL is longer than 500 characters, is neither an `https://` URL with a host nor an app path `/variants/<file>` (no `/` or `..` in the file name, an image extension), or whose spec sheet has an unknown key or a value that is not a string, empty or whitespace only, or longer than 80 characters after trimming, THEN 400 `VARIANT_MEDIA_INVALID` and nothing is saved.
- **REQ-ERR-19**: IF an Admin edits a variant with an `expectedVersion` other than its stored `version`, THEN 409 `STALE_VERSION` and nothing is saved; IF the remaining value schedule is empty, does not start at month 0, has months that do not increase or values that increase with age, THEN 400 `SCHEDULE_INVALID`. [FR-DEV-04, FR-BILL-05]
- **REQ-ERR-19**: IF the organization's channel key is flagged exposed (`channelKeyExposedAt` is set, REQ-EVT-13), THEN the platform SHALL refuse to issue it (rentals api-design 21) and to record it on a unit (api-design 09 and 15) with 409 `CHANNEL_KEY_EXPOSED`, "The organization's channel key is exposed. Rotate it before writing it to a unit.", and nothing is issued, recorded or audited; the rotation (organizations api-design 27) clears the flag and the key of the new version is issued as usual.

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
- **AC-09**: With a 180-day interval and a lead of 5 days, a scan on Monday opens a `SCHEDULED` record for an `AVAILABLE` unit due the following Tuesday (8 days later) and none for a unit due 13 days later. (FR-DEV-18)
- **AC-10**: A `RENTED` unit that falls due is listed by the scan but stays `RENTED`; after check-in and a passed inspection it is `MAINTENANCE` with a `SCHEDULED` record. (E05-12, BR-45)
- **AC-11**: An estimate of 1 800 000 VND against a threshold of 1 000 000 VND leaves the record `PENDING_APPROVAL`; completing it returns 409; the estimating Admin's decision returns 403; another Admin's approval returns it to `OPEN`. (E05-13, BR-44)
- **AC-12**: Completing a `FIRMWARE_UPDATE` record with version `2.7.19-treklink.4` updates the device's `firmwareVersion`, and the next scan does not reopen it. (FR-DEV-21)

- **AC-13**: Docking a unit on the Register panel fills its node number and the variant; registration succeeds without typing either.
- **AC-14**: Docking TL-0043's unit on TL-0042's row writes nothing and records nothing; a forced request returns 409 `NODE_MISMATCH`.
- **AC-15**: After docking at handover the unit restarts once and reads back long name `TL-0042`, the short name `0042` and the organization's key at version n on channel 0 with its other settings unchanged, and the row shows "Provisioned vn".
- **AC-16**: Unplugging the unit between the two writes records nothing and the row asks to dock again; Firefox shows the Chromium banner with docking disabled; after a docking no key is found in browser storage or console output.
- **AC-17**: Docking a v2 unit shows "No response over USB. v2 units cannot dock yet; enter the node number manually." and the manual fields stay open.
- **AC-18**: Configuring TL-0042 as an uplink with network `TrekLink-Field` and broker `192.168.1.10:1883` restarts the unit once; the read-back shows MQTT on, root `treklink`, JSON on, encryption off, the network name, and uplink on channel 0, and its next position appears on the live map.
- **AC-19**: On an `OPEN` `FIRMWARE_UPDATE` record of a v3 unit, Update with release `2.7.26-treklink.2` writes the app image at `0x10000`, the unit keeps its owner names and channel, and the record offers Complete with that version; completing it sets the device's firmware version (AC-12).
- **AC-20**: A v4 image offered to a unit whose chip reads ESP32 writes nothing; a v2 unit whose MAC-derived node number is not the record's device writes nothing; an image whose SHA-256 differs from the manifest answers 502 `FIRMWARE_IMAGE_INVALID` and nothing is written.
- **AC-21**: Saving v4 with `imageUrl` `/variants/treklink-v4.jpg` and `specSheet` `{"mcu": "ESP32-S3"}` shows the photo and the line "MCU ESP32-S3" on its device cards; `imageUrl` `http://example.com/a.jpg`, `/variants/../x.jpg` or `//host/a.jpg`, the key `colour` or the value `"  "` answers 400 `VARIANT_MEDIA_INVALID`.
- **AC-22**: An Admin creates `treklink-v5`, edits its name with the version it read, and a second edit with the old version answers 409 `STALE_VERSION`; deleting it succeeds while no unit is registered, and changing `hasGps` on v3, which has units, answers 409 `VARIANT_IN_USE`.
- **AC-23**: A stock-take scanning `tl-0001` and `TL-9999` counts TL-0001 confirmed by scan, lists `TL-9999` as unknown, lists every other AVAILABLE unit as unconfirmed with its status, and appears first in the past stock-takes with its unconfirmed count.
- **AC-22**: With `channelKeyExposedAt` set on ORG-0007, issuing the key for TL-0042 (api-design 21), provisioning it (09) and replacing a unit (15) each answer 409 `CHANNEL_KEY_EXPOSED` and write nothing; after the rotation to version 2 the same calls succeed with version 2.

---

## 6. Open Questions

None.
