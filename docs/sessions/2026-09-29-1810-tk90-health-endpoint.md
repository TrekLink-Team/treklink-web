# Session: 2026-09-29, TK-90 `GET /api/health` (US-077)

**Agent**: Claude Code (Opus 5.5), local session for LongLP, branch `feat/TK-90-health-endpoint` from `origin/dev@10847b4`. Docs root read from `treklink-docs@origin/dev` (`a153efd`).

**Scope**: TK-90 only, as approved in [TrekLink-Team/treklink-web#15](https://github.com/TrekLink-Team/treklink-web/issues/15): the health endpoint, the part of platform task 2.1 it needs, `SERVICE_UNAVAILABLE` and `CLIENT_ERROR`, `HEALTH_DB_TIMEOUT_MS`, the optional MQTT probe (D-032), a global `PrismaModule`, and the e2e setup. The answers are recorded in `treklink-docs` `07-clarification-answers.md` §7 by the `docs/TK-90-health-clarifications` PR.

## Environment limits on the authoring machine

| Missing | Consequence | Substitute |
|---|---|---|
| Docker | AC-08 against a stopped Postgres container was not run | stubbed-database e2e (§7 question 5); the reviewer runs the Docker check in `specs/platform/api-design/00-api-testing-guide.md` §7 |
| Python | `check_prose.py` not run directly | a line-for-line Node port, run on every Markdown file touched |

## What was verified

- `npm --prefix backend run lint` (ESLint, Prettier and the module-boundary check), `typecheck`, `test` (57 tests), `test:e2e` (3 tests) and `build` pass.
- `nest build` still emits `dist/main.js`; the new `backend/tsconfig.build.json` keeps `test/` and specs out of `dist`, which the added `test/` folder would otherwise have moved to `dist/src/`.
- The version path resolves to `backend/package.json` from both `src/` and `dist/`.

## Findings and where each landed

| Finding | Landed in |
|---|---|
| Nest's own `HttpException` needs a catalogue code under "every failure follows D-026"; a 4xx without one has no code | leader answer §7 question 7: `CLIENT_ERROR`; design §4.1 and §4.2, `error-code.enum.ts`, D-026 consequence |
| `api-design/01` read MQTT state from an adapter method that `gateway-sync` design §2.1 does not define | D-032; `api-design/01`, requirements REQ-EVT-04, design §4.7, gateway-sync design §2.1 |
| `npm run test:e2e` pointed at a missing `test/jest-e2e.json` | created, with `test/e2e-env.ts` for the boot-time environment |
| The backend connects to Postgres at boot, so AC-08 holds only for an outage after start | `00-api-testing-guide.md` §7 |

## Not done, deliberately

- `ValidationPipe.exceptionFactory` (rest of task 2.1) and platform tasks 2.2 to 2.8.
- The parameters and audit-log controllers (rest of task 4.1), the Swagger envelope wrapper (4.2) and the Docker e2e suite (4.3).
- Any MQTT probe implementation; `gateway-sync` registers it with its ingress adapter.
- `test:e2e` in CI, which would touch the TK-89 workflow.
