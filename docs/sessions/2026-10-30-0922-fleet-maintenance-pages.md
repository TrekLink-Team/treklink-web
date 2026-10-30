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

Frontend only; no backend file changed. `npm run lint` clean, `npm run typecheck` clean,
`FleetPage.test.tsx` 8, `MaintenancePage.test.tsx` 16, full suite 33 files, 443 tests passed.
Not walked in a browser: no database or seeded backend was run here.

## Spec changes

`specs/frontend/tasks.md`: 4.2 and 4.3 ticked with dated Done lines.

## Shared files touched

`frontend/src/shared/ui/status.ts` (two palettes added), `frontend/src/entities/device/api.ts`
(additive). No router, navigation, module, error-code, catalog, migration or seed change.

## Open decisions

1. **Approval threshold beside the estimate** (screen 4.3 Data row). `GET /parameters` needs
   `manage Parameter`, so Staff cannot read `devices.maintenanceApprovalThresholdVnd`. Options:
   (a) keep the hint naming the rule without the amount (current); (b) add the threshold to the
   maintenance list response (devices api-design 15, generated from `scripts/specs/endpoints/devices.py`);
   (c) add a Staff-readable parameter read. Recommendation: (a) for the demo, (b) after it.
2. **`dueBefore` on devices api-design 15.** The api-design says it adds the devices due for
   service that are still `RESERVED` or `RENTED`; `maintenance.controller.ts:111` maps it to an
   `expectedAt` filter on records. This is #124 code, so it is not changed here. The page lists the
   due units from devices 06 instead (first 100, narrowed in the page). Options: (a) correct the
   api-design overview to match the controller (current behaviour is what the week's list needs);
   (b) add a `serviceDueBefore` filter to devices 06 and drop the client narrowing. Recommendation:
   (a) now, (b) when the fleet passes 100 units out.

## Noted on #124, not fixed

- `DeviceDetailPage.tsx:310` shows the open record's raw status (`OPEN`) in the link text.

## Demo steps (after the #124 demo steps 1 to 5, contract RC-2026-0002)

As `staff@treklink.local`:

1. Devices: press the **Maintenance** chip; TL-0018 is listed (count beside the chip).
2. Open **TL-0018**; the open maintenance line links to `/t/maintenance`.
3. Records: TL-0018, Inspection failed, Open. **Complete**: Completed, a resolution, actual cost
   `0` (any amount up to 1,000,000 VND, the seeded threshold, avoids the approval step), **Save**.
4. The notice says TL-0018 stays in maintenance until it passes an intake check; **Open TL-0018**.
5. **Record intake check**, every result passed; the status shows **Available**.
