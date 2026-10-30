# Implementation Tasks: rentals

> Rewritten 2026-10-18 (D-051) in the full task format of `specs/README.md` §6; adds mid-contract
> replacement (UC-61, D-045) and the loss-case ports. Fulfills `design.md`; endpoints are `api-design/01`
> to `18`.

| | |
|---|---|
| Lane owner | LongLP (roadmap §5.1, remapped 2026-10-18) |
| Reviewer | KhoaDD |
| Sprint | 3 (W7 to W8) for request to handover (MF-01); 5 (W11) for terms, return and close (MF-05) |
| Stories | US-UC14 (provisioning at the counter), US-UC15, US-UC16, US-UC17, US-UC18, US-UC20, US-UC21, US-UC23, US-UC24, US-UC25, US-UC43, US-UC44 (orchestration), US-UC50, US-UC51, US-UC55, US-UC61 |
| Depends on | organizations 2.1 to 2.4; devices 2.3 and 2.4; billing 2.1 to 2.4 |
| Unblocks | gateway-sync 2.4 (attribution), incidents 2.2 (contract lookup), devices 2.7 (custody port) |

## Phase 1: Foundation & Domain Modeling

- [x] 1.1 `RentalsModule` and `ContractsRepository` (owner LongLP)
  - **Files**: `backend/src/modules/rentals/rentals.module.ts`, `contracts.repository.ts`
  - **Do**: repository over `RentalContract`, `ContractDevice`, `ContractTerm`, `ContractTransition` only; methods of design Figure 4 (`insertRequested`, `lockById`, `insertContractDevices`, `findCustody`, `transition`); contract code `RC-<year>-<4 digits>` as the `schema.prisma` example `RC-2026-0042`
  - **Test**: the partial unique index rejects a second live row for one device (BR-03)
  - _Requirements: REQ-UBI-02, BR-03_
  - **Done**: in TK-187; `insertRequested` also writes the first transition row, and the year of a code is the request's year in UTC+7
- [x] 1.2 `ContractLifecycleService.apply(id, from, to, reason, tx)` (owner LongLP)
  - **Files**: `backend/src/modules/rentals/contract-lifecycle.service.ts`
  - **Do**: the transition table of design §2; compare-and-set on `version`, one `ContractTransition` row, `contract.statusChanged` and `audit.record` after commit; other pairs 409 `INVALID_STATE_TRANSITION`
  - **Test**: every pair of the eleven states, allowed or 409
  - _Requirements: REQ-UBI-01, FR-CON-13_
  - **Done**: in TK-187, as `apply(id, from, to, reason, actor, tx)` with `actor` null for SYSTEM (treklink-docs#103, 2)
- [ ] 1.3 Ports (owner LongLP)
  - **Files**: `backend/src/modules/rentals/ports/contract-close-checks.port.ts`, `providers/exit-checks.provider.ts`, `providers/custody-resolver.provider.ts`, `providers/loss-case-listener.provider.ts`
  - **Do**: declare the multi-provider `CONTRACT_CLOSE_CHECKS`; provide `ORGANIZATION_EXIT_CHECKS.canClose` (open contracts block closing), `CUSTODY_RESOLVER` (delegates to `custodyAt`) and `LOSS_CASE_LISTENERS.onSettled` (sets the row's `lostAt` to the case's confirmation time; `onConfirmed` does nothing)
  - **Test**: closing an organization with an `ACTIVE` contract is refused; `onSettled` sets `lostAt` inside the caller's transaction
  - _Requirements: design §6, REQ-EVT-12, FR-DEV-13_
  - **Partly done** in TK-187: `CONTRACT_CLOSE_CHECKS` is declared, and `ContractsService.canClose`, `custodyAt` and `onLossSettled` are built and tested; they are registered under `ORGANIZATION_EXIT_CHECKS`, `CUSTODY_RESOLVER` and `LOSS_CASE_LISTENERS` once `organizations` and `devices` declare those tokens (treklink-docs#103, 1)

## Phase 2: Request to handover (MF-01)

- [x] 2.1 Request with price snapshot (owner LongLP)
  - **Files**: `backend/src/modules/rentals/contracts.service.ts`
  - **Do**: `request(dto, caller)`: `OrganizationsService.assertActive` (409 `ORGANIZATION_NOT_ACTIVE`); quantity at least `rentals.minOrderQuantity` (400 `BELOW_MOQ`, MSG13); a `DAY` plan length from configuration (400 `DAY_PLAN_LENGTH`); active variant; start date not in the past; snapshot monthly unit price, day premium and holding-fee ratio from `PricingService.snapshot`; create `REQUESTED`, notify Staff (MSG14)
  - **Test**: each refusal; a later price change does not change the snapshot
  - _Requirements: REQ-EVT-01, REQ-UBI-04, REQ-ERR-02, REQ-ERR-03, FR-CON-01, FR-CON-02, FR-CFG-02, BR-01, BR-02_
  - _Story: US-UC15_
  - **Done**: `request(input, caller, at)` runs every check in one transaction, takes `PricingService.snapshot` (billing 2.1), inserts `REQUESTED`, audits `contract.request` and returns the contract with the api-design 01 `quote` (term fee and holding fee, or the day-plan total). A start date before today in UTC+7 is 400 `VALIDATION_FAILED`, as api-design 01 lists no code of its own. The minimal `OrganizationsService.assertActive` it needs is built here too (organizations 2.4, owner TanNB). On 2026-10-30, the request checks the active variant through `DevicesService.variants(true, tx)` before pricing; an inactive or unknown variant is 404 and no contract is written. The request now emits `contract.requested` after commit; the Staff/Admin email uses `STAFF_NOTIFICATIONS`. Delivery is best effort, with failures logged and no persistent retry queue
- [ ] 2.2 Approve, reject, cancel (owner LongLP)
  - **Files**: `contract-lifecycle.service.ts`
  - **Do**: `approve(id, dto, actor)`: one transaction with `DevicesService.reserve` (409 `INSUFFICIENT_DEVICES`, MSG11, nothing reserved), term 1 anchored to the start date at 09:00 UTC+7, `InvoicesService.issueTermInvoice` or `issueDayPlanInvoice`, `reservationExpiresAt`, `APPROVED`; `reject` with a reason; `cancel` from `REQUESTED` or `APPROVED` releases devices and calls `ChargesService.settleCancellation` (holding fee kept), `CANCELLED` (MSG15)
  - **Test**: AC-01 with two concurrent approvals on Postgres; cancel after a paid holding fee keeps the payment
  - _Requirements: REQ-EVT-02, REQ-EVT-03, REQ-ERR-01, AC-01, FR-CON-03, FR-CON-04, FR-CON-11, BR-03, BR-04_
  - _Story: US-UC16, US-UC17, US-UC18_
  - **Partly done**: in `contract-decisions.service.ts`. `approve` checks `expectedVersion` (409 `STALE_VERSION`, MSG36), reserves through `DevicesService.reserve` (409 `INSUFFICIENT_DEVICES`, nothing reserved), creates term 1 from 09:00 UTC+7 on the start date (`contract-terms.ts`), issues the term or day-plan invoice, sets `reservationExpiresAt` to the handover appointment plus `rentals.reservationExpiryHours` and moves to `APPROVED`. Per the leader ruling of 2026-10-27 (issue #87 point 1) the appointment is stored in `RentalContract.handoverAppointmentAt` (migration `20261028120000_contract_handover_appointment`, which backfills earlier approvals from the `Handover appointment <ISO>` transition reason; the reason is still written for the history), and api-design 02, 03 and 04 answer it. Checked on PGlite 2026-10-28: no schema drift, and an approval written before the column got its appointment back. `reject` stores the reason; `cancel` (Org Manager own, or Staff) releases the reserved rows and units, calls `settleCancellation` and answers the paid amount as `retainedVnd`. On 2026-10-30, api-design 04 accepts optional `deviceIds`: exactly the requested quantity, with no duplicates; the same row-lock query restricts the choice to AVAILABLE units of the contract's variant, with no fallback when a chosen unit is unavailable; such a unit answers 409 `DEVICE_NOT_AVAILABLE` naming its asset tag (2026-10-30, KhoaDD under D-078), and a wrong count or a duplicate 400 `VALIDATION_FAILED` "Choose exactly N distinct devices.". Open: AC-01 with two concurrent approvals on Postgres (`test:db`, no Docker on this machine). The APPROVED and REJECTED events now email the organization contact after commit; transport failures are logged without rolling back the decision
- [ ] 2.3 Provisioning and swap at the counter (owner LongLP)
  - **Files**: `backend/src/modules/rentals/handover.service.ts`
  - **Do**: `provision(id, deviceId, dto, actor)` records the organization's current `channelKeyVersion` through `DevicesService.recordProvisioning`; a scanned tag not on the contract is 409 `DEVICE_NOT_ON_CONTRACT` (MSG12); `swap` moves a failing reserved unit to `MAINTENANCE` through `failHandoverCheck` and reserves another `AVAILABLE` unit of the variant in the same transaction
  - **Test**: swap with no spare unit holds the handover and changes nothing
  - **Partly done** (2026-10-27): `HandoverService.provision` refuses another key version (409 `KEY_VERSION_MISMATCH` naming the current one), a unit not on the contract (409 `DEVICE_NOT_ON_CONTRACT`) and a contract not `APPROVED` (409 `INVALID_STATE_TRANSITION`), then records through `DevicesService.recordProvisioning`. `swap` releases the contract row, moves the unit to `MAINTENANCE` (`failHandoverCheck`), reserves one `AVAILABLE` unit of the variant and inserts its row in one transaction, with a `contract.deviceSwapped` audit record. Unit-tested; walked on local PGlite on 2026-10-27 (TL-0004 swapped for TL-0012). Open: the no-spare-unit test on Postgres
  - _Requirements: REQ-EVT-04, REQ-EVT-06, REQ-ERR-07, FR-DEV-05, BR-09_
  - _Story: US-UC14_
- [ ] 2.4 Handover with signed note (owner LongLP)
  - **Files**: `handover.service.ts`, `handover-note.renderer.ts`
  - **Do**: preview PDF; `complete(id, dto, actor)` refuses before the start date (409 `BEFORE_START_DATE`), without the first payment (`BalanceService.firstPaymentConfirmed`, 409 `FIRST_PAYMENT_MISSING`), unprovisioned or failing devices (`DEVICE_NOT_PROVISIONED`, `DEVICE_CHECK_FAILED`, `LOW_BATTERY`), a signer who is not the Manager (400 `SIGNER_NOT_MANAGER`) or no signature (409 `NOTE_NOT_SIGNED`); stamps the drawn signature into the PDF, stores it under `HANDOVER_NOTE_STORAGE_DIR` with its SHA-256, sets `handedOverAt` on each row, moves devices to `RENTED` and the contract to `ACTIVE` in one transaction (MSG06); the note download re-checks the SHA-256; body limit `RENTALS_HANDOVER_BODY_LIMIT`
  - **Test**: AC-02; a tampered stored PDF fails the download check
  - **Partly done** (2026-10-27): the preview (api-design 08) and `complete` as above, rendered with pdfkit (`handover-note.renderer.ts`, built-in Helvetica). A missing signature is 400 `VALIDATION_FAILED` from the DTO, and a signature that is not a PNG is 400 `VALIDATION_FAILED` too: api-design 10 lists no `NOTE_NOT_SIGNED`, which api-design 11 answers for a note download before signing. The signer is the Manager's account id (organizations api-design 12 `userId`), checked live in the transaction. Every read the note needs (asset tags, organization label, first payment) joins the handover transaction; a read on another connection made PGlite wait out the 60 s timeout, and on Postgres would not see the rows the transaction wrote. The note download (api-design 11) re-hashes the file: `OK`, `MISMATCH` or `MISSING`. Unit-tested; walked on local PGlite on 2026-10-27, every refusal of api-design 10 then the handover to `ACTIVE` with five units out and the note read back `OK`. Open: `RENTALS_HANDOVER_BODY_LIMIT` (the global 1 MB `HTTP_BODY_LIMIT` carries a pad PNG of tens of KB today); an embedded font for Vietnamese names on the note; AC-02 on Postgres
  - _Requirements: REQ-EVT-05, REQ-UBI-05, REQ-ERR-04, REQ-ERR-08, AC-02, FR-CON-05, FR-CON-06, BR-09_
  - _Story: US-UC20, US-UC21_
  - **2026-10-30**: `RENTALS_HANDOVER_BODY_LIMIT` is validated independently (default `2mb`) and applies to JSON on `POST /api/contracts/:id/handover` before the global parser; other routes retain `HTTP_BODY_LIMIT`. Oversized signatures keep the 413 envelope and request id. PDFKit now embeds the unchanged, licensed DejaVu Sans 2.37 font copied with the Nest build for Vietnamese names; Postgres AC-02 evidence remains open
- [x] 2.5 Holder labels (owner LongLP)
  - **Do**: set or clear a label on a handed-over device by a member of the renting organization; emit `device.labelChanged`; closing erases every label
  - **Test**: AC-07
  - _Requirements: REQ-EVT-15, AC-07, FR-CON-14, BR-33_
  - _Story: US-UC25_
  - **Done** (2026-10-27): `ContractDecisionsService.setHolder` sets or, with a blank name, clears the label of a device that is out (handed over, not back, not lost) on a contract that is not CLOSED, for a member of the renting organization only (a TrekLink account or another organization answers 404); 409 `DEVICE_NOT_ON_CONTRACT` (MSG12) and `INVALID_STATE_TRANSITION`; emits `device.labelChanged` with the name only. Erasing every label on close joins with 4.4

## Phase 3: Terms and end of contract (MF-05)

- [ ] 3.1 Notice and term rollover (owner LongLP)
  - **Files**: `backend/src/modules/rentals/jobs/term-rollover.job.ts`, `contracts.service.ts`
  - **Do**: notice on an `ACTIVE` monthly contract moves it to `ENDING` with `endsAt` at the term end (MSG18); a day plan refuses notice (409 `DAY_PLAN_NO_NOTICE`); `rentals.termRollover` (daily at `rentals.termRolloverHourLocal`, hourly catch-up) closes ended terms and opens the next with its invoice, or moves `ENDING` to `RETURN_DUE`; day plans past their end go to `RETURN_DUE`, and straight to `RETURNED` when every device is back or lost
  - **Test**: AC-03; a re-run after downtime closes each term once
  - _Requirements: REQ-EVT-07, REQ-EVT-08, REQ-EVT-09, REQ-ERR-06, REQ-UBI-03, AC-03, FR-CON-07, FR-CON-08, FR-CON-09, FR-CON-10, BR-05 to BR-08_
  - _Story: US-UC23, US-UC24_
  - **Partly done** (2026-10-27): notice, as `ContractDecisionsService.giveNotice`: ACTIVE monthly to ENDING with `endsAt` at the open term's end and `noticeGivenAt`/`noticeGivenById`, `expectedVersion` checked, 409 `DAY_PLAN_NO_NOTICE`; the answer carries `dueAtEndVnd` (the balance due later) for MSG18. Open: the `rentals.termRollover` job
  - **Partly done** (2026-10-28): `TermRolloverJob` (`rentals.termRollover`, hourly at minute 5, which also covers the catch-up) closes each ended `OPEN` term by compare-and-set; a monthly `ACTIVE` contract gets term n+1 (one calendar month) with its invoice through `InvoicesService.issueTermInvoice`; an `ENDING` contract or a day plan moves to `RETURN_DUE` with `returnDueAt` at the term end (reason `TERM_ENDED`), and on to `RETURNED` when every device is already back or lost. Unit-tested (renewal, notice, day plan, re-run). Walked on local PGlite on 2026-10-28 through the API, RC-2026-0001 from notice to CLOSED. On 2026-10-30, the job reads `rentals.termRolloverHourLocal` each run and selects terms due by the latest daily cutoff in fixed UTC+7; hourly wakeups only catch up already-due batches. Actual operation timestamps stay at the run time. Open: AC-03 on Postgres
- [x] 3.2 Overdue, default, reminders (owner LongLP)
  - **Files**: `jobs/overdue-and-default.job.ts`, `jobs/reservation-reminders.job.ts`
  - **Do**: `RETURN_DUE` past `returnDueAt` plus `rentals.returnGraceHours` with devices out to `OVERDUE`; `OVERDUE` for `rentals.defaultAfterDays` to `DEFAULTED` and `OrganizationsService.suspendForDefault`; one reminder per approved contract past `reservationExpiresAt`; `RETURN_DUE`, `OVERDUE` and `DEFAULTED` contracts stay visible and routed to the organization
  - **Test**: AC-04 and AC-05 with a fake clock; reminder sent once
  - **Partly done** (2026-10-28): `OverdueAndDefaultJob` (`rentals.overdueAndDefault`, hourly at minute 15) moves a `RETURN_DUE` contract with devices out to `OVERDUE` once `rentals.returnGraceHours` have passed after `returnDueAt` (reason `GRACE_ELAPSED`, `overdueAt` stamped), and an `OVERDUE` contract to `DEFAULTED` after `rentals.defaultAfterDays` (`DEFAULT_THRESHOLD`, `defaultedAt`), with `OrganizationsService.suspendForDefault`; both are SYSTEM transitions rechecked under the row lock, so a re-run moves nothing twice. `ReservationRemindersJob` (`rentals.reservationReminders`, hourly at minute 25) flags an `APPROVED` contract past `reservationExpiresAt` with an `APPROVED` to `APPROVED` SYSTEM transition (reason `RESERVATION_REMINDED`, design §5), then emails the Manager at the organization's contact address through `OrganizationsService.emailContact`. 2026-10-29 (review of #108): under the contract lock the job rechecks the status and the flag (`hasReminder`), sends the email, and writes the flag only once the transport accepted it, reading the contact address in the same transaction; a failed send leaves no flag and is retried on the next run, and two runs that picked the same contract remind it once. Unit-tested (9, fake clock). Walked on local PGlite on 2026-10-28: RC-2026-0001 went `RETURN_DUE`, `OVERDUE`, `DEFAULTED` (ORG-0001 `SUSPENDED`, a new request then 409 `ORGANIZATION_NOT_ACTIVE`, the contract still visible to the Manager) and `RETURNED` by check-in; a second run moved nothing; RC-2026-0003 was reminded once. On 2026-10-30, Staff reminders have their own attempt and `RESERVATION_STAFF_REMINDED` flag, so a Staff failure does not undo an accepted Manager reminder and missing audiences retry. OVERDUE and DEFAULTED events email the organization contact after commit. Status notices have no persistent retry queue, and SMTP acceptance followed by a database failure can repeat email. On 2026-10-30 (KhoaDD under D-078) the Staff marker is written once any Staff recipient accepted, so a partial delivery is not repeated to those who got it, and without `STAFF_NOTIFICATIONS` the candidate query asks only for the Manager marker. The overdue/default candidate thresholds now use the same configured daily cutoff, while persisted timestamps remain the actual run time. Reservation reminders retain hourly comparison against the actual appointment expiry. Postgres concurrency and live SMTP evidence remain separate verification gaps
  - _Requirements: REQ-EVT-13, REQ-EVT-14, REQ-STA-02, AC-04, AC-05, FR-CON-12, BR-26, BR-32_
  - _Story: US-UC50_

## Phase 4: Return, replacement and close

- [ ] 4.1 Check-in (owner LongLP)
  - **Files**: `backend/src/modules/rentals/return.service.ts`
  - **Do**: accepted only in the states of REQ-STA-01; mark the row `checkedInAt`, `DevicesService.markReturned`, `ChargesService.chargeLate` past the grace, emit `device.checkedIn`; a `RETURN_DUE`, `OVERDUE` or `DEFAULTED` contract moves to `RETURNED` once every device is back or lost (MSG07)
  - **Test**: check-in refused on a running monthly `ACTIVE` contract; late line count per device
  - **Partly done** (2026-10-28): `ReturnService.checkIn` (api-design 14, `POST /api/contracts/:id/check-ins`, `contract.operate`) accepts the states of REQ-STA-01, refuses a tag not out on the contract with 409 `DEVICE_NOT_ON_CONTRACT` naming it and stores nothing, marks the rows, `DevicesService.markReturned`, `ChargesService.chargeLate` per device past `returnDueAt` plus the grace, emits `device.checkedIn` after commit, and moves a due contract to `RETURNED` (reason `CHECKED_IN`) with the last device. The answer carries `returned`, `total`, `contractStatus` and `lateFeeVnd` (the outstanding difference) for MSG07. Unit-tested. Walked on local PGlite on 2026-10-28 through the API, RC-2026-0001 from notice to CLOSED.
  - _Requirements: REQ-EVT-10, REQ-STA-01, FR-MON-08, FR-BILL-03_
  - _Story: US-UC43_
  - **2026-10-30**: a DAY ACTIVE or monthly ENDING check-in before the daily batch fills `returnDueAt` reads the open term's end in the same transaction; if that end has passed, late pricing uses it. Missing terms fail before the check-in writes, and an early return stays free of late fees. This prevents scheduler downtime or a changed batch hour from silently skipping a late fee
- [ ] 4.2 Inspection orchestration (owner LongLP)
  - **Do**: `inspect(id, deviceId, dto, actor)`: `DevicesService.recordInspection` and, for `DAMAGED`, `ChargesService.chargeDamage` in the same transaction, unless the contract is `CLOSED`; reset-before-inspection is enforced by devices (409 `RESET_REQUIRED`)
  - **Test**: a damaged inspection creates the damage line in the same transaction
  - **Partly done** (2026-10-28): `ReturnService.inspect` (api-design 16, `POST /api/contracts/:id/devices/:deviceId/inspection`) refuses a `CLOSED` contract and a device not handed over on it, calls `DevicesService.recordInspection` (which enforces the reset after the check-in, 409 `RESET_REQUIRED`), and for `DAMAGED` `ChargesService.chargeDamage` in the same transaction; an unknown code is 400 `UNKNOWN_DAMAGE_CODE`. Unit-tested. Walked on local PGlite on 2026-10-28 through the API, RC-2026-0001 from notice to CLOSED.
  - _Requirements: REQ-EVT-11, FR-BILL-04, UC-44_
  - _Story: US-UC44_
- [ ] 4.3 Replacement on a running contract (owner LongLP)
  - **Files**: `backend/src/modules/rentals/replacement.service.ts`
  - **Do**: `replace(id, deviceId, dto, actor)` on `ACTIVE` or `ENDING`: check in the faulty unit when present (or require an open loss case through `DevicesService.openLossForReplacement`), `reserveExplicit` an `AVAILABLE` unit of the same variant, provision it at the current key version, store the signed replacement note with its SHA-256, insert a `ContractDevice` with `replacesId` and `handedOverAt`, `markRented`; plan, variant and quantity unchanged
  - **Test**: replacement leaves the live-row count equal to the quantity; replacing on `RETURN_DUE` refused
  - **Partly done** (2026-10-28): `ReplacementService.replace` serves api-design 15 (`contract.operate`) in one transaction: the unit must be out on the contract (409 `DEVICE_NOT_ON_CONTRACT` naming it) and the contract `ACTIVE` or `ENDING`; `DevicesService.takeForReplacement` locks the chosen unit and requires the variant (409 `VARIANT_MISMATCH`) and `AVAILABLE` (409 `DEVICE_NOT_AVAILABLE`); a suspended organization is 409 `ORGANIZATION_NOT_ACTIVE` with the replacement message; the key version must be the organization's current one (409 `KEY_VERSION_MISMATCH`, as in api-design 09). A unit at the counter is checked in and goes to `RETURNED` for reset and inspection; a unit away needs an open loss case (409 `LOSS_CASE_REQUIRED`), read directly because the loss-case service of devices does not exist yet. The note renders with the handover renderer under its own title and is stored with its SHA-256 on a new row with `replacesId`; `device.checkedIn`, `device.handedOver` and an audit record go out after commit. Unit-tested (12). Walked on local PGlite on RC-2026-0001: each refusal, TL-0009 replaced by TL-0011, then reset and inspected. 2026-10-29 (review of #107): a replaced row is no longer live (`liveRows`, `rowsOut` and `returnCounts` leave out rows that a replacement points at) but keeps its custody history, so the live rows stay at the quantity; the close checks read every device the contract held (`custodyDevices`), and a unit replaced while missing blocks the close with 409 `BALANCE_OUTSTANDING` until its loss settles and sets `lostAt` (`unsettledReplacedLosses`). api-design 15 now lists `KEY_VERSION_MISMATCH` and `LOSS_CASE_REQUIRED` through the catalog; handbook gate: §2.6 re-read from the PDF, the regenerated flowchart rendered with Mermaid 11 and checked by LongLP's agent (two new decision diamonds, each with its 409 and End), cross-checked against `replacement.service.ts` and `ErrorCode`
  - _Requirements: REQ-EVT-12, REQ-UBI-03, FR-CON-15, BR-05, BR-41_
  - _Story: US-UC61_
- [ ] 4.4 Close (owner LongLP)
  - **Do**: `close(id, dto, actor)` on `RETURNED`: `BalanceService.outstanding` and pending damage approvals (409 `BALANCE_OUTSTANDING`), every `CONTRACT_CLOSE_CHECKS.blockingReason` (409 `OPEN_INCIDENTS`, MSG29); erase labels; `CLOSED`
  - **Test**: AC-06 and AC-07
  - **Partly done** (2026-10-28): `ReturnService.close` (api-design 17, `POST /api/contracts/:id/close`) checks the version (409 `STALE_VERSION`), `RETURNED`, `BalanceService.outstanding` (409 `BALANCE_OUTSTANDING`) and every `CONTRACT_CLOSE_CHECKS` provider (409 `OPEN_INCIDENTS`, MSG29), erases the holder labels and moves to `CLOSED`. Unit-tested. Walked on local PGlite on 2026-10-28 through the API, RC-2026-0001 from notice to CLOSED. 2026-10-29 (review of #104): a damage charge still `PENDING_APPROVAL` on the contract's devices since the handover also blocks the close with 409 `BALANCE_OUTSTANDING` (`ChargesService.pendingDamage`, read by device and time because `DamageCharge` has no contract column, treklink-docs#114), and `incidents` now provides `CONTRACT_CLOSE_CHECKS` through the global `IncidentsPortsModule`: an incident not `CLOSED` on the contract or its devices blocks with 409 `OPEN_INCIDENTS` (MSG29); the check reads in the close transaction, which the port now requires. Check-in refuses tags that trim to nothing (400 `VALIDATION_FAILED`). Unit-tested
  - _Requirements: REQ-ERR-05, AC-06, FR-CON-13, BR-27_
  - _Story: US-UC51_
- [x] 4.5 Services for other modules (owner LongLP)
  - **Do**: `custodyAt(deviceId, at, marginSeconds)` with the `nearBoundary` flag, `currentHolder`, `visibleDevices(ctx)`, `rentalPeriods`, `contractsOfDevice`, `statusOf`, `utilization(range)` per design §6
  - **Test**: `custodyAt` at an interval start, end, inside a replacement chain and outside every interval
  - _Requirements: D-040, design §6_
  - _Story: US-UC26 (attribution side), US-UC60 (custody side)_
  - **Done** (2026-10-30): `custodyAt`, `visibleDevices`, `contractsOfDevice` and `statusOf` were built with the earlier tasks. `rentalPeriods(deviceId, organizationId)` returns the handed-over rows of the device on that organization's contracts as `{ contractId, from, to }`, `to` the check-in or loss and null while out (`ContractsRepository.rentalPeriodsOfDevice`), for monitoring api-design 03. `utilization({ from, to }, at)` returns `{ hardwareVariantId, rentedUnitDays }` per variant of the contract: every interval overlapping `[from, to)` (`ContractsRepository.intervalsOverlapping`) counts its overlap, an open interval up to `at` at most, in days rounded to two decimals; monitoring api-design 08 adds units in service from `devices`. `currentHolder` is not built: monitoring 2.x takes the organization from each event and calls no holder lookup, so design §6 now says so. Unit-tested, and on Postgres (`test/rentals.db-spec.ts`): `custodyAt` at the start (near boundary), at the swap of a replacement (the replaced unit answers none, the replacement answers its own row), before the handover and outside every interval; `rentalPeriods` per organization; three rented unit-days across the replacement

## Phase 5: Query / Retrieval

- [x] 5.1 Contracts list, detail and transitions (owner LongLP)
  - **Do**: list with status, plan and organization filters (members see their own); detail with rows, terms and balance summary; transitions
  - **Test**: a member reading another organization's contract gets 404
  - _Requirements: FR-AUTH-11_
  - _Story: US-UC55_
  - **Done**: `ContractReadsService` serves the list with status, plan and organization filters and the current term, the detail with every term, the device rows still on the contract (asset tags from `devices`) and the balance from `billing`, and the transitions with the actor's name; a member reads its own organization's contracts only, another's answers 404. Organization and variant labels come from `OrganizationsService.labelsOf` and `DevicesService.variants`. On 2026-10-30, api-design 02 accepts the Staff organization filter as a UUID; an organization caller's token scope takes precedence over that filter

## Phase 6: API Presentation Layer

- [ ] 6.1 `ContractsController` (owner LongLP)
  - **Do**: api-design 01 to 18 with each file's permission and `@ResponseMessage`
  - **Partly done**: api-design 01 `POST /api/contracts` (`contract.request.own`, Org Manager); 02 `GET /api/contracts`, 03 `GET /api/contracts/:id` and 18 `GET /api/contracts/:id/transitions` (`contract.read`); 04 `POST /api/contracts/:id/approve` and 05 `.../reject` (`contract.operate`, Staff); 06 `.../cancel` (`contract.cancel.own` or `contract.operate`); 12 `POST /api/contracts/:id/notice` (`contract.notice.own`) and 13 `PUT /api/contracts/:id/devices/:deviceId/holder` (`contract.label.own`), both with static messages, the page building MSG18. `handover.controller.ts` (2026-10-27) serves 07 `POST /api/contracts/:id/devices/:deviceId/swap`, 08 `GET /api/contracts/:id/handover-note/preview`, 09 `.../provisioning` and 10 `POST /api/contracts/:id/handover` (`contract.operate`), and 11 `GET /api/contracts/:id/handover-note` (`handoverNote.read`, `handoverNote.read.own`); 10 answers the static message `Handover complete.` and the page builds MSG06 from `devicesHandedOver` and `code`. For 01, answering the api-design shape with every VND amount as a JSON number, the organization from the verified context and the variant code from `DevicesService.variants`; `currentTerm` is null until approval creates term 1. Exercised on the shared Neon seed on 2026-10-26: every refusal of api-design 01 answers as specified (400 `BELOW_MOQ`, `DAY_PLAN_LENGTH`, `VALIDATION_FAILED` for a past or malformed date, 403 for an Org Operator, 401 without a token); the successful request was not sent, to keep the shared database clean
- [ ] 6.2 E2E (owner LongLP)
  - **Files**: `backend/test/rentals.e2e-spec.ts`, `backend/test/tenancy.e2e-spec.ts`
  - **Do**: every Validation row of api-design 01 to 18; AC-01 to AC-07; the 50 parallel approvals of the non-functional table
  - **Partly done** (2026-10-28): `backend/test/rentals.e2e-spec.ts` (28) through the real HTTP pipeline with Prisma stubbed, callers from `backend/test/e2e-callers.ts` with the seeded permission rows: 401 without a token; the role rules (an Org Operator may not request or give notice, an Org Manager may not approve, reject, swap or provision); the 400 rows of api-design 01, 02, 04, 05, 07, 09, 10, 12 and 13 that the ValidationPipe decides, and a contract id that is not a uuid; 404 for another organization's contract and its history, and for an unknown one. Open: AC-01 to AC-07, the 50 parallel approvals and the service-level rows (409s), which need Postgres (`test:db`); the rows of api-design 14 to 17, which join once #104 and #107 merge
  - _Requirements: AC-01 to AC-07_

## Phase 7: Frontend Integration

- [ ] 7.1 Manager: request with quote, contracts, notice, holder labels, loss report; Staff: approval queue, counter handover with signature pad, check-in by scan, inspection, replacement (owner LongNN, tracked in `specs/frontend/tasks.md` 5.1 to 5.5)

## Phase 8: Verification & DoD

- [ ] 8.1 Suite green; lint, boundary check, typecheck clean; `api-design/*.md` matching behaviour (owner LongLP)
