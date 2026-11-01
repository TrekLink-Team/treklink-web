# 2026-11-01 13:30 (UTC+7): Playwright journeys MF-01a to MF-05, axe-core, 360 px (frontend 10.1)

KhoaDD under D-078, run by the leader's cloud agent (task W20). Branch `test/playwright-main-flows`, cut
from `origin/dev` at `fc594f0`. Test work only: no screen, route or backend file changed.

## Environment

- Postgres 16 from apt, a fresh cluster on port 5433, database `treklink_demo`. Never a Neon host.
- Root `.env` from `.env.example` with the local URLs, the four `SEED_*_PASSWORD`, `SEED_ORG_API_KEY`,
  `GATEWAY_SIM_SOS_EVERY=0`, `DEMO_CONTROLS_ENABLED=true`; copied to `backend/.env` before
  `prisma:generate`.
- No Docker daemon: an in-process `aedes` broker from the repository's `node_modules` stood in for
  Mosquitto on 1883. Basemap tile hosts are blocked here, so the run used `E2E_STUB_TILES=true`.
- Browser: the preinstalled Chromium 1243 through `E2E_CHROMIUM_PATH`; `@playwright/test` 1.64.1 so
  that `@axe-core/playwright` and the runner share one `playwright-core`.

## Result

Final run at 06:41 UTC on a seed made at 06:35 UTC: **71 passed, 0 failed, 0 skipped, 0 fixme**
(desktop 69, operator-360 2). Vitest unchanged: 78 files, 870 tests.

## Findings

| # | Finding | State |
|---|---|---|
| 1 | axe `label-content-name-mismatch` (WCAG 2.5.3, serious): the live map device row's `aria-label` (`LiveMapPage.tsx:132`) leaves out the visible battery percentage; on `/o/map` and `/t/map` | Allowlisted in `a11y.spec.ts`, not fixed |
| 2 | Same rule on `/t/admin/audit/sign-ins`: the account filter link is named "Filter by the account of ..." around a visible email (`AuthEventsPage.tsx:228`) | Allowlisted, not fixed |
| 3 | `/t/maintenance/approvals` is routed under Staff (`router.tsx`) but the page answers Admin only (`MaintenancePage.tsx:1121`), so Staff see "You do not have access to this." | Recorded; the a11y spec checks it as Admin |
| 4 | No other axe violation of any impact on the 47 routes | |

No journey found a defect in the flows; no test is marked `test.fixme`.
