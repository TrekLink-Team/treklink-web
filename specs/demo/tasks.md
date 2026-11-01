# Implementation Tasks: demo

> Fulfills `design.md`; endpoints are `api-design/01` to `05`, the screen is
> `specs/frontend/ui-design/7-5-demo-control-panel.md`. D-088, built 2026-11-01 by KhoaDD under D-078.

| | |
|---|---|
| Lane owner | KhoaDD |
| Sprint | demo of 2026-11-01 |
| Depends on | platform, auth, organizations, devices, billing, rentals, incidents, gateway-sync |

## Phase 1: Spec and configuration

- [x] 1.1 This suite, api-design 01 to 04 from `scripts/specs/endpoints/demo.py`, screen 7.5, route in frontend design §2, `DEMO` edges in platform design Figure 3
- [x] 1.2 `DEMO_CONTROLS_ENABLED` (default `false`) in `environment-variables.ts`, platform requirements §4 and `.env.example`
- [x] 1.3 Forward migration `20261101120000_demo_controls`: auth event `DEMO_SWITCH`, permissions `demo.stage`, `demo.switchRole`, `demo.switchRole.org`; catalog rows and the regenerated permission matrix

## Phase 2: Backend

- [x] 2.1 Guards and lock (design §2); unit tests for production, a Neon host, loopback variants and busy
- [x] 2.2 Reset repository (design §3) and the seed runner (§4); `seed-demo.ts` exports `readPasswords`, the CLI unchanged
- [x] 2.3 Exported commands: `DemoSessionService` (auth), `OrganizationOnboardingService` export, `ContractDecisionsService`, `TermRolloverJob`, `ContractsService.byCode` and `endOpenTermAt` (rentals), `InvoicesService.firstChargeableInvoice` (billing), `DevicesService.byAssetTag` and `scheduleService`, `MaintenanceService` export (devices), `UplinkIngress` (gateway-sync), `IncidentsQueryService.openByDevices` (incidents, already exported); `rolloverTermEnd` and `tomorrowBusinessDay` move to `src` and `demo-term-end.ts` imports them
- [x] 2.4 Scenarios (design §5) with unit tests of each scenario's service calls; controller policy tests
- [x] 2.5 `test/demo-controls.db-spec.ts`: stage `clean`, `contract-ready-for-handover`, `term-ended` on Postgres

## Phase 3: Frontend

- [x] 3.1 `entities/demo` hooks; page `/t/admin/demo`; nav entry shown only while `enabled`; role switcher in the account menu; tests

## Phase 4: Sandbox test accounts (D-088 amendment of 2026-11-01, D-089)

- [x] 4.1 REQ-EVT-05 and AC-05, design §8, api-design 05 from `scripts/specs/endpoints/demo.py`, screen 7.5 box section
- [x] 4.2 `DEMO_TEST_ACCOUNTS_ENABLED` (D-089, default `false`) in `environment-variables.ts`, platform requirements §4 and `.env.example`; `DemoAccountsModule` with `DemoAccountsController` (`GET /api/demo/accounts`, `@Public()`, `Cache-Control: no-store`) and `DemoAccountsService`; `readSeedPasswords`; `SEEDED_ACCOUNTS` export of `seed-demo.ts`; unit tests: the four accounts, production on a Neon host answers while the stage refuses, both flags off 404 everywhere, no password in a log call
- [x] 4.3 `entities/demo` `useDemoAccounts`, widget `TestAccountsBox` on `/` and `/sign-in`, Use fills the sign-in form or carries the account in route state; tests
- [ ] 4.4 Verify the list on the Vercel production: the compiled function must load `prisma/seed-demo.ts` (design §8, open question to the leader)
