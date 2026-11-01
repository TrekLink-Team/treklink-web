# 2026-11-01 03:10, W19 sandbox test accounts (KhoaDD under D-078)

Branch `feat/demo-test-accounts` from `origin/feat/demo-control-panel` at `3dc46c9` (treklink-web#245, not
yet in `dev`). Authority: D-088 amendment of 2026-11-01, D-089 (scope change mid-session: own flag
`DEMO_TEST_ACCOUNTS_ENABLED`, answers in production and on Neon; the control panel keeps its guards).

- Backend: `DemoAccountsModule` (controller and service) under its own `ConditionalModule`; `readSeedPasswords`
  shared with the runner; `SEEDED_ACCOUNTS` exported by `seed-demo.ts` in its own block.
- Frontend: `widgets/TestAccountsBox`, `useDemoAccounts`; `/sign-in` moved to the wide public frame.
- Found: `test/route-guards.e2e-spec.ts` failed with `DEMO_CONTROLS_ENABLED=true` (`GET /demo/status` missing
  from the token-only list since #245); fixed in the same file.
- Open: `ts-node` is a dev dependency and the repo has no backend Vercel config, so whether a compiled Vercel
  function loads `prisma/seed-demo.ts` is (unverified); asked of the leader, recorded in specs/demo design §8
  and task 4.4.
- Live check: local Postgres 16 on 127.0.0.1:5433, `seed:demo`, both themes in headless Chromium, sign-in as
  the Operator through Use; with both flags off every `/api/demo` route is 404 and both pages show no box.
- Not run: `test/*.db-spec.ts` (untouched by this change); `check_tasks.py` and `check_mermaid.py` need the
  capstone repository, absent here.
