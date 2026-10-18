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

- [ ] 1.1 `RentalsModule` and `ContractsRepository` (owner LongLP)
  - **Files**: `backend/src/modules/rentals/rentals.module.ts`, `contracts.repository.ts`
  - **Do**: repository over `RentalContract`, `ContractDevice`, `ContractTerm`, `ContractTransition` only; methods of design Figure 4 (`insertRequested`, `lockById`, `insertContractDevices`, `findCustody`, `transition`); contract code `RC-<year>-<4 digits>` as the `schema.prisma` example `RC-2026-0042`
  - **Test**: the partial unique index rejects a second live row for one device (BR-03)
  - _Requirements: REQ-UBI-02, BR-03_
- [ ] 1.2 `ContractLifecycleService.apply(id, from, to, reason, tx)` (owner LongLP)
  - **Files**: `backend/src/modules/rentals/contract-lifecycle.service.ts`
  - **Do**: the transition table of design §2; compare-and-set on `version`, one `ContractTransition` row, `contract.statusChanged` and `audit.record` after commit; other pairs 409 `INVALID_STATE_TRANSITION`
  - **Test**: every pair of the eleven states, allowed or 409
  - _Requirements: REQ-UBI-01, FR-CON-13_
- [ ] 1.3 Ports (owner LongLP)
  - **Files**: `backend/src/modules/rentals/ports/contract-close-checks.port.ts`, `providers/exit-checks.provider.ts`, `providers/custody-resolver.provider.ts`, `providers/loss-case-listener.provider.ts`
  - **Do**: declare the multi-provider `CONTRACT_CLOSE_CHECKS`; provide `ORGANIZATION_EXIT_CHECKS.canClose` (open contracts block closing), `CUSTODY_RESOLVER` (delegates to `custodyAt`) and `LOSS_CASE_LISTENERS.onSettled` (sets the row's `lostAt` to the case's confirmation time; `onConfirmed` does nothing)
  - **Test**: closing an organization with an `ACTIVE` contract is refused; `onSettled` sets `lostAt` inside the caller's transaction
  - _Requirements: design §6, REQ-EVT-12, FR-DEV-13_

## Phase 2: Request to handover (MF-01)

- [ ] 2.1 Request with price snapshot (owner LongLP)
  - **Files**: `backend/src/modules/rentals/contracts.service.ts`
  - **Do**: `request(dto, caller)`: `OrganizationsService.assertActive` (409 `ORGANIZATION_NOT_ACTIVE`); quantity at least `rentals.minOrderQuantity` (400 `BELOW_MOQ`, MSG13); a `DAY` plan length from configuration (400 `DAY_PLAN_LENGTH`); active variant; start date not in the past; snapshot monthly unit price, day premium and holding-fee ratio from `PricingService.snapshot`; create `REQUESTED`, notify Staff (MSG14)
  - **Test**: each refusal; a later price change does not change the snapshot
  - _Requirements: REQ-EVT-01, REQ-UBI-04, REQ-ERR-02, REQ-ERR-03, FR-CON-01, FR-CON-02, FR-CFG-02, BR-01, BR-02_
  - _Story: US-UC15_
- [ ] 2.2 Approve, reject, cancel (owner LongLP)
  - **Files**: `contract-lifecycle.service.ts`
  - **Do**: `approve(id, dto, actor)`: one transaction with `DevicesService.reserve` (409 `INSUFFICIENT_DEVICES`, MSG11, nothing reserved), term 1 anchored to the start date at 09:00 UTC+7, `InvoicesService.issueTermInvoice` or `issueDayPlanInvoice`, `reservationExpiresAt`, `APPROVED`; `reject` with a reason; `cancel` from `REQUESTED` or `APPROVED` releases devices and calls `ChargesService.settleCancellation` (holding fee kept), `CANCELLED` (MSG15)
  - **Test**: AC-01 with two concurrent approvals on Postgres; cancel after a paid holding fee keeps the payment
  - _Requirements: REQ-EVT-02, REQ-EVT-03, REQ-ERR-01, AC-01, FR-CON-03, FR-CON-04, FR-CON-11, BR-03, BR-04_
  - _Story: US-UC16, US-UC17, US-UC18_
- [ ] 2.3 Provisioning and swap at the counter (owner LongLP)
  - **Files**: `backend/src/modules/rentals/handover.service.ts`
  - **Do**: `provision(id, deviceId, dto, actor)` records the organization's current `channelKeyVersion` through `DevicesService.recordProvisioning`; a scanned tag not on the contract is 409 `DEVICE_NOT_ON_CONTRACT` (MSG12); `swap` moves a failing reserved unit to `MAINTENANCE` through `failHandoverCheck` and reserves another `AVAILABLE` unit of the variant in the same transaction
  - **Test**: swap with no spare unit holds the handover and changes nothing
  - _Requirements: REQ-EVT-04, REQ-EVT-06, REQ-ERR-07, FR-DEV-05, BR-09_
  - _Story: US-UC14_
- [ ] 2.4 Handover with signed note (owner LongLP)
  - **Files**: `handover.service.ts`, `handover-note.renderer.ts`
  - **Do**: preview PDF; `complete(id, dto, actor)` refuses before the start date (409 `BEFORE_START_DATE`), without the first payment (`BalanceService.firstPaymentConfirmed`, 409 `FIRST_PAYMENT_MISSING`), unprovisioned or failing devices (`DEVICE_NOT_PROVISIONED`, `DEVICE_CHECK_FAILED`, `LOW_BATTERY`), a signer who is not the Manager (400 `SIGNER_NOT_MANAGER`) or no signature (409 `NOTE_NOT_SIGNED`); stamps the drawn signature into the PDF, stores it under `HANDOVER_NOTE_STORAGE_DIR` with its SHA-256, sets `handedOverAt` on each row, moves devices to `RENTED` and the contract to `ACTIVE` in one transaction (MSG06); the note download re-checks the SHA-256; body limit `RENTALS_HANDOVER_BODY_LIMIT`
  - **Test**: AC-02; a tampered stored PDF fails the download check
  - _Requirements: REQ-EVT-05, REQ-UBI-05, REQ-ERR-04, REQ-ERR-08, AC-02, FR-CON-05, FR-CON-06, BR-09_
  - _Story: US-UC20, US-UC21_
- [ ] 2.5 Holder labels (owner LongLP)
  - **Do**: set or clear a label on a handed-over device by a member of the renting organization; emit `device.labelChanged`; closing erases every label
  - **Test**: AC-07
  - _Requirements: REQ-EVT-15, AC-07, FR-CON-14, BR-33_
  - _Story: US-UC25_

## Phase 3: Terms and end of contract (MF-05)

- [ ] 3.1 Notice and term rollover (owner LongLP)
  - **Files**: `backend/src/modules/rentals/jobs/term-rollover.job.ts`, `contracts.service.ts`
  - **Do**: notice on an `ACTIVE` monthly contract moves it to `ENDING` with `endsAt` at the term end (MSG18); a day plan refuses notice (409 `DAY_PLAN_NO_NOTICE`); `rentals.termRollover` (daily at `rentals.termRolloverHourLocal`, hourly catch-up) closes ended terms and opens the next with its invoice, or moves `ENDING` to `RETURN_DUE`; day plans past their end go to `RETURN_DUE`, and straight to `RETURNED` when every device is back or lost
  - **Test**: AC-03; a re-run after downtime closes each term once
  - _Requirements: REQ-EVT-07, REQ-EVT-08, REQ-EVT-09, REQ-ERR-06, REQ-UBI-03, AC-03, FR-CON-07, FR-CON-08, FR-CON-09, FR-CON-10, BR-05 to BR-08_
  - _Story: US-UC23, US-UC24_
- [ ] 3.2 Overdue, default, reminders (owner LongLP)
  - **Files**: `jobs/overdue-and-default.job.ts`, `jobs/reservation-reminders.job.ts`
  - **Do**: `RETURN_DUE` past `returnDueAt` plus `rentals.returnGraceHours` with devices out to `OVERDUE`; `OVERDUE` for `rentals.defaultAfterDays` to `DEFAULTED` and `OrganizationsService.suspendForDefault`; one reminder per approved contract past `reservationExpiresAt`; `RETURN_DUE`, `OVERDUE` and `DEFAULTED` contracts stay visible and routed to the organization
  - **Test**: AC-04 and AC-05 with a fake clock; reminder sent once
  - _Requirements: REQ-EVT-13, REQ-EVT-14, REQ-STA-02, AC-04, AC-05, FR-CON-12, BR-26, BR-32_
  - _Story: US-UC50_

## Phase 4: Return, replacement and close

- [ ] 4.1 Check-in (owner LongLP)
  - **Files**: `backend/src/modules/rentals/return.service.ts`
  - **Do**: accepted only in the states of REQ-STA-01; mark the row `checkedInAt`, `DevicesService.markReturned`, `ChargesService.chargeLate` past the grace, emit `device.checkedIn`; a `RETURN_DUE`, `OVERDUE` or `DEFAULTED` contract moves to `RETURNED` once every device is back or lost (MSG07)
  - **Test**: check-in refused on a running monthly `ACTIVE` contract; late line count per device
  - _Requirements: REQ-EVT-10, REQ-STA-01, FR-MON-08, FR-BILL-03_
  - _Story: US-UC43_
- [ ] 4.2 Inspection orchestration (owner LongLP)
  - **Do**: `inspect(id, deviceId, dto, actor)`: `DevicesService.recordInspection` and, for `DAMAGED`, `ChargesService.chargeDamage` in the same transaction, unless the contract is `CLOSED`; reset-before-inspection is enforced by devices (409 `RESET_REQUIRED`)
  - **Test**: a damaged inspection creates the damage line in the same transaction
  - _Requirements: REQ-EVT-11, FR-BILL-04, UC-44_
  - _Story: US-UC44_
- [ ] 4.3 Replacement on a running contract (owner LongLP)
  - **Files**: `backend/src/modules/rentals/replacement.service.ts`
  - **Do**: `replace(id, deviceId, dto, actor)` on `ACTIVE` or `ENDING`: check in the faulty unit when present (or require an open loss case through `DevicesService.openLossForReplacement`), `reserveExplicit` an `AVAILABLE` unit of the same variant, provision it at the current key version, store the signed replacement note with its SHA-256, insert a `ContractDevice` with `replacesId` and `handedOverAt`, `markRented`; plan, variant and quantity unchanged
  - **Test**: replacement leaves the live-row count equal to the quantity; replacing on `RETURN_DUE` refused
  - _Requirements: REQ-EVT-12, REQ-UBI-03, FR-CON-15, BR-05, BR-41_
  - _Story: US-UC61_
- [ ] 4.4 Close (owner LongLP)
  - **Do**: `close(id, dto, actor)` on `RETURNED`: `BalanceService.outstanding` and pending damage approvals (409 `BALANCE_OUTSTANDING`), every `CONTRACT_CLOSE_CHECKS.blockingReason` (409 `OPEN_INCIDENTS`, MSG29); erase labels; `CLOSED`
  - **Test**: AC-06 and AC-07
  - _Requirements: REQ-ERR-05, AC-06, FR-CON-13, BR-27_
  - _Story: US-UC51_
- [ ] 4.5 Services for other modules (owner LongLP)
  - **Do**: `custodyAt(deviceId, at, marginSeconds)` with the `nearBoundary` flag, `currentHolder`, `visibleDevices(ctx)`, `rentalPeriods`, `contractsOfDevice`, `statusOf`, `utilization(range)` per design §6
  - **Test**: `custodyAt` at an interval start, end, inside a replacement chain and outside every interval
  - _Requirements: D-040, design §6_
  - _Story: US-UC26 (attribution side), US-UC60 (custody side)_

## Phase 5: Query / Retrieval

- [ ] 5.1 Contracts list, detail and transitions (owner LongLP)
  - **Do**: list with status, plan and organization filters (members see their own); detail with rows, terms and balance summary; transitions
  - **Test**: a member reading another organization's contract gets 404
  - _Requirements: FR-AUTH-11_
  - _Story: US-UC55_

## Phase 6: API Presentation Layer

- [ ] 6.1 `ContractsController` (owner LongLP)
  - **Do**: api-design 01 to 18 with each file's permission and `@ResponseMessage`
- [ ] 6.2 E2E (owner LongLP)
  - **Files**: `backend/test/rentals.e2e-spec.ts`, `backend/test/tenancy.e2e-spec.ts`
  - **Do**: every Validation row of api-design 01 to 18; AC-01 to AC-07; the 50 parallel approvals of the non-functional table
  - _Requirements: AC-01 to AC-07_

## Phase 7: Frontend Integration

- [ ] 7.1 Manager: request with quote, contracts, notice, holder labels, loss report; Staff: approval queue, counter handover with signature pad, check-in by scan, inspection, replacement (owner LongNN, tracked in `specs/frontend/tasks.md` 5.1 to 5.5)

## Phase 8: Verification & DoD

- [ ] 8.1 Suite green; lint, boundary check, typecheck clean; `api-design/*.md` matching behaviour (owner LongLP)
