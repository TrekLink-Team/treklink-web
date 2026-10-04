# Requirements Specification: rentals (rental contracts, handover and return)

**User Story**: As an **Org Manager**, I want to request devices by monthly or day plan, collect them at the TrekLink counter, give notice when I am done and return them, so that my organization rents exactly what it needs; and as **TrekLink Staff**, I want every handover and return recorded so that no device is ever double-allocated or lost track of.
**Story ID**: assigned when the backlog is regenerated | **Priority**: High | **Milestone**: MF-01 (request to handover), MF-05 (term end to close)

> **Authority**: Report 3 SRS (2026-10-04) UC-14 to UC-25, UC-43, UC-44, UC-49 to UC-51, UC-55, FR-CON-01 to FR-CON-14, FR-DEV-05, FR-MON-08, BR-01 to BR-09, BR-26, BR-27, BR-33, E01-1 to E01-7, E05-1, E05-2, E05-5, E05-7; D-033 items 4 and 5; D-035 (rental-contract lifecycle); D-037 (on-screen signature); D-038 (lost from `RETURN_DUE`). Rewritten 2026-10-04 (D-036); the booking endpoints of the old suite are retired.

---

## 1. Domain Context & Scope

- **In-Scope**: contract request, approval with reservation, rejection, cancellation; provisioning and
  handover at the counter with the signed note; monthly terms and their rollover; notice; day-plan end;
  holder labels; check-in, inspection orchestration, loss; overdue and default; closing.
- **Out-of-Scope**: prices and invoices (`billing`, called from here); device state rules (`devices`);
  the organization lifecycle (`organizations`); incidents (`incidents`, which reads contracts to route).
- **Depends on**: `platform`, `organizations`, `devices`, `billing`. Declares `CONTRACT_CLOSE_CHECKS`,
  provided by `incidents`; provides `ORGANIZATION_EXIT_CHECKS.canClose`.
- **Owners**: TanNB (MF-01: request to handover), LongLP (MF-05: notice to close).

### Traceability

| This spec | SRS |
|---|---|
| Request, approval, cancellation | UC-15 to UC-18, FR-CON-01 to FR-CON-04, FR-CON-11, BR-01 to BR-04 |
| Handover | UC-14, UC-20, UC-21, FR-CON-05, FR-CON-06, FR-DEV-05, BR-09 |
| Terms, notice, day-plan end | UC-23, UC-24, FR-CON-08 to FR-CON-10, BR-06 to BR-08 |
| Running contract is fixed | FR-CON-07, BR-05 |
| Holder labels | UC-25, FR-CON-14, BR-33 |
| Return | UC-43, UC-44, UC-49, FR-MON-08, D-038 |
| Overdue and default | UC-50, FR-CON-12, BR-26 |
| Closing | UC-51, FR-CON-13, BR-27 |

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL change contract status only through the D-035 lifecycle (design §2), each change one compare-and-set on `version` plus one append-only `ContractTransition` row. [FR-CON-13, D-035]
- **REQ-UBI-02**: The system SHALL commit a device to at most one contract at a time, enforced by the partial unique index on live `ContractDevice` rows. [BR-03]
- **REQ-UBI-03**: The system SHALL reject any change to a running contract's plan, variant or quantity; more devices need an additional contract. [FR-CON-07, BR-05]
- **REQ-UBI-04**: The system SHALL snapshot the monthly unit price, the day premium and the holding-fee ratio when a contract is requested, and SHALL price the whole contract from the snapshot. [FR-CFG-02]
- **REQ-UBI-05**: The system SHALL never alter a signed handover note; its SHA-256 is stored and checked on every download. [FR-CON-06]

### Event-Driven

- **REQ-EVT-01**: WHEN an Org Manager of an `ACTIVE` organization requests a plan with a quantity of at least `rentals.minOrderQuantity`, a configured day-plan length when the plan is `DAY`, an active variant and a start date not in the past, the system SHALL create the contract `REQUESTED` and notify Staff (MSG14). [FR-CON-01, FR-CON-02]
- **REQ-EVT-02**: WHEN Staff approve a `REQUESTED` contract, the system SHALL, in one transaction, reserve exactly the requested number of `AVAILABLE` devices of the variant, create term 1 anchored to the requested start date and issue its invoice through `billing`, set `reservationExpiresAt`, and move the contract to `APPROVED`. [FR-CON-03, FR-CON-11]
- **REQ-EVT-03**: WHEN Staff or the Manager cancel a `REQUESTED` or `APPROVED` contract, the system SHALL release its devices to `AVAILABLE`, have `billing` void the unpaid first-invoice lines while any holding fee paid is retained, and move it to `CANCELLED` (MSG15). [FR-CON-04, E01-7]
- **REQ-EVT-04**: WHEN Staff record provisioning of a reserved device at the organization's current key version, the system SHALL record it through `devices`. [FR-DEV-05]
- **REQ-EVT-05**: WHEN Staff complete a handover with the first payment confirmed, the Manager's identity checked, every device provisioned at the current key version and passing its counter check, and the Manager's drawn signature, the system SHALL stamp the signature into the note, store the PDF and its SHA-256, and move the devices to `RENTED` and the contract to `ACTIVE` in one transaction (MSG06). [FR-CON-05, FR-CON-06, BR-09, D-037]
- **REQ-EVT-06**: WHEN a reserved device fails its counter check, Staff SHALL be able to swap it: it goes to `MAINTENANCE` and another `AVAILABLE` device of the variant is reserved in the same transaction, or the handover is held. [E01-5]
- **REQ-EVT-07**: WHEN a monthly term ends with no notice, the system SHALL close it, have `billing` make its balance due, and open the next term with its invoice; WHEN it ends after notice, the system SHALL move the contract to `RETURN_DUE`. [FR-CON-08, E05-5]
- **REQ-EVT-08**: WHEN an Org Manager gives notice on an `ACTIVE` monthly contract, the system SHALL move it to `ENDING` with `endsAt` at the current term's end (MSG18). [FR-CON-09]
- **REQ-EVT-09**: WHEN a day plan reaches its end, the system SHALL move it to `RETURN_DUE`, and on to `RETURNED` in the same transaction if every device is already back or lost. [FR-CON-10]
- **REQ-EVT-10**: WHEN Staff check a device in, the system SHALL mark the row, move the device to `RETURNED` through `devices`, have `billing` charge late days when the time is past `returnDueAt` plus `rentals.returnGraceHours`, emit `device.checkedIn` so live data stops reaching the organization, and, when the contract is `RETURN_DUE`, `OVERDUE` or `DEFAULTED`, move it to `RETURNED` once every device is checked in or lost; an early return during `ACTIVE` or `ENDING` waits for the end-of-plan job (MSG07). [FR-MON-08, FR-BILL-03]
- **REQ-EVT-11**: WHEN Staff inspect a checked-in device, the system SHALL record the inspection through `devices` and, for `DAMAGED`, have `billing` charge the damage in the same transaction, unless the contract is `CLOSED`. [UC-44, FR-BILL-04]
- **REQ-EVT-12**: WHEN Staff record a device lost on a `RETURN_DUE`, `OVERDUE` or `DEFAULTED` contract, the system SHALL set `lostAt`, move the device to `LOST` and have `billing` charge its remaining value. [UC-49, FR-BILL-05, D-038]
- **REQ-EVT-13**: WHEN a `RETURN_DUE` contract is past `returnDueAt` plus `rentals.returnGraceHours` with devices still out, the system SHALL move it to `OVERDUE`; WHEN `OVERDUE` lasts `rentals.defaultAfterDays`, the system SHALL move it to `DEFAULTED` and suspend the organization through `organizations`. [FR-CON-12, BR-26, E05-1, E05-2]
- **REQ-EVT-14**: WHEN an approved contract passes `reservationExpiresAt`, the system SHALL remind Staff and the Manager once. [FR-CON-04]
- **REQ-EVT-15**: WHEN a member sets a holder label on a handed-over device, the system SHALL store it and emit `device.labelChanged`; WHEN the contract closes, the system SHALL erase every label. [FR-CON-14, BR-33]

### State-Driven

- **REQ-STA-01**: WHILE a contract is `ENDING`, `RETURN_DUE`, `OVERDUE` or `DEFAULTED`, or `ACTIVE` on a day plan, the system SHALL accept check-ins; a running monthly `ACTIVE` contract SHALL NOT, because its quantity cannot change. [BR-05]
- **REQ-STA-02**: WHILE a contract is `RETURN_DUE`, `OVERDUE` or `DEFAULTED`, its devices and incidents SHALL stay visible to the organization and routed to it. [BR-32, E03-9]

### Unwanted Behaviour

- **REQ-ERR-01**: IF fewer `AVAILABLE` devices exist than requested at approval, THEN the system SHALL refuse with 409 `INSUFFICIENT_DEVICES` (MSG11) and reserve nothing. [E01-1]
- **REQ-ERR-02**: IF the quantity is below the minimum or the day length is not configured, THEN the system SHALL return 400 `BELOW_MOQ` (MSG13) or `DAY_PLAN_LENGTH`. [E01-2]
- **REQ-ERR-03**: IF the organization is not `ACTIVE` at request, THEN the system SHALL return 409 `ORGANIZATION_NOT_ACTIVE`. [E01-3]
- **REQ-ERR-04**: IF the handover lacks the first payment, provisioning, a passing check, a battery acknowledgement or a Manager signer, THEN the system SHALL refuse with the matching code (MSG19, MSG23, MSG24) and change nothing. [E01-4]
- **REQ-ERR-05**: IF a close finds an unpaid line, a damage charge pending approval, or an incident outside `CLOSED` reported by `CONTRACT_CLOSE_CHECKS`, THEN the system SHALL return 409 `BALANCE_OUTSTANDING` or `OPEN_INCIDENTS` (MSG29). [FR-CON-13, E05-4, E05-7]
- **REQ-ERR-06**: IF notice is given on a day plan, THEN the system SHALL return 409 `DAY_PLAN_NO_NOTICE`.
- **REQ-ERR-08**: IF a handover is attempted before the requested start date, THEN the system SHALL return 409 `BEFORE_START_DATE`.
- **REQ-ERR-07**: IF a scanned tag is not on the contract, THEN the system SHALL return 409 `DEVICE_NOT_ON_CONTRACT` (MSG12).

---

## 3. Non-Functional Requirements

| Property | Target | Source |
|---|---|---|
| Concurrent approvals | never over-allocated across 50 parallel approvals of one variant | E01-1, TC-03 |
| Handover body | `RENTALS_HANDOVER_BODY_LIMIT`, default `2mb`, for the signature image | REQ-ERR-07 of `platform` |
| Scheduler restart | term rollover and overdue jobs catch up from stored dates after downtime | NFR-AVL-02 |

---

## 4. Configuration

The `rentals` section of the [Configuration Matrix](../platform/configuration-matrix.md). Environment:
`RENTALS_HANDOVER_BODY_LIMIT`, `HANDOVER_NOTE_STORAGE_DIR`.

---

## 5. Acceptance Criteria

- **AC-01**: Two Staff approve two contracts for the last 5 v3 devices at once; one succeeds, the other gets 409 and reserves nothing. (TC-03)
- **AC-02**: A handover without the confirmed holding fee returns 409 `FIRST_PAYMENT_MISSING` and the contract stays `APPROVED`. (TC-09)
- **AC-03**: A monthly contract with no notice rolls into term 2 with the term-1 balance and the term-2 holding fee due together. (TC-08, E05-5)
- **AC-04**: Devices back 3 days after the grace: contract `OVERDUE` and a late line of 3 days per late device. (TC-23)
- **AC-05**: `OVERDUE` for `rentals.defaultAfterDays`: `DEFAULTED` and the organization `SUSPENDED`. (TC-26)
- **AC-06**: Closing with an open incident on one device returns 409 `OPEN_INCIDENTS`. (TC-27)
- **AC-07**: After closing, every holder label is null. (TC-33)

---

## 6. Open Questions

None.
