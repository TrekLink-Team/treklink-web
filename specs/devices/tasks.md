# Implementation Tasks: devices

> Rewritten 2026-10-18 (D-051) in the full task format of `specs/README.md` §6; covers loss cases and
> disposal (D-045) and periodic maintenance (D-047). Fulfills `design.md`; endpoints are `api-design/01`
> to `26`.

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
  - **Partly done** (2026-10-31, KhoaDD under D-078): everything in the `Do` line is built except the compliance link of a suspected theft or fraud. `openOrLinkComplianceCase` stays on the no-op port `LOSS_ORGANIZATION_ACTIONS` (`NoOpLossOrganizationActions` in `devices.module.ts`); the provider to add is `organizations` (task 2.10, `ComplianceCasesService`), bound in `devices.module.ts`. Until then the case records `suspectedTheft` and `policeReference` and no compliance case opens. The box stays open for that part. Built: `loss-cases.service.ts`, `loss-cases.repository.ts`, `loss-cases.controller.ts` and `jobs/loss-search.job.ts` serve api-design 17 to 22 and the new 27 (`GET /api/loss-cases/:id`) under the new permissions `lossCase.read`, `.read.own`, `.report`, `.report.own`, `.operate` and `.decide` (forward migration `20261031120100_permission_loss_case`). Report from the six in-service states (an Org Manager only for a device its organization holds now, 404 otherwise), 409 `LOSS_CASE_OPEN` (new code) from the read and from the one-open-case index; triage through `CUSTODY_RESOLVER` at `lastSeenAt`, or `reportedAt` when the unit was never heard; confirm by Staff or the hourly `devices.lossSearch` job, with the remaining value from `DevicesService.valueAt` for RENTER custody and every `LOSS_CASE_LISTENERS.onConfirmed`; settle by an Admin other than the triager (403 `SEPARATION_OF_DUTY`) with every `onSettled`, then `LOST` to `RETIRED`; recover to `RETURNED` (after settlement from `RETIRED`, the case stays `SETTLED`). Every write is a compare-and-set on state and version with one `DeviceTransition` row (`refType` `LOSS_CASE`); audit and the Staff and organization emails go out after commit. The case stores the custody interval's `contractId` and `organizationId` (migration `20261031120000_loss_case_custody_contract`, design §3). `openOrLinkComplianceCase` goes through the new port `LOSS_ORGANIZATION_ACTIONS`, bound to a no-op default until organizations exports it; `ChannelKeyService.markKeyExposed` is called directly in the triage transaction (after TK-120 merged, 2026-10-31), and the Managers hear of it from organizations. Unit-tested and on Postgres in `test/loss-cases.db-spec.ts`: AC-05 to AC-08, the job and a manual confirm racing confirm the case once with one `LOSS` line, and the routes over HTTP with the new permissions. The custody reads of report and triage run in the caller's transaction (`CUSTODY_RESOLVER.custodyAt(deviceId, at, tx)`, review of #228), and a recovery before settlement leaves the custody interval open until check-in (design §2.1, on Postgres)
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

## Phase 4: API Presentation Layer

- [ ] 4.1 Controllers (owner KhoaDD)
  - **Note** (2026-10-28): LongLP served api-design 06 `GET /api/devices` minimally for the replacement of rentals 4.3: `device.read`, filters `status` (repeatable), `hardwareVariantId` and `q` on the asset tag, ordered by asset tag; the last position is not in the answer yet. `DevicesService.takeForReplacement` and `hasOpenLossCase` came with it
  - **Note**: LongLP added `devices.controller.ts` with api-design 24 `GET /api/devices/availability` (`readAvailability` on Device, Staff, Admin and Org Manager) for screen 5.3, counts per active variant from `DevicesRepository.availability`; the other endpoints join with this task
  - **Files**: `variants.controller.ts`, `devices.controller.ts`, `maintenance.controller.ts`, `loss-cases.controller.ts`, `stock-takes.controller.ts`
  - **Do**: api-design 01 to 26 with each file's permission and `@ResponseMessage`; `GET /api/devices/availability` declared before `GET /api/devices/:id`
  - **Progress** (2026-10-30, D-078 chain 3): `variants.controller.ts` serves api-design 01, `GET /api/hardware-variants` (`hardwareVariant.read` for TrekLink Staff and Admin, `hardwareVariant.read.org` for the Org Manager); `includeInactive` is honoured only for an Admin caller. `devices.controller.ts` gained `POST /api/devices` (api-design 05, `device.register`). Open for this task: `maintenance.controller.ts`, `loss-cases.controller.ts`, `stock-takes.controller.ts` endpoints not yet listed above, and the rest of 01 to 04, 16 to 26
- [ ] 4.2 E2E (owner KhoaDD)
  - **Files**: `backend/test/devices.e2e-spec.ts`, `backend/test/tenancy.e2e-spec.ts`
  - **Do**: every Validation row of api-design 01 to 26; the reservation race; the four maintenance constraints
  - _Requirements: AC-01 to AC-12_

## Phase 5: Frontend Integration

- [ ] 5.1 Staff fleet pages: variants with service plans, register, intake, maintenance with the week's list, Admin cost approvals, reset, loss cases, disposal, stock-take (owner LongNN, tracked in `specs/frontend/tasks.md` 4.1 to 4.5)

## Phase 6: Verification & DoD

- [ ] 6.1 Suite green; lint, boundary check, typecheck clean; `api-design/*.md` matching behaviour (owner KhoaDD)
