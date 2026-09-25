# Requirements Specification: trips

**User Story**: As an **Operator**, I want to publish trek packages, schedule trips from them, assign Guides without double-booking anyone, and move each trip through a clear lifecycle from preparation to finish; as a **Guide**, I want to see my assigned trips, complete a readiness checklist and start or finish my trip; as a **Customer**, I want to browse packages and open trips before I book.
**Story IDs**: US-023, US-024, US-029, US-037, US-040 (E3) | **Priority**: High | **Main Flows**: MF-01 (browse, guide assignment, preparation), MF-04 (trip in progress is the precondition) | **Lane**: TanNB (`trips`, MF-01 owner)

> **Authority**: D-015, D-016. Clarification answers **Q44 and Q65 to Q73** are **Recorded, not Confirmed**, tagged `[Qnn]`. Q66 left the name of the emergency state open (question 76 of Session 8); this spec uses `EMERGENCY` as a placeholder.

---

## 1. Domain Context & Scope

- **In-Scope**:
  - Trek packages: the sellable product, configurable, with group-size bounds and accepted hardware variants (US-023, US-024) `[Q50, Q70]`
  - Trips: a dated run of a package, created by Staff, optionally requested by a Guide `[Q65]`
  - The **trip lifecycle FSM**, 8 states: `DRAFT, PREPARING, BOOKING_OPEN, READY, IN_PROGRESS, FINISHED, CANCELLED, EMERGENCY` `[Q66]`
  - Guide assignment, many trips per Guide, no overlapping assignments, configurable guides per trip (US-029) `[Q44, Q68]`
  - Participants tracked per trip by booking, by registered customer or by device `[Q69]`
  - Guide readiness checklist `[Q73]`
  - Reschedule and cancel `[Q72]`
  - Seat accounting that `rentals` updates under lock, so a trip is never overbooked
- **Out-of-Scope**:
  - Routes, waypoints, checkpoints and route lines on the map `[Q67]`
  - Prices, owned by `billing`; a package shows a "from" price by calling the quote endpoint
  - Bookings and device allocation, owned by `rentals`
- **Depends on**: `platform`, `auth` (Guides are users), `devices` (accepted variants refer to the variant catalogue).

### Traceability

| Group | MF | UC | FR | BR | Exception | Story |
|---|---|---|---|---|---|---|
| Browse packages and open trips | MF-01 | UC-01 | FR-TRIP-01 (new) | | | US-024 |
| Manage packages | MF-01 | UC-34 Manage Trek Packages (new) | FR-TRIP-02 (new) | | | US-023 |
| Schedule, reschedule, cancel trips | MF-01 | UC-35 Schedule Trip (new) | FR-TRIP-03 (new) | | E01-2 (cascade) | none, gap (C-004) |
| Trip lifecycle | MF-01, MF-04 | UC-35 | FR-TRIP-04 (new) | | | none, gap |
| Assign Guide | MF-01 | UC-06 | FR-BOOK-04, FR-TRIP-05 (new) | BR-02 | E01-4 | US-029 |
| Guide view of own trips | MF-01, MF-04 | UC-14 | FR-AUTH-03 | BR-13 | E04-5 | US-037 |
| Readiness checklist | MF-01 | UC-36 Complete Readiness Checklist (new) | FR-TRIP-06 (new) | | | none, gap |
| Participants | MF-01, MF-04 | | FR-TRIP-07 (new) | | | US-040 |

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL hold every trip in exactly one of `DRAFT`, `PREPARING`, `BOOKING_OPEN`, `READY`, `IN_PROGRESS`, `FINISHED`, `CANCELLED`, `EMERGENCY`, and SHALL change it only through the transition table in `design.md` §2.1. `[Q66]`
- **REQ-UBI-02**: The system SHALL record every trip transition in an append-only history with actor, reason and timestamp.
- **REQ-UBI-03**: The system SHALL keep `seatsTaken ≤ capacity` on every trip at all times, enforced by a row lock during every seat change and by a database check constraint.
- **REQ-UBI-04**: The system SHALL expose to anonymous visitors only packages in `PUBLISHED` and trips in `BOOKING_OPEN`, with no participant, guide contact or device data. [UC-01] `[Q30]`
- **REQ-UBI-05**: The system SHALL scope every Guide read to trips with an active assignment for that Guide, and SHALL provide that scope to `auth` through the `SCOPE_PROVIDER` token. [FR-AUTH-03, BR-13] `[Q44]`

### Event-Driven

- **REQ-EVT-01**: WHEN an Operator creates a trip from a published package with a start, end, capacity and required guide count, the system SHALL create it in `DRAFT`. `[Q65]`
- **REQ-EVT-02**: WHEN a Guide submits a trip request for a package and preferred dates, the system SHALL record it as `OPEN` for Staff to accept into a new `DRAFT` trip or decline with a reason. `[Q65]`
- **REQ-EVT-03**: WHEN an Operator assigns Guides to a trip, the system SHALL verify each is an active Staff account holding `GUIDE`, and SHALL record the assignment with a `LEAD` or `ASSISTANT` role; exactly one `LEAD` SHALL exist once the trip leaves `PREPARING`. [UC-06, US-029]
- **REQ-EVT-04**: WHEN a trip moves to `IN_PROGRESS`, the system SHALL emit `trip.status.changed` after commit, so `rentals` moves the trip's checked-out devices to `IN_FIELD` and `monitoring` starts showing the trip. [MF-04 precondition]
- **REQ-EVT-05**: WHEN a Lead Guide or an Operator finishes a trip, the system SHALL move it to `FINISHED`, record any device ids the Guide reports missing, and emit `trip.status.changed` with those ids, so `rentals` flags the items. `[Q71]` Devices come back through the Guide, never the Customer.
- **REQ-EVT-06**: WHEN an Operator cancels a trip, the system SHALL move it to `CANCELLED` and emit `trip.status.changed`, so `rentals` cancels open bookings **without** a customer cancellation fee and releases allocations. `[Q72]` *(Agency-initiated cancellation is not the customer cancelling; see C-003.)*
- **REQ-EVT-07**: WHEN an Operator reschedules a trip, the system SHALL ask `rentals`, through the `RESCHEDULE_GUARD` token, whether every allocation can move to the new window without overlap, and SHALL apply the new dates and moved allocations in one transaction or reject with the list of conflicts. `[Q72]`
- **REQ-EVT-08**: WHEN a Guide completes the readiness checklist for their trip, the system SHALL store each item's result, the Guide and the time, and mark the check `PASS` only if every mandatory item is checked. `[Q73]`
- **REQ-EVT-09**: WHEN an Operator declares an emergency on an `IN_PROGRESS` trip, the system SHALL move it to `EMERGENCY`, require a note, and emit `trip.status.changed` so every Staff and Admin session is alerted. `[Q66]`

### State-Driven

- **REQ-STA-01**: WHILE a trip is not `BOOKING_OPEN`, the system SHALL reject new Customer bookings for it; `rentals` asks through `TripsService.assertBookable()`.
- **REQ-STA-02**: WHILE a Guide has an active assignment whose trip window overlaps another trip's window, the system SHALL reject assigning that Guide to the other trip with 409 `GUIDE_UNAVAILABLE`, naming the conflicting trip. [E01-4] `[Q44]`
- **REQ-STA-03**: WHILE a trip has fewer assigned Guides than its `requiredGuideCount`, the system SHALL report `guidesSatisfied = false`, and `rentals` SHALL refuse to confirm bookings for it. [BR-02, FR-BOOK-04] `[Q68]`
- **REQ-STA-04**: WHILE `trips.requireReadinessBeforeStart` is true, the system SHALL reject `READY` to `IN_PROGRESS` unless the Lead Guide has a `PASS` readiness check for this trip. `[Q73]`
- **REQ-STA-05**: WHILE a trip is `IN_PROGRESS` or `EMERGENCY`, the system SHALL reject reschedule and capacity reduction.

### Unwanted Behaviour

- **REQ-ERR-01**: IF a transition is not in the table, THEN the system SHALL return 409 `INVALID_STATE_TRANSITION`.
- **REQ-ERR-02**: IF a trip is created with `endAt` not after `startAt`, a capacity below the package's `minGroupSize`, or a `requiredGuideCount` below 1, THEN the system SHALL return 400 `VALIDATION_FAILED`.
- **REQ-ERR-03**: IF a capacity reduction would make `capacity < seatsTaken`, THEN the system SHALL return 409 `CAPACITY_BELOW_BOOKED`.
- **REQ-ERR-04**: IF a reschedule conflicts with another allocation of any device on the trip, THEN the system SHALL return 409 `RESCHEDULE_CONFLICT` listing the devices and the conflicting windows, and SHALL change nothing.
- **REQ-ERR-05**: IF a package in use by a non-terminal trip is archived, THEN the system SHALL allow it and SHALL reject new trips on it with 409 `PACKAGE_NOT_PUBLISHED`.
- **REQ-ERR-06**: IF a seat change would exceed capacity, THEN `TripsService.adjustSeats()` SHALL throw 409 `TRIP_FULL` and the calling booking transaction SHALL roll back.

### Optional Features

- **REQ-OPT-01**: WHERE a package lists accepted hardware variants, the system SHALL expose them on every trip of that package, and `rentals` SHALL allocate only those variants; a package with no list accepts any variant. `[Q50]`

---

## 3. Non-Functional Requirements

| Property | Target | Source |
|---|---|---|
| Overbooking | 0 trips with `seatsTaken > capacity` under 20 concurrent bookings for the last seat | E01-1 analogue for seats |
| Public browse latency | within NFR-PERF-01 without authentication | NFR-PERF-01 |

---

## 4. Configuration Matrix entries

| Parameter | Default | Location | Admin-editable | Source of default |
|---|---|---|---|---|
| `trips.defaultRequiredGuideCount` | 1 | DB | yes | Q68 (configurable), value proposed |
| `trips.readinessChecklist` | JSON list: devices charged, GPS fix on every unit, first-aid kit, weather checked, emergency contacts briefed | DB | yes | Q73, items proposed |
| `trips.requireReadinessBeforeStart` | true | DB | yes | proposal |
| `trips.bookingCloseHoursBeforeStart` | 24 | DB | yes | proposal |

---

## 5. Acceptance Criteria

- **AC-01**: An anonymous `GET /api/trek-packages` returns only `PUBLISHED` packages; `GET /api/trips` returns only `BOOKING_OPEN` trips with `seatsLeft` and no Guide phone numbers.
- **AC-02**: Assigning a Guide already leading an overlapping trip returns 409 `GUIDE_UNAVAILABLE` naming that trip.
- **AC-03**: A trip with `requiredGuideCount = 2` and one Guide reports `guidesSatisfied: false`; `rentals` refuses to confirm its bookings.
- **AC-04**: Moving a trip `READY` to `IN_PROGRESS` without a `PASS` readiness check returns 409; after the Lead Guide submits one, it succeeds and the trip's rented devices become `IN_FIELD`.
- **AC-05**: Every pair of trip states not in the table returns 409 in a test.
- **AC-06**: Cancelling a trip with two confirmed bookings leaves both bookings `CANCELLED` with no cancellation fee and their devices released.
- **AC-07**: Finishing a trip with one device reported missing leaves that rental item flagged missing.
- **AC-08**: Changing `trips.requireReadinessBeforeStart` to false lets a trip start without a check (D-015 demo).

---

## 6. Open Questions

Carried into QUESTION entry C-003: the name of `EMERGENCY` (Session 8 question 76), whether "trip Scheduled" in MF-01 means `READY`, who may start and finish a trip, and whether agency cancellation refunds in full.
