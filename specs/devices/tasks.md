# Implementation Tasks: devices

> Rewritten 2026-10-18 (D-051) in the full task format of `specs/README.md` §6; covers loss cases and
> disposal (D-045) and periodic maintenance (D-047). Fulfills `design.md`; endpoints are `api-design/01`
> to `29` (28 and 29 for the firmware flash, Phase 8) and `30` to `32` for the device connector (Phase 10).

| | |
|---|---|
| Lane owner | KhoaDD (roadmap §5.1, remapped 2026-10-18) |
| Reviewer | LongLP |
| Sprint | 3 (W7 to W8) for Phases 1 to 2.6 and the MF-01 endpoints; 5 (W11) for loss cases, disposal and maintenance cost approval |
| Stories | US-UC11, US-UC12, US-UC13, US-UC14 (provisioning record), US-UC43 (`markReturned`), US-UC44, US-UC49, US-UC52, US-UC53, US-UC54, US-UC60, US-UC62, US-UC64, US-UC65 |
| Depends on | platform 2.5 to 2.8; auth 4.2 |
| Unblocks | rentals 2.2 (reserve), gateway-sync 2.3 (projection), billing 2.6 (`valueAt`) |

## Phase 1: Foundation & Domain Modeling

- [ ] 1.1 `DevicesModule` and repositories (owner KhoaDD)
  - **Files**: `backend/src/modules/devices/devices.module.ts`, `devices.repository.ts`, `variants.repository.ts`, `loss-cases.repository.ts`, `maintenance.repository.ts`
  - **Do**: repositories over the `// @module devices` models only; every service method that may join a caller's transaction takes `tx?`
  - **Progress**: `DevicesModule`, `DevicesRepository` and `DevicesService` exist with the projection side ingestion needs (2.5); `variants.repository.ts`, `loss-cases.repository.ts` and `maintenance.repository.ts` join with 2.1, 2.7 and 2.8
  - **Note**: a read-only `DevicesService.variants(activeOnly, tx?)` (id, code, name, active flag) was added by LongLP for billing api-design 01 and rentals api-design 01, in `DevicesRepository` for now; it moves to `variants.repository.ts` when this task builds it. The optional transaction keeps the active-variant check on the contract request's own connection
  - _Requirements: REQ-UBI-04, NFR-MNT-01_
- [ ] 1.2 `DeviceLifecycle` (owner KhoaDD)
  - **Files**: `backend/src/modules/devices/device-lifecycle.ts`
  - **Do**: the transition table of design §2 with manual and system rows; manual endpoints may only use manual rows; compare-and-set on `version`, one `DeviceTransition` row with actor or `SYSTEM` and reason; other pairs 409 `INVALID_STATE_TRANSITION`
  - **Test**: `device-lifecycle.spec.ts` over all 81 pairs of the nine states (AC-01)
  - _Requirements: REQ-UBI-01, REQ-STA-01, AC-01, FR-DEV-01, BR-10_
- [x] 1.3 Identity helpers and remaining value (owner KhoaDD)
  - **Files**: `backend/src/modules/devices/node-id.ts`, `remaining-value.ts`
  - **Do**: `nodeId` (`!` plus 8 hex) to and from `nodeNum`; `valueAt(deviceId, date)` from the variant's depreciation schedule and the acquisition date
  - **Test**: round trip of `nodeId`; `valueAt` at acquisition, mid-schedule and past the last step
  - _Requirements: REQ-EVT-01, FR-BILL-05_
- [x] 1.4 Loss-case ports (owner KhoaDD)
  - **Files**: `backend/src/modules/devices/ports/custody-resolver.port.ts`, `loss-case-listener.port.ts`
  - **Do**: declare `CUSTODY_RESOLVER` and the multi-provider `LOSS_CASE_LISTENERS` exactly as design §3; `CUSTODY_RESOLVER` is required (Nest fails at boot without a provider), `LOSS_CASE_LISTENERS` is injected `@Optional()` as an array
  - **Note** (2026-10-28): LongLP declared `LOSS_CASE_LISTENERS`, `LossCaseListener` and `LossCaseView` in `ports/loss-case-listener.port.ts`, exported from `index.ts`, for billing 2.6. `LossCaseView` carries the custody interval CUSTODY_RESOLVER found at triage (`custodyContract`), because billing cannot read rentals. Open for this task: `CUSTODY_RESOLVER`, and the multi-provider wiring that collects the billing and rentals listeners under the token
  - **Progress** (2026-10-30, D-078 chain 3): `DevicesModule` now provides `LOSS_CASE_LISTENERS` as the one array (`useFactory: () => []`, since Nest has no native multi-provider), exported for `billing` and `rentals` to inject. `registerLossCaseListener` (the port file) adds a listener once; `LossCaseNotifier` calls every registered listener's `onConfirmed` and `onSettled` in registration order, inside the caller's transaction. `BillingLossCaseListener` now implements `OnModuleInit` and registers itself at boot, so billing 2.6 is wired end to end on the devices side (unit-tested both sides). Open for this task: `CUSTODY_RESOLVER`; the rentals listener registers the same way once rentals 1.3 builds it. The loss-case flow itself (confirm, settle) is task 2.7, not built yet, so nothing calls the notifier in production code until then
  - **Progress** (2026-10-30, resumed after the crash): `ports/custody-resolver.port.ts` declares `CUSTODY_RESOLVER` and the `CustodyResolver` interface exactly as design §3, exported from `index.ts`. No consumer injects it yet, task 2.7 (loss cases) is the first one that will, so there is nothing to bind a provider to and Nest does not fail at boot on this branch; the comment on the port file carries the intended `rentals` provider shape (`useExisting: ContractsService`) for whoever builds 2.7 or rentals 1.3's registration. Task 1.4 is complete as scoped by the `Do` line; the remaining `CUSTODY_RESOLVER` provider wiring belongs to the consuming tasks.
  - **Note** (2026-10-30, LongLP, rentals 1.3, TK-187): `rentals` now provides `CUSTODY_RESOLVER` (`RentalsCustodyResolver`, from the global `RentalsPortsModule`, since a `useExisting: ContractsService` in `RentalsModule` would not be visible to `DevicesModule`) and adds `RentalsLossCaseListener` to the `LOSS_CASE_LISTENERS` array, so task 2.7 can inject both.
  - _Requirements: design §3, platform design §2.1, REQ-EVT-14_

## Phase 2: Core Service Logic

- [ ] 2.1 Hardware variants with service plans (owner KhoaDD)
  - **Files**: `backend/src/modules/devices/variants.service.ts`
  - **Do**: create, edit, delete; sensor flags and deletion refused while devices exist (409 `VARIANT_IN_USE`); depreciation schedule validated (400 `SCHEDULE_INVALID`); `serviceIntervalDays` with at least one checklist item (400 `CHECKLIST_REQUIRED`); `firmwareBaseline`
  - **Test**: each guard; deleting an unused variant succeeds
  - _Requirements: REQ-STA-02, REQ-ERR-10, FR-DEV-04_
  - _Story: US-UC13_
- [ ] 2.2 Registration and intake checks (owner KhoaDD)
  - **Files**: `backend/src/modules/devices/devices.service.ts`, `intake.service.ts`
  - **Do**: `register(dto)` creates `IN_INTAKE`; asset tag and `nodeNum` unique across every device ever registered (409 `CONFLICT_UNIQUE`, MSG10) and immutable; `recordIntake(id, dto)` requires GPS, radio, battery and, for a motion-sensor variant, motion (400 `MOTION_RESULT_REQUIRED`); pass moves `IN_INTAKE` or `MAINTENANCE` without an open record to `AVAILABLE` and sets the first `serviceDueAt`; fail opens a record and moves to `MAINTENANCE`
  - **Test**: AC-03; first pass sets `serviceDueAt`, a later pass does not move it
  - **Progress** (2026-10-30, D-078 chain 3): `intake.service.ts` serves api-design 09 (`device.operate`): GPS, radio, battery and motion for a motion variant (400 `MOTION_RESULT_REQUIRED`), 409 `MAINTENANCE_OPEN` and `STALE_VERSION`; a pass moves `IN_INTAKE` or `MAINTENANCE` to `AVAILABLE` and sets the first `serviceDueAt`, a failure opens an `INTAKE_FAILED` record; a `DeviceTransition` row is written. `IntakeService.register` now serves api-design 05: the asset tag and node number (or a node id such as `!a4b1c2d3`) unique across every device ever registered (409 `CONFLICT_UNIQUE`), the variant active, the acquisition date not in the future; creates the unit `IN_INTAKE` with one registration transition. The node number is typed by Staff for now; Web Serial docking (D-080) is a separate chain. Unit-tested (intake and registration). Open: nothing for this task
  - _Requirements: REQ-UBI-02, REQ-EVT-01, REQ-EVT-02, REQ-EVT-18, REQ-ERR-01, REQ-ERR-04, AC-03, FR-DEV-02, FR-DEV-03, FR-DEV-17_
  - _Story: US-UC11, US-UC12_
- [ ] 2.3 Methods for `rentals` (owner KhoaDD)
  - **Do**: the design §3 methods: `reserve(variantId, quantity, contractId, tx)` with `FOR UPDATE SKIP LOCKED`, all or none (409 `INSUFFICIENT_DEVICES`); `reserveExplicit`; `release`; `failHandoverCheck`; `recordProvisioning(deviceId, orgId, keyVersion, actor, tx)` storing only the key version; `assertReadyForHandover(ids, keyVersion)` (409 `DEVICE_NOT_PROVISIONED`, `KEY_VERSION_MISMATCH`); `markRented`; `markReturned`; `openLossForReplacement`; `availability(variantId?)`
  - **2026-10-30**: the existing `reserve` and repository query accept optional explicit device IDs for rentals api-design 04. They retain variant and AVAILABLE filters, parameterized IDs, row locks and all-or-none updates. Automatic selection is unchanged
  - **Test**: the reservation race with two transactions on Postgres; provisioning never stores a key
  - **Note**: LongLP built a first `reserve(variant, quantity, at, tx)` for rentals 2.2 (MF-01 demo, 2026-10-26): `FOR UPDATE SKIP LOCKED` on the longest-unchanged `AVAILABLE` units, all or none with 409 `INSUFFICIENT_DEVICES` (MSG11); `release(ids, at, tx)` returns `RESERVED` units to `AVAILABLE`; `countAvailable(variantId)` and `assetTags(ids)` are reads. They live in `DevicesRepository` and write no `DeviceTransition` row yet; the signature takes the variant code for MSG11 instead of the contract id. Rework them into this task's shape when 1.2 and 2.3 are built. For the counter handover (rentals 2.3, 2.4, 2026-10-27) LongLP added `recordProvisioning({ deviceId, organizationId, keyVersion, actorId }, at, tx)`, which writes a `DeviceProvisioning` row and sets `keyVersion`, `keyOrganizationId` and `provisionedAt` on the unit, never a key; `provisioning(ids, tx)`, the read `complete` checks against the organization's current version; `failHandoverCheck` (`RESERVED` to `MAINTENANCE`) and `markRented` (`RESERVED` to `RENTED`); and an optional `tx` on `assetTags`. `assertReadyForHandover` lives in `HandoverService` for now. None writes a `DeviceTransition` row yet (leader ruling 2026-10-27, issue #87 point 2: keep them for Review 2; KhoaDD adds the `DeviceTransition` rows and the contract-id signature in 2.3)
  - **2026-10-30** (KhoaDD under D-078, rentals 2.6): `clearProvisioning(deviceId, tx)` undoes a record before the handover (rentals api-design 19): `keyVersion`, `keyOrganizationId` and `provisionedAt` back to null and the device `version` increased; the append-only `DeviceProvisioning` row stays. Unit-tested (`devices.provisioning.spec.ts`)
  - _Requirements: REQ-UBI-03, REQ-EVT-03, REQ-EVT-04, REQ-EVT-05, REQ-STA-01, FR-DEV-05, FR-CON-03, BR-03, BR-09_
  - _Story: US-UC14, US-UC43_
- [ ] 2.4 Reset, inspection, retirement (owner KhoaDD)
  - **Do**: `reset(id, steps)` on `RETURNED` with all three steps (400 `RESET_INCOMPLETE`), clears key version and key organization; `recordInspection(deviceId, dto, contractDeviceId, actor, tx)` requires a reset after the last check-in (409 `RESET_REQUIRED`); `PASSED` to `AVAILABLE`, or to `MAINTENANCE` with a `SCHEDULED` or `FIRMWARE_UPDATE` record when due within `devices.maintenanceLeadDays` or off the baseline; `DAMAGED` and `FAILED` to `MAINTENANCE`; `retire(id, reason)` from `MAINTENANCE` only
  - **Test**: AC-02; AC-10 inspection routing; retire from `AVAILABLE` refused
  - **Progress** (2026-10-30, D-078 chain 3): `recordInspection` now routes a `PASSED` unit due within `devices.maintenanceLeadDays`, or off the firmware baseline, to `MAINTENANCE` with a `SCHEDULED` or `FIRMWARE_UPDATE` record (REQ-EVT-07), and opens an `INSPECTION_FAILED` record for `DAMAGED` and `FAILED`; each writes a `DeviceTransition` row. Open: `retire`, unit tests for the routing
  - **Partly done** (2026-10-30, KhoaDD under D-078): `retire(id, dto, actor, at, tx)` from `MAINTENANCE` only (409 `INVALID_STATE_TRANSITION` elsewhere, 409 `STALE_VERSION` on a stale `expectedVersion`), with a `DeviceTransition` row, served as `POST /api/devices/:id/retire` (api-design 16, `device.retire`); refused with 409 `MAINTENANCE_OPEN` while a maintenance record is open (leader ruling 2026-10-30); unit-tested in `devices.lifecycle.spec.ts` and `devices.controller.spec.ts`, retire from `AVAILABLE` refused included. Open: unit tests for the inspection routing
  - **Note** (2026-10-28): LongLP built the part MF-05 needs, in this lane: `markReturned(ids, at, tx)` (`RENTED` to `RETURNED`); `reset(id, steps, actorId, at, tx)` on `RETURNED` with all three steps (400 `RESET_INCOMPLETE`), a `DeviceReset` row and the key version and key organization cleared, served as `POST /api/devices/:id/reset` (api-design 10, `device.operate`); `recordInspection(deviceId, input, actorId, at, tx)` that requires a reset after the last check-in (409 `RESET_REQUIRED`), writes the `Inspection` and moves `PASSED` to `AVAILABLE`, `DAMAGED` and `FAILED` to `MAINTENANCE`. Open for this task: the maintenance record and the `devices.maintenanceLeadDays` and firmware baseline routing, `retire`, and `DeviceTransition` rows (task 1.2)
  - **Partly done** (2026-10-30, KhoaDD under D-078): one reset per return, a unit reset since it became `RETURNED` is 409 `ALREADY_RESET` (api-design 10); `returnChecks(rows)` gives the return counter the first reset at or after each contract row's check-in and before the unit's next return, and the row's last inspection, served on rentals api-design 03 `devices[].resetAt` and `devices[].inspection` (demo smoke defect 4)
  - **Partly done** (2026-10-30, KhoaDD under D-078): the moves rentals drives (`reserve`, `release`, `failHandoverCheck`, `markRented`, `markReturned`, `takeForReplacement`) write one `DeviceTransition` row per unit moved in the same transaction, naming the contract (design §2); unit tests per move and `test/device-transitions.db-spec.ts`
  - _Requirements: REQ-EVT-06, REQ-EVT-07, REQ-EVT-10, REQ-ERR-02, REQ-ERR-03, AC-02, AC-10, FR-DEV-07, FR-DEV-09, FR-DEV-19, BR-04, BR-28_
  - _Story: US-UC44, US-UC53_
- [ ] 2.5 Projection for `gateway-sync` (owner KhoaDD)
  - **Do**: `projectReading(nodeNum, reading, tx)` updates `lastSeenAt`, battery and last position only for a newer reading, returns the device id or null; `byNodeNum`, `projections(ids)`, `trail(id)`
  - **Test**: an older reading is discarded
  - **Progress**: `projectReading`, `byNodeNum` and `projections` are built; the rule is one conditional `UPDATE` on `lastSeenAt` that skips only an older reading (a same-second position and telemetry both apply). `trail(id)` is the device's lifecycle history for `monitoring` api-design 07 (transitions, intake, provisioning, resets, inspections, maintenance), not a position trail, and ships with that endpoint
  - _Requirements: REQ-EVT-08, FR-DEV-06_
  - _Story: US-UC26 (projection side)_
- [ ] 2.6 Stock-take (owner KhoaDD)
  - **Files**: `backend/src/modules/devices/stock-take.service.ts`
  - **Do**: compare scanned asset tags with in-stock units, rented units heard within `devices.stockTakeSeenHours`, units confirmed by neither and unknown tags; store the run
  - **Test**: AC-04
  - _Requirements: REQ-EVT-12, AC-04, FR-DEV-10_
  - _Story: US-UC54_
- [ ] 2.7 Loss cases and disposal (owner KhoaDD)
  - **Files**: `backend/src/modules/devices/loss-cases.service.ts`, `jobs/loss-search.job.ts`
  - **Do**: report from any in-service state (Org Manager only for its rented device), one open case per device (409 `LOSS_CASE_OPEN`); triage asks the `CUSTODY_RESOLVER` port (`custodyAt(deviceId, lastSeenAt)`), records `RENTER` or `TREKLINK`, calls `ChannelKeyService.markKeyExposed(orgId, at, actor, tx)` of `organizations` for `RENTER` and `ComplianceCaseService.openOrLink` for suspected theft or fraud, sets `searchEndsAt` from `devices.lossSearchDays`; confirm by Staff or the hourly `devices.lossSearch` job calls every `LOSS_CASE_LISTENERS.onConfirmed` (billing charges `RENTER` custody); settle by an Admin who did not triage (403 `SEPARATION_OF_DUTY`) calls every `onSettled` (billing adjusts a reduction or waiver, rentals sets `lostAt`), device to `RETIRED`; recover to `RETURNED` (a `SETTLED` case stays `SETTLED`); dispose of a `RETIRED` device with the three wipe steps (400 `WIPE_INCOMPLETE`)
  - **Test**: AC-05 to AC-08; the job confirms a case once under a concurrent manual confirm
  - _Requirements: REQ-EVT-11, REQ-EVT-13, REQ-EVT-14, REQ-EVT-15, REQ-EVT-16, REQ-EVT-17, REQ-ERR-05, REQ-ERR-06, REQ-ERR-07, AC-05, AC-06, AC-07, AC-08, FR-DEV-12 to FR-DEV-16, BR-37, BR-38, BR-39, BR-42_
  - _Story: US-UC49, US-UC60, US-UC62_
  - _Depends on: 1.4, organizations 2.9 and 2.10; the port providers are rentals 1.3 and billing 2.6_
  - **Partly done** (2026-10-30, KhoaDD under D-078): disposal only. `dispose(id, dto, actor, at, tx)` on `RETIRED` with the three wipe steps (400 `WIPE_INCOMPLETE`), a `DeviceDisposal` row and a `DeviceTransition` row, served as `POST /api/devices/:id/dispose` (api-design 23) under the new permission `device.dispose` (forward migration `20261030130000_permission_device_dispose`); unit-tested in `devices.lifecycle.spec.ts` and `devices.controller.spec.ts`. Open: `loss-cases.service.ts` (report, triage, confirm, settle, recover) and the `devices.lossSearch` job
  - **Leader rulings** (2026-10-31): an organization caller's answer (api-design 17, 18 and 27) omits `suspectedTheft` and `policeReference`, TrekLink callers keep both (unit-tested in `loss-cases.service.spec.ts`); triage of a device never heard reads the custody at the report time (`reportedAt`), as built
  - **Leader rulings** (2026-10-31, second round): settlement pairs as built (`RENTER` custody charged, reduced or waived; `TREKLINK` written off). Custody is checked against the report time: when the rental of the last seen time was returned before the report, the custody at the report time counts (another rental, or `TREKLINK`), so a unit lost from `RETURNED` after check-in settles instead of the 409 the rentals listener gave on the closed interval. Unit-tested and on Postgres (`test/loss-cases.db-spec.ts`, the case failed on the previous rule)
  - **Partly done** (2026-10-31, KhoaDD under D-078): everything in the `Do` line is built, and the compliance link of a suspected theft was bound later (2026-11-02, TanNB, with organizations 2.10): `devices.module.ts` binds `LOSS_ORGANIZATION_ACTIONS` to `ComplianceCasesService.openOrLink` in place of the no-op, and `DevicesComplianceLossCases` provides `COMPLIANCE_LOSS_CASES` to organizations. Built: `loss-cases.service.ts`, `loss-cases.repository.ts`, `loss-cases.controller.ts` and `jobs/loss-search.job.ts` serve api-design 17 to 22 and the new 27 (`GET /api/loss-cases/:id`) under the new permissions `lossCase.read`, `.read.own`, `.report`, `.report.own`, `.operate` and `.decide` (forward migration `20261101180100_permission_loss_case`). Report from the six in-service states (an Org Manager only for a device its organization holds now, 404 otherwise), 409 `LOSS_CASE_OPEN` (new code) from the read and from the one-open-case index; triage through `CUSTODY_RESOLVER` at `lastSeenAt`, or `reportedAt` when the unit was never heard; confirm by Staff or the hourly `devices.lossSearch` job, with the remaining value from `DevicesService.valueAt` for RENTER custody and every `LOSS_CASE_LISTENERS.onConfirmed`; settle by an Admin other than the triager (403 `SEPARATION_OF_DUTY`) with every `onSettled`, then `LOST` to `RETIRED`; recover to `RETURNED` (after settlement from `RETIRED`, the case stays `SETTLED`). Every write is a compare-and-set on state and version with one `DeviceTransition` row (`refType` `LOSS_CASE`); audit and the Staff and organization emails go out after commit. The case stores the custody interval's `contractId` and `organizationId` (migration `20261101180000_loss_case_custody_contract`, design §3). `openOrLinkComplianceCase` goes through the new port `LOSS_ORGANIZATION_ACTIONS`, bound to a no-op default until organizations exports it; `ChannelKeyService.markKeyExposed` is called directly in the triage transaction (after TK-120 merged, 2026-10-31), and the Managers hear of it from organizations. Unit-tested and on Postgres in `test/loss-cases.db-spec.ts`: AC-05 to AC-08, the job and a manual confirm racing confirm the case once with one `LOSS` line, and the routes over HTTP with the new permissions. The custody reads of report and triage run in the caller's transaction (`CUSTODY_RESOLVER.custodyAt(deviceId, at, tx)`, review of #228), and a recovery before settlement leaves the custody interval open until check-in (design §2.1, on Postgres)
  - **Leader ruling** (2026-11-01, review of #228): the triage custody uses the interval of the last seen time only when it is the same rental as the interval at the report time, otherwise the custody at the report time, so a unit last heard outside any rental (only at provisioning) and with a renter at the report time is `RENTER` custody (REQ-EVT-14, design §2.1, D-040). Built in `LossCaseService.custodyOf` with four unit tests in `loss-cases.service.spec.ts` (heard only at provisioning, heard in an earlier rental, heard in the current rental, lost between rentals). `LossCaseView` now carries `decidedByRoles`, so the rentals listener audits the settling Admin with its roles (design §3).
- [ ] 2.8 Maintenance and the weekly service scan (owner KhoaDD)
  - **Files**: `backend/src/modules/devices/maintenance.service.ts`, `jobs/service-scan.job.ts`
  - **Do**: `open(id, dto)` on `AVAILABLE` with reason and expected date, refused for `RESERVED` and `RENTED`; `estimate()` above `devices.maintenanceApprovalThresholdVnd` sets `PENDING_APPROVAL` and notifies Admins; `decide()` by another Admin (403 `SEPARATION_OF_DUTY`) returns to `OPEN`; `complete()` refused while `PENDING_APPROVAL`, requires resolution and actual cost, every checklist result for `SCHEDULED` (400 `CHECKLIST_INCOMPLETE`), firmware for `FIRMWARE_UPDATE` (400 `FIRMWARE_VERSION_REQUIRED`), vendor name for `VENDOR` (400 `VENDOR_REQUIRED`); cost above the approved amount returns to `PENDING_APPROVAL`; `COMPLETED` moves `serviceDueAt` for `SCHEDULED` and writes `firmwareVersion`; `ServiceScanJob` registered as `devices.serviceScan` (Monday, `devices.serviceScanHourLocal`) per design §2.2, emailing Staff the list after commit
  - **Test**: with a fake clock, AC-09 to AC-12; the four maintenance constraints on Postgres
  - _Requirements: REQ-EVT-09, REQ-EVT-18, REQ-EVT-19, REQ-EVT-20, REQ-EVT-21, REQ-EVT-22, REQ-STA-03, REQ-STA-04, REQ-ERR-08, REQ-ERR-09, REQ-ERR-10, AC-09, AC-11, AC-12, FR-DEV-08, FR-DEV-17 to FR-DEV-21, BR-44, BR-45_
  - _Story: US-UC52, US-UC64, US-UC65_
  - **Progress** (2026-10-30, D-078 chain 3): `maintenance.repository.ts`, `maintenance.service.ts` and `maintenance.controller.ts` serve api-design 11 to 15: open (`device.operate`), estimate, complete or `UNREPAIRABLE`, list (`device.read`), and the Admin decision with the new permission `maintenance.decide` (forward migration `20261030120000_permission_maintenance_decide`). Smoke-tested through the API on the seed. Open: `ServiceScanJob`, the Admin notification on `PENDING_APPROVAL`, unit and Postgres tests. **Partly done** (2026-10-30, KhoaDD under D-078): a counter swap (`failHandoverCheck()`) now opens a `HANDOVER_CHECK_FAILED` record with the swap reason; before, the unit went to `MAINTENANCE` with no record and never appeared on screen 4.3

## Phase 3: Query / Retrieval

- [ ] 3.1 Lists (owner KhoaDD)
  - **Do**: devices with state, variant and search filters; device detail with transitions; maintenance records with state and due filters; loss cases (Org Manager sees own only); stock-take runs; availability counts (Org Manager gets counts only)
  - **Test**: paging; an Org Manager reading another organization's loss case gets 404
  - _Requirements: FR-DEV-11, FR-AUTH-11_
  - **Partly done** (2026-11-01, KhoaDD under D-078, D-092 rule 4): the device detail (api-design 07) carries `nextStep`, the unit's next step back to `AVAILABLE` (REQ-EVT-23) from `nextStepOf` in `next-step.ts`; `DevicesService.nextSteps(deviceIds)` gives `rentals` the same for the checked-in rows of a contract, and `openLossCases(deviceIds, tx)` the open loss case of each unit for the close check of rentals api-design 20. A passed inspection still makes the unit `AVAILABLE` with no intake (leader ruling 2026-11-01). Tests: `next-step.spec.ts`; on Postgres `test/return-close.db-spec.ts`

## Phase 4: API Presentation Layer

- [ ] 4.1 Controllers (owner KhoaDD)
  - **Note** (2026-10-28): LongLP served api-design 06 `GET /api/devices` minimally for the replacement of rentals 4.3: `device.read`, filters `status` (repeatable), `hardwareVariantId` and `q` on the asset tag, ordered by asset tag; the last position is not in the answer yet. `DevicesService.takeForReplacement` and `hasOpenLossCase` came with it
  - **Note**: LongLP added `devices.controller.ts` with api-design 24 `GET /api/devices/availability` (`readAvailability` on Device, Staff, Admin and Org Manager) for screen 5.3, counts per active variant from `DevicesRepository.availability`; the other endpoints join with this task
  - **Files**: `variants.controller.ts`, `devices.controller.ts`, `maintenance.controller.ts`, `loss-cases.controller.ts`, `stock-takes.controller.ts`
  - **Do**: api-design 01 to 26 with each file's permission and `@ResponseMessage`; `GET /api/devices/availability` declared before `GET /api/devices/:id`
  - **Progress** (2026-10-30, D-078 chain 3): `variants.controller.ts` serves api-design 01, `GET /api/hardware-variants` (`hardwareVariant.read` for TrekLink Staff and Admin, `hardwareVariant.read.org` for the Org Manager); `includeInactive` is honoured only for an Admin caller. `devices.controller.ts` gained `POST /api/devices` (api-design 05, `device.register`). Open for this task: `maintenance.controller.ts`, `loss-cases.controller.ts`, `stock-takes.controller.ts` endpoints not yet listed above, and the rest of 01 to 04, 16 to 26
  - **Partly done** (2026-11-01, KhoaDD under D-078): `devices.controller.ts` serves api-design 08 `PATCH /api/devices/:id`, the firmware edit the device page already called (it answered 404 before). Permission `device.operate`, the one of every other Staff write on a unit, so no new permission or migration; `UpdateDeviceDto` takes `firmwareVersion` and `expectedVersion` only, an identity field is refused by the whitelist (400); `DevicesService.updateFirmware` compares and sets on the version (409 `STALE_VERSION`), writes no transition, and the controller emits `audit.record device.update` with the version before and after, after commit. Unit-tested (`devices.firmware.spec.ts`, `devices.controller.spec.ts`) and over the stubbed HTTP pipeline (`test/devices.e2e-spec.ts`)
- [ ] 4.2 E2E (owner KhoaDD)
  - **Files**: `backend/test/devices.e2e-spec.ts`, `backend/test/tenancy.e2e-spec.ts`
  - **Do**: every Validation row of api-design 01 to 26; the reservation race; the four maintenance constraints
  - _Requirements: AC-01 to AC-12_

## Phase 5: Frontend Integration

- [ ] 5.1 Staff fleet pages: variants with service plans, register, intake, maintenance with the week's list, Admin cost approvals, reset, loss cases, disposal, stock-take (owner LongNN, tracked in `specs/frontend/tasks.md` 4.1 to 4.5)

## Phase 6: Verification & DoD

- [ ] 6.1 Suite green; lint, boundary check, typecheck clean; `api-design/*.md` matching behaviour (owner KhoaDD)

## Phase 7: Counter docking over Web Serial (D-080, D-082)

- [ ] 7.1 Contract changes in the catalog (owner KhoaDD)
  - **Files**: `scripts/specs/catalog.py`, `scripts/specs/endpoints/rentals.py`, regenerated `specs/rentals/api-design/03`, `09`, `21`, `specs/auth/permission-matrix.md`, a forward migration
  - **Do**: design §8.5: `devices[].nodeNum` on rentals 03; `nodeNum` and 409 `NODE_MISMATCH` on rentals 09 (optional only for the manual fallback, design §8.6 decision 3); the new channel-key endpoint (rentals 21) and its `contract.issueChannelKey` permission (D-082 decision 1)
  - _Requirements: REQ-EVT-26, REQ-ERR-12_
- [ ] 7.2 `meshtastic-dock.ts` adapter over the published Meshtastic packages (owner KhoaDD)
  - **Files**: `frontend/package.json` (`@meshtastic/core`, `@meshtastic/transport-web-serial`, pinned exact versions), `frontend/src/shared/lib/meshtastic-dock.ts`, tests beside it
  - **Do**: design §8.1 and §8.2; one adapter wrapping the npm packages (D-082 decision 3, vetting record adopted with the GPL-3.0 condition)
  - **Test**: fake `SerialPort` with timeout, disconnect, and a unit that never answers (mapped to the v2 message)
  - _Requirements: REQ-UBI-05, REQ-ERR-13, REQ-ERR-14_
- [ ] 7.3 `DockingService` and `useDocking` (owner KhoaDD)
  - **Files**: `frontend/src/features/dock-device/`
  - **Do**: `readUnit()`, `useDocking` calling rentals api-design 21 for the key, `provision(expected, key, keyVersion)` with the mismatch guard, the owner and channel writes inside one edit transaction, the restart wait and the read-back; key held for one call
  - **Test**: mismatch writes nothing; read-back mismatch records nothing; no key in storage or console after a run
  - _Requirements: REQ-EVT-25, REQ-ERR-12, REQ-ERR-13, AC-14, AC-16_
- [ ] 7.4 Handover screen (owner KhoaDD)
  - **Files**: `frontend/src/pages/CounterPage.tsx` step 1 (screen 5.4)
  - **Do**: Dock and provision, the Chromium banner, "Enter manually" fallback and the states of the ui-design file
  - _Requirements: REQ-ERR-11, AC-15_
- [ ] 7.4b Intake screen wiring (owner KhoaDD; treklink-web#124 has merged, so it is no longer deferred)
  - **Files**: Register panel of screen 4.2 (frontend 4.2)
  - **Do**: wire the self-contained Read-from-unit component of task 7.3 into the Register panel
  - _Requirements: REQ-EVT-24, AC-13_
- [ ] 7.5 Backend `nodeNum` check and channel-key endpoint (owner KhoaDD; a draft from 2026-10-30 is kept on a local branch, not merged)
  - **Files**: `backend/src/modules/rentals/handover.service.ts`, `handover.controller.ts`, the rentals 03 mapper, `backend/src/modules/organizations/channel-key.service.ts` (`deriveKey`), `backend/src/modules/platform/config/environment-variables.ts`, `backend/.env.example`, tests
  - **Do**: compare the docked `nodeNum` through `DevicesService` before `recordProvisioning` and before issuing the key; 409 `NODE_MISMATCH`; derive the key with `crypto.hkdfSync` from `CHANNEL_KEY_MASTER`; audit row without the key; `Cache-Control: no-store`
  - _Requirements: REQ-EVT-26, REQ-ERR-12, REQ-UBI-03_
- [ ] 7.6 Stage A uplink configuration on `DeviceDetailPage` (owner KhoaDD)
  - **Files**: `frontend/src/features/dock-device/` (`configureUplink`), screen 4.2 action and form, tests beside them
  - **Do**: design §8.8: one edit transaction (network, MQTT module, channel 0 uplink), the restart wait, reconnect prompt and read-back; nothing typed kept after the docking
  - **Test**: fake port: the transaction order, the values kept as read, the read-back mismatch and a unit that does not return
  - _Requirements: REQ-EVT-27, REQ-ERR-15, REQ-UBI-05, AC-18_

## Phase 8: Firmware flash from the maintenance page (design §9)

- [ ] 8.1 Firmware release workflow in `treklink-firmware` (owner KhoaDD, leader: workflow token scope)
  - **Do**: design §9.1: on a `v*-treklink.*` tag, build the three TrekLink environments and attach per variant the app image, the factory image and `treklink-manifest.json`
- [ ] 8.2 Backend release reader (owner KhoaDD)
  - **Files**: `backend/src/modules/devices/firmware-release.service.ts`, `firmware-releases.controller.ts`, parameters `devices.firmwareReleaseRepo` and `devices.firmwareReleaseCacheSeconds` (configuration matrix and seed), tests
  - **Do**: devices api-design 28 (`device.read`) and 29 (`device.operate`); SHA-256 check, MD5 returned with the image, 502 `FIRMWARE_IMAGE_TOO_LARGE` above 3 300 000 bytes raw; `Cache-Control: no-store` on 29; the three error codes in the enum
  - _Requirements: REQ-EVT-28, REQ-ERR-17, AC-20_
- [ ] 8.3 Flash panel on screen 4.3 (owner KhoaDD)
  - **Files**: `frontend/package.json` (`esptool-js` 0.7.1 pinned), `frontend/src/shared/lib/esp-flasher.ts` (one adapter), the panel in the maintenance feature, tests with a fake `ESPLoader`
  - **Do**: design §9.2 (modes, chip and MAC node-number checks, v2 notice and `romBaudrate`, MD5 from the backend for the verify with `flashMode`, `flashFreq` and `flashSize` kept, fill the record's firmware version)
  - _Requirements: REQ-EVT-28, REQ-ERR-16, REQ-ERR-17, AC-19, AC-20_

## Phase 9: Variant image and spec sheet (design §10, gap G1)

- [ ] 9.1 Schema, API and seed (owner TanNB)
  - **Files**: `backend/prisma/schema.prisma` (`HardwareVariant.imageUrl`, `specSheet`), a forward migration that also fills the verified seed values of design §10, the variants DTOs and service, tests
  - **Do**: devices api-design 01 to 03; validation with 400 `VARIANT_MEDIA_INVALID`; the shared variant summary on every unit payload (design §10, regenerate the catalogs it touches)
  - _Requirements: REQ-UBI-06, REQ-ERR-18, AC-21_
  - **Partly done 2026-11-03** (treklink-web#338, #334 part 2): schema, forward migration with the verified seed, the read of `imageUrl` and `specSheet` on api-design 01 and on the public plans, and the shared variant summary on the unit payloads (api-design 05 to 07, rentals 03 `devices[]`). Open: POST and PATCH validation with 400 `VARIANT_MEDIA_INVALID` (needs task 2.1) and the summary on the monitoring rows (their `hardwareVariant` is a code string that the map and the organization API read, so it needs a ruling)
- [ ] 9.2 Screens (owner TanNB)
  - **Files**: screen 4.1 panel fields and card preview; a shared `VariantCard` and spec summary used by screen 4.2, the contract home Devices tab and the request form's variant picker
  - **Do**: design §10 "Where it shows"; the labelled empty image slot when `imageUrl` is null; create `frontend/public/variants/` (empty until the leader supplies photos); map `VARIANT_MEDIA_INVALID` on screen 4.1
  - _Requirements: REQ-UBI-06, AC-21_
  - **Partly done 2026-11-03** (treklink-web#338, #334 part 2): shared `VariantCard`, spec summary and capability flags on screen 4.2, the contract home Devices tab and the request form picker, the labelled empty slot, `frontend/public/variants/`. Open: the screen 4.1 panel and the `VARIANT_MEDIA_INVALID` mapping (need task 2.1)


## Phase 10: Device connector, the Staff device hub (design §11)

Order of work (brief item 5): the contract home and CollectionView UI of `docs/design/2026-11-03-collectionview-and-layout.md`
first, then 10.6 and 10.7 (the panel), then 10.8 to 10.11 (register, quick swap and hot provisioning, uplink and
flash, the map pin). Tasks marked **needs Phase 7** build on `feat/devices-docking-frontend` (tasks 7.1 to 7.6),
which is not merged: they start once it merges into `dev`, or on a branch cut from it. The backend tasks 10.1 to
10.5 do not need it. Design §11.12 Q1 to Q7 were decided on 2026-11-04 (option A each); the hub is approved for building.

- [ ] 10.1 Parameter, error codes and the schema migration (owner KhoaDD)
  - **Files**: `scripts/specs/catalog.py` (`devices.dockPresenceTtlSeconds`, default 30, 10 to 300 seconds), `python3 scripts/specs/build_seed.py`, a forward migration for the parameter and for `DeviceDockSession` (§11.8, partial unique index on `deviceId` where `endedAt` is null), `backend/prisma/schema.prisma`, the error codes `DEVICE_PROVISIONED` and the devices use of `NODE_MISMATCH`
  - **Do**: design §11.8 "Where it lives" and "How long"; no new permission (api-design 30 is `device.read`, 31 and 32 are `device.operate`)
  - _Requirements: REQ-EVT-36_
- [ ] 10.2 Recognition endpoint and the `DEVICE_CONTRACTS` port (owner KhoaDD)
  - **Files**: `backend/src/modules/devices/ports/device-contracts.port.ts`, `devices.controller.ts` (`GET /api/devices/by-node`, declared before `:id`), `devices.service.ts` (`byNodes`), tests
  - **Do**: api-design 30 as §11.5: node ids normalized, at most 20 numbers, answer in request order, `device` null for an unknown number, the live contract through the port, the open dock session; organization callers 403
  - **Test**: known, unknown, retired and contracted units; an Org Manager gets 403 (AC-25)
  - _Requirements: REQ-UBI-07, REQ-EVT-30, AC-23, AC-25_
  - _Depends on: rentals 10.1 (the port provider)_
- [ ] 10.3 Dock sessions (owner KhoaDD)
  - **Files**: `backend/src/modules/devices/dock-session.service.ts`, `dock-session.repository.ts`, `jobs/dock-sweep.job.ts`, the two routes in `devices.controller.ts`, tests
  - **Do**: api-design 31 and 32 as §11.8: `nodeNum` check (409 `NODE_MISMATCH`), renew the caller's session or end another as `REPLACED`, end on DELETE (idempotent), the `devices.dockSweep` job every third of the TTL ending stale sessions `EXPIRED`; `dockedNow(deviceIds?)` for monitoring; emit `device.docked` and `device.undocked` after commit
  - **Test**: renewal, replacement, expiry with a fake clock, a DELETE with no session, AC-33 (the mismatch)
  - _Requirements: REQ-EVT-36, REQ-EVT-37, REQ-STA-05, REQ-ERR-27, AC-33_
  - _Depends on: 10.1_
- [ ] 10.4 Exchange endpoint (owner KhoaDD; built as rentals 10.1, rentals api-design 30)
  - **Do**: design §11.6
  - _Requirements: REQ-EVT-33, REQ-ERR-20, REQ-ERR-21, REQ-ERR-23, REQ-ERR-24_
  - _Depends on: rentals 10.1_
- [ ] 10.5 Docked units on the Staff map, server side (owner KhoaDD; built as monitoring 8.1)
  - **Do**: design §11.8 "Who can read it"; monitoring api-design 02 and the two stream types
  - _Requirements: REQ-EVT-37, REQ-STA-05_
  - _Depends on: 10.3, monitoring 8.1_
- [ ] 10.6 `ConnectorRegistry` (owner KhoaDD, **needs Phase 7**: 7.2 and 7.3)
  - **Files**: `frontend/src/features/device-connector/model/` (`ConnectorRegistry`, `Connection`, `useConnector`, `useConnectorContext`, `openConnector`), `frontend/src/shared/lib/meshtastic-dock.ts` (`openDock(port)` takes the hub's port; `grantedPort` removed), the fake `SerialPort` extended to several ports and to `connect` and `disconnect` events, tests
  - **Do**: design §11.2 and §11.4: one registry per tab; `getPorts()` on load and the `connect` event without the chooser; Connect a unit through the chooser; the state machine of Figure 18 with rows keyed by `nodeNum`; channel settings dropped after the handshake; one write lock; Unplugged kept 10 seconds; Forget; move `features/dock-device/` into the slice, and no `navigator.serial` outside `features/device-connector/` and `shared/lib/`
  - **Test**: two units at once, replug, a reboot that returns a new port with the same `nodeNum`, the write lock, the no-response and busy rows, no PSK, key or payload in storage, the query cache or the console (AC-22, AC-30, AC-32)
  - _Requirements: REQ-UBI-08, REQ-UBI-09, REQ-UBI-10, REQ-EVT-29, REQ-STA-06, REQ-ERR-22, REQ-ERR-25, AC-22, AC-30, AC-32_
- [ ] 10.7 Panel, device view and header button (owner KhoaDD, **needs Phase 7**)
  - **Files**: `frontend/src/features/device-connector/ui/` (`ConnectorPanel`, `DeviceView`, `ConnectorButton`), `actionsFor` with its table tests, `frontend/src/entities/device/api.ts` (`useDevicesByNode`), the shell mount in `widgets/AppShell/`, screen 4.6 (frontend task 4.6)
  - **Do**: design §11.2 and §11.3: rows as a `CollectionView` List, §10.8 placement, §9.5 tooltips, §10.6 strips; the device view with `/variants/<code>-detail.png` and the icon render in rows (Q5 A), the labelled slot on a missing render; the reason text on a row with no action; recognition batched every 300 ms; Staff and Admin only
  - **Test**: `actionsFor` over every row of the §11.3 table; AC-23, AC-25, AC-34; the panel at 1280, 900 and 360 px
  - _Requirements: REQ-UBI-07, REQ-EVT-30, REQ-EVT-32, REQ-EVT-38, REQ-ERR-26, REQ-ERR-29, AC-23, AC-34_
  - _Depends on: 10.2, 10.6; the contract home UI (brief item 5)_
- [ ] 10.8 Register on connect (owner KhoaDD, **needs Phase 7**: 7.4b)
  - **Files**: the Register panel of screen 4.2, `features/device-connector/actions/`
  - **Do**: "New device: register it?" opens the Register panel on `/t/fleet` filled from the row with no second chooser; Read from unit on the Register panel only opens the hub (REQ-EVT-39); the row is recognized after registration
  - **Test**: AC-24
  - _Requirements: REQ-EVT-31, REQ-EVT-39, AC-24_
  - _Depends on: 10.7_
- [ ] 10.9 Counter: quick swap and hot provisioning (owner KhoaDD, **needs Phase 7**: 7.3 and 7.4)
  - **Files**: `frontend/src/pages/CounterPage.tsx` (context and row entry points), `features/device-connector/actions/` (`exchangeAndProvision`), `entities/contract/api.ts` (`exchangeDevice`), tests
  - **Do**: design §11.6 and §11.7; the counter context of §11.3; a row's Dock opens the hub on its unit; on a mismatch offer the quick swap for that row (REQ-EVT-35); the confirmation dialog with the replaced unit (Q7 A); rentals api-design 30 then §8.4 steps 2 to 5 on the held connection; keep the contract `version` the exchange returns
  - **Test**: AC-26 to AC-29 with a fake port and a mocked API
  - _Requirements: REQ-EVT-33, REQ-EVT-34, REQ-EVT-35, REQ-ERR-19, REQ-ERR-20, REQ-ERR-21, REQ-ERR-23, REQ-ERR-24, AC-26, AC-27, AC-28, AC-29_
  - _Depends on: 10.4, 10.7_
- [ ] 10.10 Uplink and flash from the hub (owner KhoaDD, **needs Phase 7**: 7.6; flash needs 8.3)
  - **Files**: `features/device-connector/actions/` (`configureUplink`, `flashFirmware`), `shared/lib/esp-flasher.ts` (takes a port), the device page's Configure uplink and the maintenance page's Update as entry points only, tests
  - **Do**: design §11.7: uplink on the held connection; flash closes the Meshtastic session, hands the port to the flasher, reopens on the same `nodeNum` and reads the unit again; the step named on a failure
  - **Test**: AC-35 to AC-37 with fakes
  - _Requirements: REQ-EVT-39, REQ-EVT-40, REQ-EVT-41, REQ-ERR-28, AC-35, AC-36, AC-37_
  - _Depends on: 10.6, 10.7, 8.3_
- [ ] 10.11 Map pin, client side (owner KhoaDD)
  - **Files**: `features/device-connector/model/` (dock session heartbeat, `pagehide` with `keepalive`), the Staff `LiveMapPage` marker for `DOCKED` and `docked` (screen 9.1, with LongNN as reviewer), tests
  - **Do**: design §11.8: open, renew every third of `devices.dockPresenceTtlSeconds`, end; the pin "Docked at the counter" at `counterLocation`; drop it on `device.undocked`
  - **Test**: AC-31 with two browser contexts in Playwright
  - _Requirements: REQ-EVT-36, REQ-EVT-37, REQ-STA-05, AC-31_
  - _Depends on: 10.3, 10.5, 10.6_
- [ ] 10.12 Hardware run and the spec close-out (owner KhoaDD, with the leader at the bench)
  - **Do**: design §11.11 on v2 (treklink-firmware#27 image), v3 and v4: AC-22, AC-26, AC-27, AC-31, AC-37; record in §11.4 whether a port grant survives a browser restart and whether `SerialPort.forget()` exists on the counter's Chromium, and remove the two (unverified) marks or change the design
  - _Requirements: AC-22 to AC-37_
