# 2026-11-01 03:10, W19 sandbox test accounts (KhoaDD under D-078)

Branch `feat/demo-test-accounts` from `origin/feat/demo-control-panel` at `3dc46c9` (treklink-web#245, not
yet in `dev`). Authority: D-088 amendment of 2026-11-01, D-089 (scope change mid-session: own flag
`DEMO_TEST_ACCOUNTS_ENABLED`, answers in production and on Neon; the control panel keeps its guards).

- Backend: `DemoAccountsModule` (controller and service) under its own `ConditionalModule`; the service reads
  `demo-test-accounts.ts`, a compiled copy of the `SEEDED_ACCOUNTS` export of `seed-demo.ts`, with a drift test.
- Frontend: `widgets/TestAccountsBox`, `useDemoAccounts`; `/sign-in` moved to the wide public frame.
- Found: `test/route-guards.e2e-spec.ts` failed with `DEMO_CONTROLS_ENABLED=true` (`GET /demo/status` missing
  from the token-only list since #245); fixed in the same file.
- Resolved: `ts-node` is a dev dependency and the Vercel function ships only `src/`, so loading the seed at
  run time would fail there. Leader chose the compiled copy (option 1). Checked: the compiled build lists the
  four accounts in plain Node with no `.ts` loader and loads neither the seed nor `ts-node`.
- Live check: local Postgres 16 on 127.0.0.1:5433, `seed:demo`, both themes in headless Chromium, sign-in as
  the Operator through Use; with both flags off every `/api/demo` route is 404 and both pages show no box.
- Not run: `test/*.db-spec.ts` (untouched by this change); `check_tasks.py` and `check_mermaid.py` need the
  capstone repository, absent here.
