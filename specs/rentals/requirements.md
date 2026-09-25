# Requirements Specification: rentals

**User Story**: As a **Customer**, I want to book a trip, hold a device while I pay, and know at once if the last unit went to someone else; as an **Operator**, I want to confirm bookings only when devices and Guides are really available, hand devices to the Guide against a signed agreement, and take them back through an inspection that feeds billing and maintenance; as a **Guide**, I want to check each device at handover and refuse a faulty one on the spot.
**Story IDs**: US-025 to US-028, US-030 to US-034, US-039 (E3) | **Priority**: High | **Main Flows**: **MF-01** (booking to check-out), **MF-05** (check-in, inspection, close) | **Lane**: LongLP (`rentals`), MF-01 owner TanNB, MF-05 owner LongLP

> **Authority**: D-015, D-016, D-021 (PSK check at check-out, via `devices`). Clarification answers **Q53, Q55 to Q64, Q71** are **Recorded, not Confirmed**, tagged `[Qnn]`. Two conflicts inside the SSOT are resolved here by proposal and listed in C-002: MF-01's swimlane puts "Reserve device" after Staff confirmation while its main-path text and E01-1 put it before; and Q60 implies payment into escrow at booking while MF-05 settles money at return.

---

## 1. Domain Context & Scope

- **In-Scope**:
  - **Bookings** with a 6-state lifecycle `PENDING, CONFIRMED, COMPLETED, CANCELLED, REJECTED, EXPIRED`, three channels (Customer self-service, Guide on behalf of a group, Staff) `[Q55, Q56, Q57]`
  - **Device reservation holds** with a Customer hold timer, row-level locking and a database exclusion constraint, so a device is never allocated twice for overlapping time `[Q53, Q58, Q59]`
  - **Rentals** with a 7-state lifecycle `DRAFT, READY, CHECKED_OUT, OVERDUE, RETURNED, CLOSED, CANCELLED`, created from a confirmed booking or directly by Staff or a Guide for an unauthenticated customer `[Q55]`
  - Rental items (one per device), allocation of specific devices and replacement of a rejected one (UC-05, E01-3)
  - **Rental agreement**: generated PDF, draw-on-web signature embedded into a signed PDF, both hashed and audited `[Q62]`
  - Check-out (UC-08), Guide handover check (US-033), check-in (UC-09), return inspection (UC-10), loss declaration (E05-3)
  - Hand-off of settlement facts to `billing` and closing the rental when billing reports the balance settled (UC-11, UC-12, BR-19) `[Q64]`
  - Moving devices into the field when their trip starts, and flagging devices a Guide reports missing at trip end `[Q71]`
- **Out-of-Scope**:
  - Prices, fees, invoices, payments and refunds: `billing` computes and settles; `rentals` calls it `[Q64]`
  - The device state machine: `rentals` asks `devices` to transition; it never writes `Device.status`
  - Legal e-signature with a certificate authority `[Q62]`
- **Depends on**: `platform`, `auth`, `devices`, `trips`, `billing`.

### Traceability

| Group | MF | UC | FR | BR | Exception | Story |
|---|---|---|---|---|---|---|
| Submit booking | MF-01 | UC-02 | FR-BOOK-01 (new) | | | US-025 |
| Reserve device, hold | MF-01 | UC-03, UC-22 | FR-BOOK-02 | BR-01 | E01-1, E01-5 | US-026 |
| Confirm or reject booking | MF-01 | UC-04 | FR-BOOK-04 | BR-02 | E01-4 | US-027 |
| Cancel booking | MF-01 | UC-37 Cancel Booking (new) | FR-BOOK-07 | BR-03 | E01-2 | none, gap (C-003) |
| Allocate device | MF-01 | UC-05 | FR-RENT-01 (new) | BR-01 | E01-3 | US-028 |
| Rental agreement | MF-01 | UC-07 | FR-RENT-02 (new) | | | US-030 |
| Check out | MF-01 | UC-08 | FR-RENT-03 (new), FR-DEV-05 | BR-04 | | US-032 |
| Handover check | MF-01 | UC-38 Confirm Device Handover (new) | FR-RENT-04 (new) | BR-04 | E01-3 | US-033 |
| Check in | MF-05 | UC-09 | FR-RENT-05 (new) | | E05-1 | US-034 |
| Inspect | MF-05 | UC-10 | FR-RENT-06 (new) | | E05-2, E05-6 | US-019 (devices) |
| Loss | MF-05 | UC-33 | FR-DEV-09 | BR-22 | E05-3 | US-020 (devices) |
| Close | MF-05 | UC-11, UC-12 | FR-BILL-05 | BR-19 | E05-4 | US-031, US-039 |

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL never allocate one device to two active allocations whose time windows overlap. The rule SHALL be enforced by a Postgres exclusion constraint on `(deviceId, window)` over allocations in `HELD`, `CONFIRMED` or `CHECKED_OUT`, in addition to the service check. [BR-01, FR-BOOK-02, Q53]
- **REQ-UBI-02**: The system SHALL compute an allocation window as the trip window widened by `rentals.allocationLeadHours` before and `rentals.allocationTrailHours` after, so a device is not promised to the next trip while it is still being checked in from the previous one. `[Q53]`
- **REQ-UBI-03**: The system SHALL hold every booking and every rental in exactly one state of its lifecycle (`design.md` §2.1, §2.2) and SHALL change it only through the transition table, recording every transition with actor and timestamp.
- **REQ-UBI-04**: The system SHALL change a device's lifecycle state only by calling `DevicesService.transition()` inside the same transaction as the rentals change that causes it.
- **REQ-UBI-05**: The system SHALL call `billing` for every amount (quote, escrow, cancellation fee, settlement) and SHALL store no price, fee or balance of its own. `[Q64]`
- **REQ-UBI-06**: The system SHALL keep each generated and each signed agreement PDF immutable, identified by its SHA-256, and SHALL create a new version rather than overwrite. `[Q62]`

### Event-Driven: booking (MF-01 steps 1 to 4)

- **REQ-EVT-01**: WHEN a Customer submits a booking for a `BOOKING_OPEN` trip with a group size within the package bounds and a device count of at most `rentals.maxDevicesPerCustomerBooking`, the system SHALL create it `PENDING`, add the group to the trip's seats in the same transaction, and create one trip participant per named traveller. [UC-02, US-025, E01-5 dates validated] `[Q57]`
- **REQ-EVT-02**: WHEN a Guide or Staff member submits a booking on behalf of a group, the system SHALL accept up to `rentals.maxDevicesPerStaffBooking` devices, record the channel and the acting user, and let the renter be an existing Customer account or a named, unauthenticated person. `[Q55, Q57]`
- **REQ-EVT-03**: WHEN a reservation is requested for a `PENDING` booking, the system SHALL, in one transaction, lock candidate devices of accepted variants with no overlapping active allocation (`FOR UPDATE SKIP LOCKED`), create `HELD` allocations for the requested count, set their expiry to now plus `rentals.customerHoldMinutes` for the Customer channel, and ask `devices` to move each `AVAILABLE` unit to `RESERVED`. [UC-03, MF-01 step 3] `[Q58, Q59]`
- **REQ-EVT-04**: WHEN a Customer-channel booking's escrow payment succeeds in `billing` within the hold, the system SHALL turn its `HELD` allocations into `CONFIRMED` allocations with no expiry. `[Q60]` *(Proposal for how the hold "invalidates": unpaid holds expire, paid holds persist until Staff review. C-002.)*
- **REQ-EVT-05**: WHEN a hold expires unpaid, the system SHALL release its allocations, return devices with no other future allocation to `AVAILABLE`, and leave the booking `PENDING` with no device attached, so the Customer may reserve again. [E01-1 wording] `[Q59]`
- **REQ-EVT-06**: WHEN an Operator confirms a booking, the system SHALL require that its allocations cover the requested device count and are `CONFIRMED` (or `HELD` with the hold disabled, for Staff and Guide channels), that the trip reports `guidesSatisfied`, and SHALL then move the booking to `CONFIRMED`, create its rental in `DRAFT` with one item per allocation, and notify the Customer. [UC-04, BR-02, FR-BOOK-04, MF-01 step 4]
- **REQ-EVT-07**: WHEN an Operator rejects a `PENDING` booking with a reason, the system SHALL move it to `REJECTED`, release its allocations and seats, and ask `billing` to refund any escrow in full.
- **REQ-EVT-08**: WHEN a Customer cancels their own booking, or Staff cancels one on their behalf, before check-out, the system SHALL move it to `CANCELLED`, cancel its `DRAFT` or `READY` rental, release allocations and seats, and ask `billing` to refund the escrow minus the cancellation fee computed by `billing` from the time since payment. [E01-2, BR-03, FR-BOOK-07] `[Q60]`
- **REQ-EVT-09**: WHEN Staff extends or disables a hold, or transfers a Customer booking to a Guide's provisioning, the system SHALL record the actor and reason and apply the new expiry or channel. `[Q59]`

### Event-Driven: rental preparation and check-out (MF-01 steps 5 to 8)

- **REQ-EVT-10**: WHEN Staff creates a rental directly (no booking) for a trip, the system SHALL create it in `DRAFT` with a named renter, a custodian Guide assigned to that trip, and the requested devices allocated under REQ-EVT-03's locking without a hold expiry. [Q55]
- **REQ-EVT-11**: WHEN Staff allocates or replaces a specific device on a rental item, the system SHALL release the old allocation, create a `CONFIRMED` allocation for the new device over the same window, and refuse a device of a variant the trip does not accept. [UC-05, US-028, E01-3] `[Q50]`
- **REQ-EVT-12**: WHEN Staff generates the rental agreement, the system SHALL render a PDF containing the renter, custodian Guide, trip, devices by asset tag, deposit per device from `billing`, the terms text of `rentals.agreementTerms`, and a version number, store it with its SHA-256, and audit it. [UC-07, US-030] `[Q62]`
- **REQ-EVT-13**: WHEN a renter signs the agreement by drawing on the web page, the system SHALL embed the signature image, signer name and UTC time into a new signed PDF version, store it with its SHA-256, mark the agreement `SIGNED`, and move the rental `DRAFT` to `READY` if every item is allocated. `[Q62]`
- **REQ-EVT-14**: WHEN Staff checks out a `READY` rental, the system SHALL, for each item, ask `devices` to assert check-out eligibility (state `RESERVED`, PSK version current) and move the device to `RENTED`, mark allocations `CHECKED_OUT`, set `checkedOutAt` and the custodian Guide, and move the rental to `CHECKED_OUT`, all in one transaction. [UC-08, US-032, MF-01 steps 6 and 7, D-021]
- **REQ-EVT-15**: WHEN the custodian Guide submits a handover check with a manually verified battery percentage and GPS-fix result, the system SHALL record it and, IF the battery is below `devices.minHandoverBatteryPct` or GPS has no fix, mark the item `HANDOVER_REJECTED`, move the device to `MAINTENANCE` with a maintenance record, and flag the rental for a replacement without touching the booking. [US-033, E01-3, BR-04, FR-DEV-05] `[Q52]`

### Event-Driven: field phase and return (MF-05)

- **REQ-EVT-16**: WHEN `trip.status.changed` reports `IN_PROGRESS`, the system SHALL move every `CHECKED_OUT` item's device `RENTED` to `IN_FIELD`. The handler SHALL be idempotent and retried on failure. `[Q48]`
- **REQ-EVT-17**: WHEN `trip.status.changed` reports `FINISHED` with missing device ids, the system SHALL mark those items `MISSING_REPORTED`. `[Q71]`
- **REQ-EVT-18**: WHEN Staff checks in an item, the system SHALL record `returnedAt` and the receiving Staff member, move the device to `RETURNED`, end the allocation, and, WHEN every item of the rental is returned or lost, move the rental to `RETURNED`. [UC-09, US-034, MF-05 step 1]
- **REQ-EVT-19**: WHEN Staff records a return inspection for a returned item, the system SHALL store condition, accessories, battery, damage notes and evidence references, and ask `devices` to move the unit to `AVAILABLE` (then `RESERVED` if allocated ahead) if serviceable or to `MAINTENANCE` with a maintenance record if not. [UC-10, MF-05 steps 2 and 6, E05-2, E05-6]
- **REQ-EVT-20**: WHEN Staff confirms an item lost, the system SHALL mark it `LOST`, ask `devices` to retire the unit with reason `LOST`, and count the item as returned for the rental's completeness. [E05-3, BR-22, FR-DEV-09]
- **REQ-EVT-21**: WHEN Staff requests settlement of a `RETURNED` rental, the system SHALL send `billing` the settlement facts (items, conditions, inspections, due and returned times, losses, whether the base fee was prepaid) and return the invoice `billing` produces. [UC-11, MF-05 step 3]
- **REQ-EVT-22**: WHEN Staff closes a `RETURNED` rental and `billing` reports its settlement invoice fully settled, the system SHALL move it to `CLOSED` and the booking to `COMPLETED`. [MF-05 step 5, BR-19]

### State-Driven

- **REQ-STA-01**: WHILE a rental is `CHECKED_OUT` past its `dueAt` plus `billing.lateGraceHours`, the scheduler SHALL move it to `OVERDUE`. [E05-1]
- **REQ-STA-02**: WHILE a rental is `OVERDUE` longer than `rentals.nonReturnGraceDays`, the system SHALL flag its unreturned items `LOSS_SUSPECTED` and alert Staff, and SHALL NOT retire devices without a Staff confirmation. [E05-3] *(Proposal; the SSOT wording implies automatic retirement. C-002.)*
- **REQ-STA-03**: WHILE `rentals.requireSignedAgreementForCheckout` is true, the system SHALL reject check-out of a rental without a `SIGNED` agreement. [UC-08 includes UC-07]
- **REQ-STA-04**: WHILE a booking is not `PENDING`, the system SHALL reject new reservations for it.
- **REQ-STA-05**: WHILE a rental's settlement invoice has a non-zero balance, the system SHALL reject closing it with 409 `BALANCE_OUTSTANDING`, and the balance SHALL stay visible to Staff and the Customer. [E05-4, BR-19]

### Unwanted Behaviour

- **REQ-ERR-01**: IF fewer allocatable devices exist than the reservation requests, including when a concurrent request took the last one, THEN the system SHALL create no allocation, return 409 `DEVICE_NOT_AVAILABLE` with the available count, and leave the booking `PENDING` with no device attached. Never oversell. [E01-1]
- **REQ-ERR-02**: IF an allocation insert violates the exclusion constraint despite the lock (a race between the exclusion read and the insert), THEN the system SHALL retry the reservation up to `rentals.reservationRetryLimit` times before answering `DEVICE_NOT_AVAILABLE`.
- **REQ-ERR-03**: IF a booking's dates overlap an existing allocation of a specifically requested device, THEN the system SHALL reject it with 409 `ALLOCATION_CONFLICT` naming the conflicting rental or booking. [E01-5]
- **REQ-ERR-04**: IF confirmation is attempted while the trip lacks its required Guides, THEN the system SHALL return 409 `GUIDES_NOT_SATISFIED` before any state change, so the conflict is seen before confirmation. [E01-4, BR-02]
- **REQ-ERR-05**: IF confirmation is attempted while allocations do not cover the device count or are unpaid holds on the Customer channel, THEN the system SHALL return 409 `RESERVATION_INCOMPLETE`.
- **REQ-ERR-06**: IF check-out finds any item's device not eligible (not `RESERVED`, PSK not current), THEN the system SHALL check out nothing and return 409 naming each blocking item (`PSK_NOT_CURRENT`, `DEVICE_NOT_RESERVED`).
- **REQ-ERR-07**: IF a cancellation is attempted after check-out, THEN the system SHALL return 409 `CANCEL_AFTER_CHECKOUT`; the path from then on is check-in and settlement.
- **REQ-ERR-08**: IF `billing` fails during cancellation refund or settlement, THEN the booking or rental SHALL keep its prior state and the error SHALL be returned; no partial state is written. [E05-4]
- **REQ-ERR-09**: IF a Guide submits a handover check for an item not in their custody, THEN the system SHALL return 404 `NOT_FOUND`.
- **REQ-ERR-10**: IF a device is checked in that belongs to no open rental item, THEN the system SHALL return 409 `NOT_CHECKED_OUT`.

### Optional Features

- **REQ-OPT-01**: WHERE `rentals.requireEscrowBeforeReview` is false, Customer-channel bookings SHALL be confirmable with unpaid holds, and payment SHALL happen at settlement only. This is the switch between the two readings of Q60 and MF-05 described at the top of this file.

---

## 3. Non-Functional Requirements

| Property | Target | Source |
|---|---|---|
| Oversell | 0 double allocations in a test of 20 concurrent reservations for the last device | E01-1, NFR-PERF-02 analogue |
| Check-out atomicity | all items or none | REQ-EVT-14 |
| Booking flow UX | at most 4 steps, 6 fields per step | NFR-USE-01, US-025 AC 3 |

---

## 4. Configuration Matrix entries

| Parameter | Default | Location | Admin-editable | Source of default |
|---|---|---|---|---|
| `rentals.customerHoldMinutes` | 10 | DB | yes | Q59 |
| `rentals.maxDevicesPerCustomerBooking` | 1 | DB | yes | Q57 |
| `rentals.maxDevicesPerStaffBooking` | 20 | DB | yes | proposal |
| `rentals.allocationLeadHours` | 12 | DB | yes | proposal |
| `rentals.allocationTrailHours` | 24 | DB | yes | proposal |
| `rentals.nonReturnGraceDays` | 3 | DB | yes | proposal (E05-3 names a grace period, no value) |
| `rentals.reservationRetryLimit` | 3 | DB | yes | proposal |
| `rentals.requireSignedAgreementForCheckout` | true | DB | yes | UC-08 includes UC-07 |
| `rentals.requireEscrowBeforeReview` | true | DB | yes | Q60 reading |
| `rentals.agreementTerms` | JSON `{ version, text }` | DB | yes | Q62 |

Cancellation fee, free-cancellation window, late grace and fee rates are `billing` parameters.

---

## 5. Acceptance Criteria

- **AC-01**: Two Customers reserve the last available device concurrently (20 parallel attempts in the test): exactly one gets a `HELD` allocation; every other receives 409 `DEVICE_NOT_AVAILABLE`; their bookings stay `PENDING` with no device.
- **AC-02**: A hold left unpaid for `rentals.customerHoldMinutes` expires; the device returns to `AVAILABLE`; changing the parameter to 15 changes the next hold's expiry (D-015 demo).
- **AC-03**: Confirming a booking on a trip missing a Guide returns 409 `GUIDES_NOT_SATISFIED` and changes nothing.
- **AC-04**: Cancelling a confirmed booking before check-out releases the device and triggers a refund with the fee `billing` computes.
- **AC-05**: A Guide's handover check at 35 % battery rejects the item, moves the device to `MAINTENANCE`, and Staff replaces it on the same rental with the booking untouched.
- **AC-06**: Check-out with one of three devices on an old PSK version checks out none and names the blocking device.
- **AC-07**: Starting the trip moves all three devices to `IN_FIELD`; checking them in moves the rental to `RETURNED` only after the third.
- **AC-08**: An inspection with condition `MAJOR_DAMAGE` sends the device to `MAINTENANCE` and the settlement invoice carries an itemised damage line.
- **AC-09**: Closing a rental whose invoice has a balance returns 409 `BALANCE_OUTSTANDING`; after payment it closes and the booking becomes `COMPLETED`.
- **AC-10**: A device allocated for trip A (10 to 12 Oct) can be allocated for trip B (20 to 22 Oct) while out on A; after A's check-in and a serviceable inspection it becomes `RESERVED`, not `AVAILABLE`.

---

## 6. Open Questions

Carried into QUESTION entry C-002: payment timing (escrow at booking or settlement only), reserve-before-confirm ordering, how a hold "invalidates", Staff-confirmed versus automatic loss, agreement PDF storage, and serving the agreement PDF inside the envelope as base64.
