# 2026-10-30 09:22 UTC: fleet and maintenance pages (MF-05 step 6)

KhoaDD under D-078, built by the leader's cloud agent. Branch `feat/fleet-maintenance-pages`,
stacked on PR #124 (`feat/devices-maintenance` at `350d0c6`), which is not merged into `dev` yet.

## Restack after #124 merges

```
git fetch origin dev
git rebase --onto origin/dev 350d0c6 feat/fleet-maintenance-pages
```

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

## Demo steps (after the #124 demo steps 1 to 5, contract RC-2026-0002)

As `staff@treklink.local`:

1. Devices: press the **Maintenance** chip; TL-0018 is listed (count beside the chip).
2. Open **TL-0018**; the open maintenance line ("Open, ...") links to `/t/maintenance`.
3. Records: TL-0018, Inspection failed, Open. **Estimate** shows the hint with 1,000,000 VND;
   Cancel. **Complete**: Completed, a resolution, actual cost
   `0` (any amount up to 1,000,000 VND, the seeded threshold, avoids the approval step), **Save**.
4. The notice says TL-0018 stays in maintenance until it passes an intake check; **Open TL-0018**.
5. **Record intake check**, every result passed; the status shows **Available**.
