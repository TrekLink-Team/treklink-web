# 2026-10-30 09:22 UTC: fleet and maintenance pages (MF-05 step 6)

KhoaDD under D-078, built by the leader's cloud agent. Branch `feat/fleet-maintenance-pages`.
Started stacked on PR #124 at `350d0c6`. #124 merged into `dev` (head `eb1b31e`, resealed by the
lead); this branch was restacked with
`git rebase --onto origin/dev 350d0c6 feat/fleet-maintenance-pages` (no conflicts) and
force-pushed with lease. It now sits on `eb1b31e`; no further restack is needed.

## Starting point

#124 already shipped `/t/fleet`, `/t/devices/:id`, `/t/maintenance` and
`/t/maintenance/approvals`, the device hooks in `entities/device/api.ts`, the routes, and
`built: true` for Devices and Maintenance in `navigation.ts`. Nothing was rebuilt; this branch
closes the gaps against screens 4.2 and 4.3.

## What was built

- `/t/fleet`: status chips (multi-select, kept in `?status=`) with a count each
  (`useDeviceStatusCounts`, devices api-design 06 `totalCount`, one cached request per chip),
  variant and search filters on a `Toolbar`, `DataTable` with paging and a card per device below
  768 px, "No devices registered yet." and MSG01, register opens the new device's page.
- `/t/maintenance`: status and reason filters with paging, text labels for reason and status
  (`MAINTENANCE_STATUS`, `MAINTENANCE_REASON` in `shared/ui/status.ts`), record detail drawer,
  Open maintenance with a picker of `AVAILABLE` devices, unrepairable confirmation, MSG36 with
  Reload, MSG29, the "stays in maintenance until it passes an intake check" notice after completion
  with a link to the device, "Due but still out" on the week's tab, wider invalidation.
- `fetchDevices` takes an optional `pageSize` (default 20, unchanged for existing callers).

## Checks (this session)

First pass, frontend only. `npm run lint` clean, `npm run typecheck` clean,
`FleetPage.test.tsx` 8, `MaintenancePage.test.tsx` 16, full suite 33 files, 443 tests passed.
Not walked in a browser: no database or seeded backend was run here.

## Spec changes

`specs/frontend/tasks.md`: 4.2 and 4.3 ticked with dated Done lines.

## Shared files touched

`frontend/src/shared/ui/status.ts` (two palettes added), `frontend/src/entities/device/api.ts`
(additive), and after the rulings `maintenance.controller.ts`, `maintenance.service.ts`,
`scripts/specs/endpoints/devices.py`, devices api-design 15 and `DeviceDetailPage.tsx`. No router,
navigation, module, error-code, catalog, migration or seed change.

## Leader rulings (2026-10-30) and what followed

1. **Approval threshold: add it now.** `MaintenanceService.approvalThresholdVnd()` reads
   `devices.maintenanceApprovalThresholdVnd` through `ParameterService` at request time; `GET
   /maintenance-records` returns the page plus `approvalThresholdVnd` (`MaintenanceRecordPage` in
   `maintenance.controller.ts`). No new endpoint, no migration, no permission change. The estimate
   hint reads "VND. Above 1,000,000 VND, an Admin must approve before completion." with the seeded
   value, and names the rule alone until the list has loaded.
2. **`dueBefore`: the spec follows the code.** `scripts/specs/endpoints/devices.py` now says
   `dueBefore` keeps records whose expected completion is on or before it, and lists records only;
   devices api-design 15 regenerated (only that file changed). The page keeps reading the due units
   still out from devices api-design 06.
3. **`DeviceDetailPage` open record link** shows the readable status ("Open, Antenna loose").

Screen 4.3 Data row for the threshold now names devices 15 `approvalThresholdVnd`.

## Checks after the rulings (this session)

- Backend: `npm run typecheck` clean; `npm run lint` 0 errors, 1 warning in
  `test/incidents.e2e-spec.ts` (not touched), module-boundary check passed (361 files, 9
  modules); `npx jest` 154 suites, 1688 tests passed, including the new
  `maintenance.controller.spec.ts` (3) and a service case for the threshold read. Database specs
  not run: no Postgres server here, and none covers this endpoint.
- Frontend: `npm run lint` and `npm run typecheck` clean; full suite 33 files, 446 tests passed
  (`MaintenancePage.test.tsx` 18, `DeviceDetailPage.test.tsx` 12).
- `scripts/specs/check_mermaid.py` did not run: it needs `scripts/srs/node_modules/.bin/mmdc`,
  absent here. The changed sequence line is `Svc->>DB: SELECT maintenance_records, parameters`.

## #124 review follow-ups (after the restack, one commit each)

- `b0484da` Retire writes `reason: 'RETIRED'` and the Admin's text in `note`;
  `insertTransition` takes an optional `note`; the lifecycle history reads `note` and shows
  "MAINTENANCE to RETIRED (Retired): <text>". No migration: `device_transitions.note` exists.
- `b753c8f` `RetireDeviceDto.reason` and `DisposeDeviceDto.method` are trimmed by `@Transform`
  before validation, so whitespace only fails `MinLength(1)` (400); controller spec cases.
- `8c2c73b` The controller answers one message per route whatever the outcome, so api-design 12,
  13 and 14 now read "Estimate recorded", "Maintenance cost decided" and "Maintenance updated"
  (source `scripts/specs/endpoints/devices.py`, regenerated). The controller is unchanged.
- `9749b83` Policy and message specs for every `MaintenanceController` route (device.operate,
  maintenance.decide, device.read), one transaction per mutation; `DeviceHistoryController` spec
  (device.read, paging).
- `9ebac1a` `deviceCount` added to `GET /hardware-variants` (devices ever registered on the
  variant, screen 4.1 "Registered units"), counted in the catalog query only. api-design 01
  already declared it.
- `0f9f422` One wording for `MAINTENANCE_OPEN`: "Finish the open maintenance record first." in
  retire, intake and open maintenance, both pages' MSG29, and api-design 09, 11, 16 (case "The
  device has an open maintenance record").
- `d1c8aac` `DeviceDetailPage` disables Retire while a record is open, with MSG29 beside it
  (`aria-describedby`).

## Checks after the follow-ups (this session)

- Backend: eslint 0 errors (1 warning in `test/incidents.e2e-spec.ts`, not touched),
  module-boundary check passed (366 files, 9 modules); `npx jest` 157 suites, 1737 tests passed.
- `tsc --noEmit` fails with one error that is on `dev` itself, verified on a clean `eb1b31e`
  worktree: `test/authority-reports.db-spec.ts(71,5)` calls `new DevicesService(repository)` with
  one argument, but #124 made the constructor take three. Not fixed here (another member's TK-148
  file, outside this task). Fix: pass `{} as never` twice more, as the devices specs do.
- Database specs on local Postgres 16: `prisma migrate deploy` applied every migration; `test:db`
  10 of 11 suites, 73 tests passed; `authority-reports.db-spec.ts` fails to compile for the reason
  above.
- Frontend: lint and typecheck clean; 33 files, 447 tests passed.

## Demo steps (after the #124 demo steps 1 to 5, contract RC-2026-0002)

As `staff@treklink.local`:

1. Devices: press the **Maintenance** chip; TL-0018 is listed (count beside the chip).
2. Open **TL-0018**; the open maintenance line ("Open, ...") links to `/t/maintenance`.
3. Records: TL-0018, Inspection failed, Open. **Estimate** shows the hint with 1,000,000 VND;
   Cancel. **Complete**: Completed, a resolution, actual cost
   `0` (any amount up to 1,000,000 VND, the seeded threshold, avoids the approval step), **Save**.
4. The notice says TL-0018 stays in maintenance until it passes an intake check; **Open TL-0018**.
5. **Record intake check**, every result passed; the status shows **Available**.
