# 2026-11-04 17:45 (UTC+7): W15 panel-grade UI walk and the cheap fixes

KhoaDD under D-078, branch `fix/panel-polish` from `dev` at `42365e3`. Frontend only.

## Environment

- Postgres 16 from apt, a fresh `initdb` cluster on port 5433, database `treklink_demo`; never a Neon host.
- Root `.env` from `.env.example` with the local URL, `MAIL_TRANSPORT=console`, the four `SEED_*_PASSWORD`,
  `DEMO_CONTROLS_ENABLED`, `DEMO_TEST_ACCOUNTS_ENABLED`, `DEMO_SIMULATION_ENABLED` and
  `FIELD_SIMULATOR_ENABLED` true, `GATEWAY_SIM_SOS_EVERY=0`. Copied to `backend/.env` before
  `prisma:generate`, then `prisma:deploy` and `seed:demo` (52 row groups).
- No Docker daemon: an in-process `aedes` broker on 1883 stood in for Mosquitto; the gateway ran in
  simulation mode. Real basemap tiles loaded (not stubbed).
- A `#` in a `.env` value starts a comment for both dotenv and `process.loadEnvFile`, so a password
  written `Name#2026` is seeded as `Name`. Manual sign-ins with the longer string locked the Operator
  account (`ACCOUNT_LOCKED`); cleared by resetting `failedLoginCount` and `lockedUntil` locally.
- Chromium: the preinstalled `/opt/pw-browsers/chromium` (`E2E_CHROMIUM_PATH`); the Playwright release of
  the repository looks for another build.

## Walk

- The six journeys of `frontend/e2e` (MF-01a to MF-05) in dark at 1280x800: 25 passed, 1 skipped (MF-04
  step 5, no `SEED_ORG_API_KEY`).
- Every route of `a11y.spec.ts` plus the contract, counter, loss case, reports and admin routes the flows
  touch, as the four seeded users, light and dark, 1280x800 and 360x780: 252 page visits. Each visit ran
  axe with WCAG 2.0, 2.1 and 2.2 A and AA tags, a horizontal overflow check, and a focus check that
  focused every control (8,091 in all) and looked for a fixed or sticky element painted over it.
- Results: no colour-contrast violation in either theme or width; no focused control hidden under a
  sticky bar; no horizontal overflow at 360 px except `/dev/design-system`; axe serious only on a
  resolved incident (`definition-list`, `dlitem`, fixed below) and once `target-size` on a row of
  `/t/admin/audit/sign-ins` at one scroll position (not reproduced, listed below).
- Map, three basemaps at zoom 6 and 7 over the Paracel and Spratly islands: the Hoàng Sa and Trường Sa
  overlay labels show on each, and no Sansha, Xisha or Nansha label was seen. OpenTopoMap and Stadia print
  "South China Sea" in open water, and OpenTopoMap prints a bilingual Gulf of Tonkin label with 北部湾.
- The signed handover note PDF of RC-2026-0004 (2 pages, A4) reads as a formal record; Party A's
  signature box is empty.

## Fixed on the branch (one commit each)

1. `/t/billing`: the invoice list keeps the full width until an invoice is open (`BillingPage.tsx`).
2. `/o/contracts/new`: variant cards one per row below 1536 px (`VariantPicker.tsx`).
3. Invoice kind as a word (Closing, Day plan, Term n), one label function for the list and the page, a
   schema-reading test; the note under the lines no longer names the ADJUSTMENT enum.
4. A table row title stays on one line; the fleet's variant, firmware and service due too, and Service
   due uses `formatDay`.
5. Acquired (device page) and Expected completion (Maintenance) use the shared date formatters.
6. Header: the organization name in full from 1280 px, the code on one line, only the code below.
7. Incident Outcome fact a direct `dt` and `dd` group (`Fact` takes `className`); the two allowlist
   entries of `e2e/a11y.spec.ts` removed. `a11y.spec.ts` on the branch: 49 passed.
8. Close blockers no longer repeat an amount the message already names.
9. Sidebar labels wrap instead of ending in an ellipsis.
10. MSG26 page links to the start page (the role landing route, or `/` signed out).

Checks before each push: `npm --prefix frontend run lint` (0 errors, 1 warning that was there before),
`typecheck` clean, `npm --prefix frontend test` 122 files, 1376 tests at the last push.
`operator-360.spec.ts`: 2 passed.

## Not done, for the leader

| Item | Why not here | Size |
|---|---|---|
| Invoice page as a business document: seller block (legal name, tax code, address), buyer block (organization name, tax code), totals footer | The seller identity is backend configuration (`COMPANY_*`) and billing api-design 09 returns the organization code only | M |
| "South China Sea" and 北部湾 on two basemaps | Overlay masks come from `GET /api/map/config` (monitoring, D-085); needs a ruling: mask and relabel as Biển Đông, or drop those basemaps | M |
| Party A signature box empty on the handover note | `backend/src/modules/rentals/handover-note.renderer.ts` §6; a Staff signature or an "accepted electronically by" line is a contract choice | M |
| Stepper and tab strips cut words at their edges | Scroll strip of chapter 06 §10.6 (`ContractHeader.tsx`); edge fades or wrap need a design ruling | M |
| Device history shows `IN_INTAKE to AVAILABLE` | The summary text is written by the devices module | M |
| Accounts page badges `ADMIN`, `STAFF`, `ACTIVE`, `DEACTIVATED` | Screen 7.1 rows 24 and 25 specify those texts; chapter 06 §8.3 says labels. Needs a spec ruling | S once ruled |
| `target-size` on `/t/admin/audit/sign-ins` | Seen at one scroll position only; verify first | M |
| Overlay labels over device markers at zoom 4 and below | Map layer order | M |
