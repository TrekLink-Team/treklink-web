# Playwright journeys (frontend task 10.1)

The five main flows of `docs/demo/2026-11-01-demo-script.md` (MF-01a to MF-05), axe-core on every
route of `src/app/router.tsx`, and the Operator screens at 360 x 740. Vitest does not run these files
(`vite.config.ts` `test.include`); `npm --prefix frontend test` is unchanged.

| File | What it drives |
|---|---|
| `mf-01a-onboarding.spec.ts` | Script §2a: register, Staff verification, Admin approval, the Manager's first sign-in |
| `mf-01-request-to-handover.spec.ts` | Script §2b: request, approval, the counter handover, the Field Station credential |
| `mf-02-field-station.spec.ts` | Script §3: the live map and the Field data sync page, fed by the simulated gateway |
| `mf-03-sos-incident.spec.ts` | Script §4: SOS replay, acknowledge to resolve, authority reports on an incident and a contract |
| `mf-04-live-map-org-api.spec.ts` | Script §5: live map, overlay and basemaps, fleet map filter, organization API, device history |
| `mf-05-term-end.spec.ts` | Script §6: notice, `demo:term-end`, check-in, inspection, closing invoice, close; optional steps 9 and 10 |
| `a11y.spec.ts` | axe-core, WCAG 2.0 and 2.1 A and AA, on every route a seeded role reaches; fails on `serious` or `critical` unless its `ALLOWLIST` names the rule and route |
| `operator-360.spec.ts` | Project `operator-360`: the Operator's Live map, SOS banner, Incidents and incident page at 360 x 740, no horizontal scroll, primary actions on screen |

## Prerequisites

- The local stack of the demo script §1.2 on a **local** Postgres, never a `*.neon.tech` host: the
  journeys change data and the seed only adds rows.
- A fresh demo seed (`npm --prefix backend run seed:demo` on an empty database) at least 5 minutes old
  before MF-03 (`gatewaySync.attributionMarginSeconds`). The journeys share one seed and run in file
  order, one worker. A second run on the same database skips, with a reason, the steps whose seeded
  record is used up: MF-03 steps 1 to 6 (TL-0010 already had an incident) and 7 to 10 (the UNROUTED
  TL-0001 incident is closed), and every MF-05 step (RC-2026-0002 is no longer ACTIVE, ENDING or
  RETURN_DUE; TL-0018 has no open maintenance; TL-0008 is not AVAILABLE). Checked 2026-11-01: 64
  passed and 7 skipped. Reset for a full run (script §8, or the `clean` stage of the demo control
  panel).
- `npm run dev` from the repository root: backend, gateway in simulation mode, and the Vite dev server.
  MF-02, MF-03 and the 360 px spec need the MQTT broker of `MQTT_BROKER_URL` and the gateway.
- Chromium for Playwright, once per machine: `npx --prefix frontend playwright install chromium`.
- Node 22.12 or later: `@axe-core/playwright` requires it (the repository's engines field allows 22.0).
- `demo:term-end` (MF-05 step 2) runs only when the host of `DATABASE_URL` (and `DATABASE_DIRECT_URL`)
  is `localhost`, `127.0.0.1` or `::1`; any other host, a `*.neon.tech` one included, is refused with a
  message before the script starts (`support/session.ts`).

## Variables

Read from the repository root `.env` (loaded by `playwright.config.ts`; a variable set in the shell wins),
or from `E2E_ENV_FILE`.

| Variable | Use |
|---|---|
| `SEED_ADMIN_PASSWORD`, `SEED_STAFF_PASSWORD`, `SEED_MANAGER_PASSWORD`, `SEED_OPERATOR_PASSWORD` | The four seeded accounts; required |
| `SEED_ORG_API_KEY` | MF-04 step 5; the step skips without it |
| `MQTT_BROKER_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD` | The SOS replay of MF-03 and the 360 px spec |
| `VITE_API_BASE_URL` or `E2E_API_URL` | The backend API, default `http://localhost:3000/api` |
| `E2E_BASE_URL` | The frontend, default `http://localhost:5173` (the Vite dev server) |
| `E2E_START_SERVER` | `true` starts the Vite dev server for the run; the backend must already be up |
| `E2E_BACKEND_LOG` | The file the `npm run dev` output is written to: MF-01a step 6 reads the invitation code from it. Without it, steps 6 to 8 skip |
| `E2E_STUB_TILES` | `true` answers basemap tile requests with a blank tile, for a network that blocks the tile hosts. Leave it off where the real tiles load |
| `E2E_CHROMIUM_PATH` | A Chromium binary other than the one `playwright install` downloads |
| `E2E_ENV_FILE` | Another env file instead of the root `.env` |

## Commands

From the repository root, after the setup of the demo script §1.2:

```bash
npm run dev > /tmp/treklink-dev.log 2>&1 &
```

```bash
E2E_BACKEND_LOG=/tmp/treklink-dev.log npm --prefix frontend run test:e2e
```

One flow, or the phone project only:

```bash
npm --prefix frontend run test:e2e -- mf-03
```

```bash
npm --prefix frontend run test:e2e -- --project operator-360
```

Type check and lint of these files: `npm --prefix frontend run typecheck:e2e` and
`npm --prefix frontend run lint`.

## What is driven, not real

- **MF-02 hardware**: no LoRa radio. The gateway in simulation mode (`GATEWAY_SERIAL_SIMULATION=true`)
  publishes TL-0009 and TL-0010 through the real queue and MQTT path, as in the demo. The optional
  broker outage (step 6) is not driven.
- **MF-03 SOS**: `npm --prefix backend run replay:mqtt -- sos --now --new-ids`, as the presenter runs it.
  The 360 px spec publishes one SOS from TL-0009 in the same packet shape.
- **MF-05 timed job**: `npm --prefix backend run demo:term-end -- RC-2026-0002` runs the term rollover
  instead of waiting for the 09:00 cutoff. The demo control panel stage `term-ended` (`/t/admin/demo`,
  `DEMO_CONTROLS_ENABLED=true`) does the same for a rehearsal.
- **Invitation email**: `MAIL_TRANSPORT=console` writes it to the backend log, read through
  `E2E_BACKEND_LOG`.
- **Handover note**: the preview frame shows a PDF, which the browser's viewer draws outside the DOM; the
  journey checks that a PDF is framed and that the signed note downloads under its file name.

## Traces

A Playwright trace records every request with its body, so it holds the seeded passwords and the
access tokens. Traces are off on CI (`CI` set) and kept only for a failed test's first retry locally.
**Never upload a trace or an HTML report built with traces**: not to an issue, a PR, a chat or a CI
artifact.
