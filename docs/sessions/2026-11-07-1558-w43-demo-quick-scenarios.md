# W43 additive demo controls, 2026-11-07

Owner: KhoaDD under D-078. Branch: `feat/demo-quick-scenarios`, based on fetched `dev` at `9bca99cb`.

## Delivered behavior

- Explicit `DEMO_CONTROLS_ENABLED` plus `VITE_APP_ENV` sandbox/staging gate for the demo module, simulation control routes, page and navigation. The existing public test accounts list retains its independent flag.
- Additive organization, four contract target states, simulated SOS, loss, fault and simulator walker refresh. Owning services retain stock, custody, invoice, provisioning and lifecycle checks. Scenario-run counters and result links persist in demo-owned tables; partial failures retain their links and named cause in the run result.
- Actual requesting Admin in audit events. Quick and simulation writes require an explicit Admin role and a CASL policy, with JWT enforced by the existing global guard. Legacy reset and password-free switching still refuse production.
- Persistent escalation profile with atomic four-parameter updates, prior-value restore and optimistic versions. Contract term end targets one contract, including day plans; incident advance uses its simulated incident's next normal routing/lifecycle transition and alert outbox.
- Synthetic manual provisioning, checks, signature and demo time are disclosed. An invitation awaiting password activation does not disqualify a live Manager from signing the synthetic note, matching the real membership guard. Requested and Approved do not need a signer.
- Vercel build no longer runs `seed:demo`; it applies forward migrations only. No staging database or environment value was changed in this session.

## Verification

Final counts are recorded after the last checks below. All database writes used an isolated local Postgres 16 container on loopback, with independent migrated schemas for db-specs. No Neon database was reset, seeded or deleted.

| Check | Result |
|---|---|
| Backend touched-file ESLint | Passed; three asymmetric-matcher warnings in quick guard tests, no errors |
| Backend TypeScript | Passed |
| Module boundaries | Passed: 652 files, 64 owned models, 10 modules, acyclic |
| Backend unit tests | 376 passed in 26 suites |
| Postgres integration | 6 passed: real Active contract and its invoice/payment/note, attributed simulated SOS with alert outbox, targeted escalation and stale refusal, persistent profile restore, targeted contract rollover, production role-switch refusal and non-Admin refusal |
| Frontend full lint | Passed; one pre-existing Fast Refresh warning in CounterPaymentDialog |
| Frontend TypeScript | Passed |
| Frontend tests | 264 passed in 9 files, including 187 token/palette checks |
| Real local production HTTP | Admin quick write 200; Staff, Manager and Operator quick writes 403; anonymous options 401; legacy stage and role switch 403 DEMO_DISABLED; status roleSwitchEnabled false |
| axe | 42 configurations, zero violations: 12 page layouts, 12 dialogs, 12 account menus, 2 real stock-shortage errors, 2 native 400 percent page layouts and 2 native 400 percent account menus |
| Keyboard/targets | 216 quick-control focus checks plus 14 account-menu focus checks: no off-screen or region-obscured target, no missing outline, no primary button under 44 px |

Backend unit command: `npm --prefix backend test -- modules/demo modules/rentals/contracts.service modules/rentals/rentals.module.spec.ts modules/rentals/term-rollover.job.spec.ts modules/platform/parameters/parameter.service.spec.ts modules/incidents/jobs/incident-timers.job.spec.ts modules/gateway-sync/simulator/field-simulation.service.spec.ts modules/organizations/organizations.service.spec.ts modules/incidents/incidents-query.service.spec.ts modules/incidents/incidents.repository --runInBand`.

Database command: explicit disposable loopback `DATABASE_URL` and `DATABASE_DIRECT_URL`, then `npm --prefix backend run test:db -- demo-quick.db-spec.ts`. Credentials are not recorded here.

Frontend command: `npm --prefix frontend test -- --run src/entities/demo src/pages/DemoControlPage.test.tsx src/widgets/AccountMenu/AccountMenu.test.tsx src/features/demo-quick src/widgets/AppShell/AppShell.test.tsx src/app/styles/tokens.test.ts src/app/styles/rawPalette.test.ts src/shared/ui/Menu.test.tsx`.

### Screens inspected

| Screen/state | Widths and themes | Observed |
|---|---|---|
| Demo control: workflow forms, simulator section and time controls | 1440, 1280, 900, 360, 320 CSS px, Canopy and Volt | Screenshots inspected; 900 px has the specified two-column workflow layout. The first phone viewport contains the organization facts and main action even with the seed's SOS banner. No document scrolling or horizontal overflow at these widths. |
| Profile confirmation Dialog | Same widths, plus 318 by 236 reflow, both themes | Screenshots inspected; buttons remain reachable, shared focus handling and one outline. Phone presentation uses the shared full-height dialog. |
| Staging account menu | Same widths and 318 by 236 reflow, both themes | Screenshots inspected; no password-free role switch items. The 400 percent menu originally flipped behind the SOS banner, then passed after the account menu opted into below-only placement. |
| Real insufficient-stock error | 320 CSS px, both themes | Names the available count and says to lower quantity or choose another variant; live result retained; no document overflow. Local stock was 10, distinct from the leader's staging observation of 8. |
| Native Chromium 400 percent browser zoom | Both themes; 1272 px outer width, 318 by 236 CSS px inner viewport, devicePixelRatio 4 | Full-surface screenshots inspected. No horizontal overflow; document vertical scrolling is released as permitted by the UI standard. Page and account-menu axe checks are clean; focused menu items remain visible and 44 px high. |

Raw screenshots and JSON measurements remain in the ignored `work/` directory of this execution workspace. They contain local fictitious data only and are not added to the repository. The shared token suite checks text and non-text contrast; semantic tokens are used throughout. Result/status messages remain in mounted polite live regions.

## Shared files and spec changes

Shared production surfaces: AppModule; demo, rentals and incidents module/index exports; ParameterService transactional read/update support; narrow organization/contract/incident reads; simulator service; Prisma schema and forward migration `20261107140000_demo_quick_controls`; Vercel build; AppShell, AccountMenu and shared Menu. The Menu adds optional below-only placement; all other callers keep automatic placement.

Error-code enum, permission catalog/matrix, demo seed, router and navigation configuration were not changed. Existing `demo.stage` and `demo.simulate` permissions are reused; navigation was already built.

Specs updated: demo EARS requirements/design/tasks, generated API 01/06/11/12 and README through `scripts/specs/endpoints/demo.py`, screen 7.5, platform Vercel migration/seed description. The quick action returns a persisted run result with `error` and `errorCode` for business-step failures, retaining partial links; authorization, environment/database refusal and malformed input remain HTTP errors.

The current W43 script and run book supersede fixed record-code starting points. Historical local rehearsal details remain labelled local-only. Show defaults and the staging inventory observation were corrected.

## Remaining operations

The leader must set the staging environment flags, open/merge the PR locally and advance the staging deployment. This agent pushed its feature branch only. Staging activation, the final Neon rehearsal and physical LoRa/Field Station behavior were not verified here. WF-02 is explicitly simulated. New requests consume real available stock; finish normal returns/inspection to free units before repeating scenarios when stock is low.

Environment variable names and exact workflow clicks are in `docs/demo/2026-11-01-run-book.md` and the W43 section of `docs/demo/2026-11-01-demo-script.md`. No secret values are included.
