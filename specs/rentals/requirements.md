# Requirements Specification: rentals (rental contracts, handover and return)

**User Story**: As an **Org Manager**, I want to request devices by monthly or day plan, collect them at the TrekLink counter, give notice when I am done and return them, so that my organization rents exactly what it needs; and as **TrekLink Staff**, I want every handover and return recorded so that no device is ever double-allocated or lost track of.
**Story ID**: the Stories row of `tasks.md` (backlog D-051) | **Priority**: High | **Milestone**: MF-01 (request to handover), MF-05 (term end to close)

> **Authority**: Report 3 SRS (2026-10-14; traceability checked 2026-10-19) UC-14 to UC-25, UC-43, UC-44, UC-49 to UC-51, UC-55, FR-CON-01 to FR-CON-14, FR-DEV-05, FR-MON-08, BR-01 to BR-09, BR-26, BR-27, BR-33, E01-1 to E01-7, E05-1, E05-2, E05-5, E05-7; D-033 items 4 and 5; D-035 (rental-contract lifecycle); D-037 (on-screen signature); D-045 (loss cases, replacement on a running contract; supersedes D-038 rule 3); D-092 rule 1 (availability and a hold at request, supervisor feedback of 2026-11-01); Report 3 register v2 of 2026-10-29 UC-66 to UC-69, FR-CON-16 to FR-CON-19, BR-46, E04-8, MSG40, MSG41 (device groups and fault reports, BM04 F-11 and F-21, required fix RF-21, treklink-web#305); D-097 (End now with the current term billed pro rata, leader ruling 2026-11-05 in treklink-docs#173). Rewritten 2026-10-04 (D-036); the booking endpoints of the old suite are retired.

---

## 1. Domain Context & Scope

- **In-Scope**: contract request, approval with reservation, rejection, cancellation; provisioning and
  handover at the counter with the signed note; monthly terms and their rollover; notice; day-plan end;
  holder labels; check-in, inspection orchestration, loss; overdue and default; closing; the
  organization's device groups and their assignments; fault reports on rented devices (design §11).
- **Out-of-Scope**: prices and invoices (`billing`, called from here); device state rules (`devices`); the
  rented-device console and the group filters of the live map (`monitoring` REQ-EVT-09, REQ-UBI-05);
  the organization lifecycle (`organizations`); incidents (`incidents`, which reads contracts to route).
- **Depends on**: `platform`, `organizations`, `devices`, `billing`. Declares `CONTRACT_CLOSE_CHECKS`,
  provided by `incidents`; provides `ORGANIZATION_EXIT_CHECKS.canClose`.
- **Owner**: LongLP (roadmap §5.1, remapped 2026-10-18).

### Traceability

| This spec | SRS |
|---|---|
| Request, approval, cancellation | UC-15 to UC-18, FR-CON-01 to FR-CON-04, FR-CON-11, BR-01 to BR-04 |
| Handover | UC-14, UC-20, UC-21, FR-CON-05, FR-CON-06, FR-DEV-05, BR-09 |
| Terms, notice, day-plan end | UC-23, UC-24, FR-CON-08 to FR-CON-10, BR-06 to BR-08 |
| Running contract is fixed | FR-CON-07, BR-05 |
| Holder labels | UC-25, FR-CON-14, BR-33, NFR-LEG-02 |
| Return | UC-43, UC-44, FR-MON-08 |
| Custody for loss cases | UC-60, FR-DEV-13, D-040, D-045 |
| Replacement on a running contract | UC-61, FR-CON-15, BR-41, E05-8 |
| Overdue and default | UC-50, FR-CON-12, BR-26 |
| End now (early end) | D-097, UC-23 extended, FR-CON-09 |
| Closing | UC-51, FR-CON-13, BR-27 |
| Device groups | UC-67, UC-68, FR-CON-17, FR-CON-18, BR-46, E04-8 |
| Fault reports | UC-69, FR-CON-19 |

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL change contract status only through the D-035 lifecycle (design §2), each change one compare-and-set on `version` plus one append-only `ContractTransition` row. [FR-CON-13, D-035]
- **REQ-UBI-02**: The system SHALL commit a device to at most one contract at a time, enforced by the partial unique index on live `ContractDevice` rows. [BR-03]
- **REQ-UBI-03**: The system SHALL reject any change to a running contract's plan, variant or quantity; more devices need an additional contract. [FR-CON-07, BR-05]
- **REQ-UBI-04**: The system SHALL snapshot the monthly unit price, the day premium and the holding-fee ratio when a contract is requested, and SHALL price the whole contract from the snapshot. [FR-CFG-02]
- **REQ-UBI-05**: The system SHALL never alter a signed handover note; its SHA-256 is stored and checked on every download. [FR-CON-06]
- **REQ-UBI-06**: The system SHALL keep each device in at most one group at a time, enforced by a partial unique index on the `GroupAssignment` rows with no `endedAt`, and SHALL let a group hold only devices its organization holds now: a live `ContractDevice` row of one of the organization's contracts, handed over, neither checked in nor lost. A group and its parent belong to the same organization. [BR-46, FR-CON-18]
- **REQ-UBI-07**: The system SHALL serve an organization's groups, assignments and fault reports to that organization's members and to TrekLink Staff only; any other caller naming one of them gets 404 (MSG26), the same answer as for an identifier that does not exist; a device of another organization named in an assignment gets 409 `DEVICE_NOT_HELD`, the same answer as for a device the organization no longer holds (REQ-ERR-14), so neither answer tells one organization what another holds. Holder labels stay on the contract row (REQ-EVT-15) and follow the same rule. [BR-19, NFR-LEG-02, D-040]

### Event-Driven

- **REQ-EVT-01**: WHEN an Org Manager of an `ACTIVE` organization requests a plan with a quantity of at least `rentals.minOrderQuantity`, a configured day-plan length when the plan is `DAY`, an active variant and a start date not in the past, the system SHALL, in one transaction, create the contract `REQUESTED`, hold exactly the requested number of `AVAILABLE` devices of the variant (moved to `RESERVED`, one live `ContractDevice` row each), create term 1 anchored to the requested start date, issue its invoice through `billing` (the holding fee, or the day-plan fee, is the deposit), and set `holdExpiresAt` to the request time plus `rentals.requestHoldHours`; after commit it SHALL notify Staff (MSG14). [FR-CON-01, FR-CON-02, D-092 rule 1]
- **REQ-EVT-02**: WHEN Staff approve a `REQUESTED` contract, the system SHALL, in one transaction, keep the devices the request holds, or, for a contract requested before D-092 that holds none, reserve exactly the requested number of `AVAILABLE` devices of the variant, create term 1 and issue its invoice; set `reservationExpiresAt` from the handover appointment; and move the contract to `APPROVED`. [FR-CON-03, FR-CON-11, D-092 rule 1]
- **REQ-EVT-03**: WHEN Staff or the Manager cancel a `REQUESTED` or `APPROVED` contract, the system SHALL release its devices to `AVAILABLE`, have `billing` void the unpaid first-invoice lines while any holding fee paid is retained, and move it to `CANCELLED` (MSG15). WHEN Staff reject a `REQUESTED` contract, the system SHALL release the devices it holds and have `billing` void the unpaid first-invoice lines in the same transaction; a deposit already paid is reported as `paidVnd` and refunded outside TrekLink (leader ruling 2026-11-01). [FR-CON-04, E01-7, D-092 rule 1]
- **REQ-EVT-04**: WHEN Staff record provisioning of a reserved device at the organization's current key version, the system SHALL record it through `devices`. [FR-DEV-05]
- **REQ-EVT-05**: WHEN Staff complete a handover with the first payment confirmed, the Manager's identity checked, every device provisioned at the current key version and passing its counter check, and the Manager's drawn signature, the system SHALL stamp the signature into the note, store the PDF and its SHA-256, and move the devices to `RENTED` and the contract to `ACTIVE` in one transaction (MSG06). [FR-CON-05, FR-CON-06, BR-09, D-037]
- **REQ-EVT-06**: WHEN a reserved device fails its counter check, Staff SHALL be able to swap it: it goes to `MAINTENANCE` and another `AVAILABLE` device of the variant is reserved in the same transaction, or the handover is held. [E01-5]
- **REQ-EVT-07**: WHEN a monthly term ends with no notice, the system SHALL close it, have `billing` make its balance due, and open the next term with its invoice; WHEN it ends after notice, the system SHALL move the contract to `RETURN_DUE`. [FR-CON-08, E05-5]
- **REQ-EVT-08**: WHEN an Org Manager gives notice on an `ACTIVE` monthly contract, the system SHALL move it to `ENDING` with `endsAt` at the current term's end (MSG18). [FR-CON-09]
- **REQ-EVT-09**: WHEN a day plan reaches its end, the system SHALL move it to `RETURN_DUE`, and on to `RETURNED` in the same transaction if every device is already back or lost. [FR-CON-10]
- **REQ-EVT-10**: WHEN Staff check a device in, the system SHALL mark the row, move the device to `RETURNED` through `devices`, have `billing` charge late days when the time is past `returnDueAt` plus `rentals.returnGraceHours`, emit `device.checkedIn` so live data stops reaching the organization, and, when the contract is `RETURN_DUE`, `OVERDUE` or `DEFAULTED`, move it to `RETURNED` once every device is checked in or lost; an early return during `ACTIVE` or `ENDING` waits for the end-of-plan job, or for End now (REQ-EVT-27), which moves the contract to `RETURN_DUE` at once so the same check-ins then return it (MSG07). [FR-MON-08, FR-BILL-03, D-097]
- **REQ-EVT-11**: WHEN Staff inspect a checked-in device, the system SHALL record the inspection through `devices` and, for `DAMAGED`, have `billing` charge the damage in the same transaction, unless the contract is `CLOSED`. [UC-44, FR-BILL-04]
- **REQ-EVT-12**: WHEN `devices` settles a loss case for a device on one of the contract's rows, the system SHALL set that row's `lostAt` to the case's confirmation time, which closes the custody interval and counts the device as back for closing, and SHALL move a `RETURN_DUE`, `OVERDUE` or `DEFAULTED` contract to `RETURNED` in the same transaction when no device is left out (design §2); WHEN Staff replace a faulty or lost unit on an `ACTIVE` or `ENDING` contract, the system SHALL check in the faulty unit if present, reserve and provision an `AVAILABLE` unit of the same variant, store the signed replacement note with its SHA-256, insert a `ContractDevice` row with `replacesId` and `handedOverAt`, and move the unit to `RENTED`, leaving plan, variant and quantity unchanged. [FR-CON-13, FR-CON-15, BR-05, BR-41]
- **REQ-EVT-13**: WHEN a `RETURN_DUE` contract is past `returnDueAt` plus `rentals.returnGraceHours` with devices still out, the system SHALL move it to `OVERDUE`; WHEN `OVERDUE` lasts `rentals.defaultAfterDays`, the system SHALL move it to `DEFAULTED` and suspend the organization through `organizations`. [FR-CON-12, BR-26, E05-1, E05-2]
- **REQ-EVT-14**: WHEN an approved contract passes `reservationExpiresAt`, the system SHALL remind Staff and the Manager once. [FR-CON-04]
- **REQ-EVT-15**: WHEN a member sets a holder label on a handed-over device, the system SHALL store it and emit `device.labelChanged`; WHEN the contract closes, the system SHALL erase every label. [FR-CON-14, BR-33]
- **REQ-EVT-16**: WHEN Staff undo the provisioning record of a `RESERVED` device on an `APPROVED` contract before the handover, with the contract `version` they saw, the system SHALL, in one transaction, clear the unit's key version, key organization and provisioning time through `devices`, keep its `DeviceProvisioning` row, and increase the contract `version`; after commit it SHALL record the audit entry `contract.provisioningUndone`. The counter drops that unit's battery and GPS readings, which live only on the page. [FR-DEV-05, UC-14, dry run 2026-10-30 defect 5]
- **REQ-EVT-17**: WHEN a `REQUESTED` contract passes `holdExpiresAt` with its first payment (the holding fee, or the day-plan fee) not paid in full, the `rentals.requestHoldExpiry` job SHALL, in one transaction, release its devices to `AVAILABLE`, have `billing` void the unpaid first-invoice lines, and move it to `CANCELLED` as `SYSTEM` with the reason `HOLD_EXPIRED`. A paid deposit keeps the hold until Staff decide. [D-092 rule 1, leader ruling 2026-11-01]
- **REQ-EVT-18**: WHEN Staff read the close check of a contract, the system SHALL answer whether it can close now and list every blocker, each with what resolves it: the contract not yet `RETURNED` (with the term end or return due it waits for), each device not checked in and not settled lost (with its open loss case, if any), the unpaid amount, each damage charge pending approval, each service credit `REQUESTED` ("A service credit waits for an Admin's decision.", billing REQ-STA-02), and each incident outside `CLOSED` reported by `CONTRACT_CLOSE_CHECKS`. The close of REQ-ERR-05 refuses on the same blockers, read in its own transaction. A return never requires a replacement unit: a unit that does not come back is reported lost (devices REQ-EVT-13) and settled (REQ-EVT-12); replacement stays an action on a running contract. [FR-CON-13, D-092 rule 3, supervisor demo 2026-11-01]
- **REQ-EVT-19**: WHEN Staff read a contract, the system SHALL give each checked-in row the device's current state and, for the unit's latest return, its next step back to `AVAILABLE` from `devices` (devices REQ-EVT-23): reset, inspect, complete maintenance, or intake check. [D-092 rule 4]
- **REQ-EVT-20**: WHEN an Org Manager creates or edits a group with a name, an optional label, optional start and end dates, an optional area note and an optional parent, the system SHALL save it for the Manager's organization with the `version` the Manager saw, and record the audit entry `group.created` or `group.updated` after commit; the parent SHALL sit less than `rentals.groupMaxDepth` levels below the top (one sub-level by default). [FR-CON-17, BR-46, UC-67]
- **REQ-EVT-21**: WHEN an Org Manager removes a group, the system SHALL, in one transaction, remove its subgroups with it, end every open assignment of the group and its subgroups (their devices become ungrouped), and record the audit entry `group.removed` after commit. [FR-CON-17, UC-67]
- **REQ-EVT-22**: WHEN an Org Manager assigns one or more devices to a group, the system SHALL, in one transaction, end each device's open assignment in another group and open one in this group against the device's live contract row, with the assigner and the time; WHEN the Manager takes a device out of its group, the system SHALL end its open assignment. Each assignment is audited as `group.deviceAssigned` or `group.deviceUnassigned` after commit. [FR-CON-18, BR-46, UC-68]
- **REQ-EVT-23**: WHEN a custody row closes, whichever way it closes (check-in, REQ-EVT-10; a settled loss, REQ-EVT-12; replacement, REQ-EVT-12; or the release of a broken unit from a running contract that the leader ruled on 2026-11-03, specified separately), the system SHALL, in that transaction and through the one step that closes the row (design §11.4), end the device's open assignment with the matching reason and resolve the row's open fault report; on a replacement it SHALL open an assignment for the replacement unit in the same group. [FR-CON-18, BR-46, UC-43, UC-61, build ruling 2026-11-03, review of treklink-web#327]
- **REQ-EVT-24**: WHEN an Org Manager reports a fault on a `RENTED` device of a contract of the organization, with a description, the system SHALL record a `DeviceFaultReport` against the device's live contract row with the reporter and the UTC time, notify TrekLink Staff after commit, show MSG41, and leave the device `RENTED`; the report is resolved when its custody row closes (REQ-EVT-23), with the resolution `REPLACED`, `CHECKED_IN`, `LOST` or `RELEASED`. [FR-CON-19, UC-69]
- **REQ-EVT-25**: WHEN an organization member reads the organization's groups, the system SHALL return them as a tree with each group's count of devices, so the live map, the incident list and the console can filter by group (monitoring REQ-UBI-05). [FR-MON-11, UC-67]
- **REQ-EVT-26**: WHEN a caller lists contracts with a search text `q`, the system SHALL return, across the whole list and not only one page, the contracts whose code, or whose organization's legal name or code, contains `q` ignoring case, within the caller's scope and the other filters, in the same order and with the same paging as without `q`; `q` is trimmed, at most 100 characters, an empty value is no filter, and `%` and `_` are literal characters (api-design 02). [UC-55, FR-AUTH-11, leader request 2026-11-03 (W3)]

- **REQ-EVT-27**: WHEN TrekLink Staff, or an Org Manager of the contract's organization, end an `ACTIVE` or `ENDING` contract now with a reason of 1 to 500 characters and the `version` they saw, the system SHALL, in one transaction under the contract lock, close the open term, set `endsAt` and `returnDueAt` to the end time, have `billing` add the pro-rata credit of the current term to the closing invoice (billing REQ-EVT-16; none for a day plan), and move the contract to `RETURN_DUE` with the transition reason `Ended early: {reason}`, and on to `RETURNED` in the same transaction when every device is already back or lost; after commit it SHALL record the audit entry `contract.endedEarly` with the actor, the reason, the end time and the credit, and emit `contract.endedEarly`. The Manager's request ends the contract at once, like Staff's action, with no Staff approval (build choice 2026-11-05, design §12). From then the return path is the one of any `RETURN_DUE` contract: check-in, inspection, loss case, payment and close, with the grace and late rules of REQ-EVT-10 and REQ-EVT-13 counted from the end time. [D-097 rules 1 and 2]
- **REQ-EVT-28**: WHEN Staff or the contract's Org Manager read the End now preview of an `ACTIVE` or `ENDING` contract, the system SHALL answer, computed by `billing` for the current minute, the end time, the term's dates, its fee, the used and unused days, the credit, what the contract owes after the credit and what would be owed to the organization; nothing is stored. [D-097 rules 2 and 3]

### State-Driven

- **REQ-STA-01**: WHILE a contract is `ENDING`, `RETURN_DUE`, `OVERDUE` or `DEFAULTED`, or `ACTIVE` on a day plan, the system SHALL accept check-ins; a running monthly `ACTIVE` contract SHALL NOT, because its quantity cannot change. A monthly contract that is to come back before its term end is ended now first (REQ-EVT-27); it is then `RETURN_DUE` and accepts check-ins. [BR-05, D-097]
- **REQ-STA-02**: WHILE a contract is `RETURN_DUE`, `OVERDUE` or `DEFAULTED`, its devices and incidents SHALL stay visible to the organization and routed to it. [BR-32, E03-9]

### Unwanted Behaviour

- **REQ-ERR-01**: IF fewer `AVAILABLE` devices exist than requested at request time, or at the approval of a contract that holds none, THEN the system SHALL refuse with 409 `INSUFFICIENT_DEVICES` (MSG11) and create and reserve nothing. [E01-1, D-092 rule 1]
- **REQ-ERR-02**: IF the quantity is below the minimum or the day length is not configured, THEN the system SHALL return 400 `BELOW_MOQ` (MSG13) or `DAY_PLAN_LENGTH`. [E01-2]
- **REQ-ERR-03**: IF the organization is not `ACTIVE` at request, THEN the system SHALL return 409 `ORGANIZATION_NOT_ACTIVE`. [E01-3]
- **REQ-ERR-04**: IF the handover lacks the first payment, provisioning, a passing check, a battery acknowledgement or a Manager signer, THEN the system SHALL refuse with the matching code (MSG19, MSG23, MSG24) and change nothing. [E01-4]
- **REQ-ERR-05**: IF a close finds an unpaid line, a damage charge pending approval, or an incident outside `CLOSED` reported by `CONTRACT_CLOSE_CHECKS`, THEN the system SHALL return 409 `BALANCE_OUTSTANDING` or `OPEN_INCIDENTS` (MSG29); a contract not `RETURNED` answers 409 `INVALID_STATE_TRANSITION`. The blockers are those of REQ-EVT-18, checked in the order state, unpaid amount, unsettled replaced unit, pending damage, incidents. [FR-CON-13, E05-4, E05-7]
- **REQ-ERR-06**: IF notice is given on a day plan, THEN the system SHALL return 409 `DAY_PLAN_NO_NOTICE`.
- **REQ-ERR-08**: IF a handover is attempted before the requested start date, THEN the system SHALL return 409 `BEFORE_START_DATE`.
- **REQ-ERR-07**: IF a scanned tag is not on the contract, THEN the system SHALL return 409 `DEVICE_NOT_ON_CONTRACT` (MSG12).
- **REQ-ERR-09**: IF Staff approve with a handover appointment before the current minute, THEN the system SHALL return 400 `VALIDATION_FAILED` and reserve nothing. [FR-CON-03]
- **REQ-ERR-10**: IF an undo of provisioning carries a stale `version`, names a contract not `APPROVED`, names a unit not on the contract, names a unit not `RESERVED` or already handed over, or names a unit that carries no key version of the contract's organization, THEN the system SHALL return 409 `STALE_VERSION`, `INVALID_STATE_TRANSITION`, `DEVICE_NOT_ON_CONTRACT` (MSG12), `INVALID_STATE_TRANSITION` or `DEVICE_NOT_PROVISIONED` respectively, checked in that order, and change nothing. [FR-DEV-05]
- **REQ-ERR-11**: IF Staff name `deviceIds` when approving a contract that already holds its devices, and the set differs from the held set, THEN the system SHALL return 400 `VALIDATION_FAILED` and change nothing; a failing held unit is swapped at the counter (REQ-EVT-06). [D-092 rule 1]
- **REQ-ERR-12**: IF Staff approve a `REQUESTED` contract that holds its devices after its `holdExpiresAt` with the first payment not paid in full, THEN the system SHALL refuse with 409 `INVALID_STATE_TRANSITION` and change nothing, whether or not the `rentals.requestHoldExpiry` job has cancelled it yet. [D-092 rule 1, review of treklink-web#275]
- **REQ-ERR-13**: IF, on a create or a move, the parent's depth plus one plus the height of the group's own subgroups exceeds `rentals.groupMaxDepth`, or the new parent is the group itself or one of its subgroups, THEN the system SHALL refuse with 409 `GROUP_DEPTH_EXCEEDED` (MSG40) and change nothing. [FR-CON-17, BR-46, E04-8]
- **REQ-ERR-14**: IF an assignment names a device the organization does not hold now, its own device already returned or another organization's, THEN the system SHALL refuse with 409 `DEVICE_NOT_HELD` ("This device is not held by your organization now.", the SRS's MSG17 slot for UC-68) and assign none of the devices of the request. [FR-CON-18, E04-8]
- **REQ-ERR-15**: IF a group has no name, an end date before its start date, or the same name as a group with the same parent in the organization, THEN the system SHALL return 400 `VALIDATION_FAILED` (MSG02, MSG35) or 409 `CONFLICT_UNIQUE` (MSG10); IF the edit carries a stale `version`, THEN 409 `STALE_VERSION`. [FR-CON-17]
- **REQ-ERR-16**: IF a fault report names a device that is not `RENTED` to the organization, THEN the system SHALL return 409 `INVALID_STATE_TRANSITION` (MSG28); IF the device's live row already has an unresolved fault report, THEN 409 `FAULT_ALREADY_REPORTED` with the open report's id, and record nothing. [FR-CON-19]

- **REQ-ERR-17**: IF End now names another organization's contract, THEN the system SHALL return 404 (MSG26); IF its reason is empty after trimming or longer than 500 characters, THEN 400 `VALIDATION_FAILED`; IF the `version` is stale, THEN 409 `STALE_VERSION`; IF the contract is not `ACTIVE` or `ENDING`, THEN 409 `INVALID_STATE_TRANSITION` (MSG28); checked in that order, and in every case nothing changes. The preview of REQ-EVT-28 answers 404 and 409 `INVALID_STATE_TRANSITION` the same way. [D-097]

---

## 3. Non-Functional Requirements

| Property | Target | Source |
|---|---|---|
| Concurrent approvals | never over-allocated across 50 parallel approvals of one variant | E01-1, TC-03 |
| Concurrent requests | never over-allocated across parallel requests of one variant; the loser creates nothing | E01-1, D-092 rule 1 |
| Handover body | `RENTALS_HANDOVER_BODY_LIMIT`, default `2mb`, for the signature image | REQ-ERR-07 of `platform` |
| Scheduler restart | term rollover and overdue jobs catch up from stored dates after downtime | NFR-AVL-02 |
| Concurrent assignment | two Managers moving the same device at once leave it in exactly one group | BR-46, REQ-UBI-06 |
| Contract search | the code match of `q` has a trigram GIN index on `rental_contracts.code` (`pg_trgm`), which a substring `ILIKE` can use; the organization match is a list of ids from `organizations`, joined through the `organizationId` index | REQ-EVT-26 |

---

## 4. Configuration

The `rentals` section of the [Configuration Matrix](../platform/configuration-matrix.md), with
`rentals.groupMaxDepth` (INT, default 1, bounds 1 to 3: how many levels of subgroups a group may have,
BR-46) added by the build (design §11). Environment:
`RENTALS_HANDOVER_BODY_LIMIT`, `HANDOVER_NOTE_STORAGE_DIR`, `HANDOVER_NOTE_STORE` (`file` by default, `database`
on the Vercel production, design §4.1, D-090 amendment), and the issuer of the handover note
(design §4.1): `COMPANY_LEGAL_NAME`, `COMPANY_ADDRESS`, `COMPANY_TAX_CODE`, `COMPANY_HOTLINE`,
`HANDOVER_PLACE`.

---

## 5. Acceptance Criteria

- **AC-01**: Two Staff approve two contracts for the last 5 v3 devices at once; one succeeds, the other gets 409 and reserves nothing. (TC-03)
- **AC-02**: A handover without the confirmed holding fee returns 409 `FIRST_PAYMENT_MISSING` and the contract stays `APPROVED`. (TC-09)
- **AC-03**: A monthly contract with no notice rolls into term 2 with the term-1 balance and the term-2 holding fee due together. (TC-08, E05-5)
- **AC-04**: Devices back 3 days after `returnDueAt`, past the grace: contract `OVERDUE` and a late line of 3 days per late device. Late days are counted from `returnDueAt` (billing REQ-EVT-04, design Figure 16); the grace only decides whether a late fee applies (leader ruling 2026-10-30, #158). (TC-23)
- **AC-05**: `OVERDUE` for `rentals.defaultAfterDays`: `DEFAULTED` and the organization `SUSPENDED`. (TC-26)
- **AC-06**: Closing with an open incident on one device returns 409 `OPEN_INCIDENTS`. (TC-27)
- **AC-07**: After closing, every holder label is null. (TC-33)
- **AC-08**: Two Managers of two organizations request the last 5 v3 devices at once; one request is created holding the 5 units, the other gets 409 `INSUFFICIENT_DEVICES` and leaves no contract, row, invoice or reserved unit behind. (D-092 rule 1)
- **AC-09**: A request whose deposit is unpaid at `holdExpiresAt` is `CANCELLED` with reason `HOLD_EXPIRED` by the next `rentals.requestHoldExpiry` run, its 5 units `AVAILABLE` again and its unpaid first-invoice lines voided; a paid one stays `REQUESTED` holding its units. (D-092 rule 1)
- **AC-10**: A device in group A is assigned to group B: it is in B only (the move of REQ-EVT-22, leader ruling on treklink-web#327); it is checked in: it is in no group, its open fault report is resolved `CHECKED_IN`, and the console no longer lists it. The same holds for a settled loss (`LOST`) and a release (`RELEASED`). (BM04 TC-F11-01, BR-46, TC-46)
- **AC-11**: With `rentals.groupMaxDepth` 1, a subgroup under a subgroup returns 409 `GROUP_DEPTH_EXCEEDED` (MSG40) and nothing is saved; with the parameter set to 2 the same request succeeds without a restart. (BM04 TC-F11-02, E04-8)
- **AC-12**: A Manager of organization B asks for organization A's group or reads the fault reports of A's contract: 404; assigns A's device to a B group: 409 `DEVICE_NOT_HELD`, the same answer as for B's own returned device. Nothing of A is returned, holder labels included. (F-11, BR-19, E04-4; holder privacy is BM04 TC-F11-03, already covered by `return.service.spec.ts`)
- **AC-13**: A grouped unit is replaced at the counter: the replacement is in the same group, the replaced unit in none, and its open fault report is resolved at the replacement time. (F-11, UC-61)
- **AC-14**: A Manager reports a fault on a rented unit: the report is recorded with the reporter and time, Staff get one email, the unit stays `RENTED`; a second report on the same unit before it is resolved returns 409 `FAULT_ALREADY_REPORTED`. (F-21, UC-69; BM04 TC-F21-03 is the loss report, already covered)

- **AC-15**: A monthly contract with term 2 from 2026-11-01 09:00 to 2026-12-01 09:00 (UTC+7, 30 days), is ended now by Staff on 2026-11-06 at 10:00 with a reason: the contract is `RETURN_DUE` with `endsAt` and `returnDueAt` 2026-11-06 10:00, term 2 is closed, the closing invoice carries one `EARLY_END_CREDIT` line of −⌈P × q × 24 ÷ 30⌉ VND with the Staff member as author and the reason, and the audit log holds `contract.returnDue` and `contract.endedEarly`; check-in of every unit moves it to `RETURNED`, and once the rest is paid the close succeeds. (D-097)
- **AC-16**: End now on a `RETURN_DUE` contract, with a stale `version`, without a reason, or by a Manager of another organization returns 409 `INVALID_STATE_TRANSITION`, 409 `STALE_VERSION`, 400 `VALIDATION_FAILED` or 404, and changes nothing; an Org Operator gets 403. A day plan ended now gets no credit line. (D-097)

---

## 6. Open Questions

None.
