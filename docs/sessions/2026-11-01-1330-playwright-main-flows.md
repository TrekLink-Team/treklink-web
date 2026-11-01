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
(desktop 69, operator-360 2). Vitest unchanged by the change: 78 files, 870 tests on that base; 80 files, 880 tests on the base the leader sealed the branch on.

## Findings

| # | Finding | State |
|---|---|---|
| 1 | axe `label-content-name-mismatch` (WCAG 2.5.3, serious): the live map device row's `aria-label` (`LiveMapPage.tsx:132`) leaves out the visible battery percentage and the Stale badge; on `/o/map` and `/t/map` | Allowlisted in `a11y.spec.ts` on its selector, not fixed |
| 2 | Same rule on `/t/admin/audit/sign-ins`: the account filter button (`AuthEventsPage.tsx:228`) shows "Filter by this account", which its accessible name "Filter by the account of <email>" does not contain | Fixed by #267 (merged 2026-11-01); allowlist entry removed |
| 3 | No other axe violation of any impact on the 47 routes | |

No journey found a defect in the flows; no test is marked `test.fixme`.

## Review follow-up (review of #260, on the sealed head `ead895d`)

- Status checks match the badge's whole text (`statusBadge`), and each one is preceded by a check that
  the same locator matches nothing on the same page before its step. Each was also run once with its
  step removed and failed on that assertion: MF-05 step 1 without the notice ("Ending"), MF-05 step 9
  without the intake save ("Available"), MF-03 step 10 without the case closure ("Closed"), MF-01
  step 12 on the Approved contract page ("Active").
- MF-05 steps 2 to 8 skip when RC-2026-0002 is not in the state the step needs.
- axe allowlist entries carry a selector; an entry that matches no violating node fails its route.
- `demo:term-end` refuses a database host that is not loopback; checked with a Neon URL, a hosted
  URL, `localhost`, `127.0.0.1` and `[::1]`.
- Traces are off on CI.
- The first exact "Requested" check on the contract page raced the History list, whose first line is
  also exactly "Requested" (5 of 8 repeats failed). Contract and device badges are now read from the
  page title block (`titleStatus`); 8 of 8 repeats passed.
- New axe finding on a used seed: `definition-list` and `dlitem` (serious) on `/o/incidents/:id` for a
  resolved incident, because the Outcome fact is wrapped in an extra `div` inside the `dl`
  (`IncidentDetailPage.tsx:297`). Allowlisted on its selector, required while the page shows an
  Outcome; the route now prefers a resolved incident.
