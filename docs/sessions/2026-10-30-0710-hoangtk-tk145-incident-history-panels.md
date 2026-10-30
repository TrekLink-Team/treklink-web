# 2026-10-30 07:10, HoangTK, incident history panels (TK-145)

## Goal

- While PR #120 (TK-144) waits on R1 and the restart-test ruling, build the next independent incidents work: api-design 12 (transition trail) and 14 (alert delivery log) with their screen 8.1 panels.
- Branch `feat/TK-145-incident-history-panels`, cut from `origin/dev` `c52c77e`, independent of TK-144.

## Mapping checked

- `TK-145` is US-UC32 "Acknowledge Incident" (`treklink-docs` `build_backlog.py` `JIRA_KEYS`). The history panels have no story of their own: frontend 8.1 lists US-UC32, US-UC33 and US-UC34, with US-UC32 first, and incidents 5.1 and 6.1 are HoangTK's. api-design 12 traces UC-58 (TK-171, KhoaDD's platform audit-log story) and FR-INC-04; api-design 14 traces UC-30 (TK-143). TK-145 carries the branch, as the first story of frontend 8.1.
- Nothing built before: no route, no open PR or branch for 12 or 14 (checked 2026-10-30 07:00).
- api-design 13 (events) stays out: it waits for R2 in treklink-web#118.

## Decisions

1. **Alert log permission.** api-design 14 is "Org Manager: own; TrekLink Staff, TrekLink Admin". The catalog already has `alertDelivery.read.own` (ORG_MANAGER) and `alertDelivery.read` (STAFF, ADMIN) on subject `AlertDelivery`, seeded in `20261004120100_seed`. HoangTK approved a new permission before this was found; none was needed, so no catalog edit and no migration. The route checks `read AlertDelivery`, and the query service applies the same organization scope as the other reads, so an Org Operator gets 403 before any row is read.
2. **Actor and recipient.** `actor` is `SYSTEM` for a null actor, else the name from `OrganizationsService.memberNames`; `recipient` is null for an organization API event. An account `contactCard` cannot name shows its id rather than an empty field.
3. **Nulls.** `sentAt` and `lastError` are returned as null when unset; api-design 14 omits them in its pending sample, and screen 8.1 calls them optional.
4. **Panels fail alone** (screen 8.1 Errors): 403 hides the panel, 404 refetches the incident, other errors offer a retry. The panel keys sit under `['incident', id]`, so `incident.changed` and every action refresh them.

## Changed

| File | Change |
|---|---|
| `backend/src/modules/incidents/incidents.repository.ts` | `transitions(id)` by `seq`; `alertDeliveries(id)` oldest first |
| `backend/src/modules/incidents/incidents-query.service.ts` | `transitions` and `alerts`; `readScope` takes the model; shared `readable` 404 check |
| `backend/src/modules/incidents/incidents.controller.ts` | `GET :id/transitions`, `GET :id/alerts` |
| `backend/test/incidents.e2e-spec.ts` | 9 cases for 12 and 14, an Org Manager account |
| Backend unit specs | query service, repository reads, controller (every route's policy and the list DTO transforms) |
| `frontend/src/entities/incident/api.ts` | types, keys, hooks, reason labels |
| `frontend/src/widgets/IncidentHistory/IncidentHistory.tsx` | `TransitionTrail`, `AlertLog` |
| `frontend/src/pages/IncidentDetailPage.tsx` | panels; the alert log only for `ORG_MANAGER` |
| `frontend/src/pages/incident-pages.test.tsx` | 7 cases; the detail mock answers by endpoint |
| `specs/incidents/tasks.md`, `specs/frontend/tasks.md` | 5.1, 6.1, 6.2 and 8.1 notes; boxes stay open |

## Verified

See the PR body for the output. Backend typecheck, lint (0 errors, the existing warning), e2e, unit with coverage and build pass; the three changed backend source files are at 100 % lines, the query service at 93.61 % branches. Frontend typecheck, lint, tests and build pass.

Final verification, 2026-10-30 08:00 to 08:30:

- **Frontend coverage.** No coverage provider is in the lockfile, so `@vitest/coverage-v8@3.2.7` (matching vitest 3.2.7) was installed with `npm install --no-save --ignore-scripts`, measured, then removed with `npm prune`; `package.json` and `package-lock.json` never changed. `IncidentHistory.tsx` 100 % lines and branches; `entities/incident/api.ts` 100 % lines, 97.77 % branches; `IncidentDetailPage.tsx` 100 % lines, 97.64 % branches (the uncovered branches are pre-existing lines 71 and the `?? []` role fallback). One test added for the alert log retry; 353 tests pass.
- **Direct API, real permissions.** Disposable `postgres:16` on port 55433, `prisma migrate deploy`, `seed:demo` with passwords generated into a scratchpad file (deleted after), a fixture adding ORG-0099 with one incident, three transitions and alert rows on each organization. The built backend ran against it with no other database configured. 20 of 20 checks pass: 401 without a token; Admin and Staff read both organizations on both routes; Org Manager reads its own and gets 404 `NOT_FOUND` for ORG-0099 and for a missing id; 400 for a non-UUID id; Org Operator reads the trail of its own organization, 404 for ORG-0099, and 403 `FORBIDDEN` on api-design 14 for both organizations.
- **Browser smoke**, Vite on 5173 against that backend, 1280 x 900 and 375 x 812. Org Manager: History shows "Created as Detected", "Detected to Notifying primary", "Notifying primary to Acknowledged" with SYSTEM and the operator's name; Alert deliveries shows Sent, Pending (API event, "Organization API stream") and Failed with its last error; Refresh sends a second `GET .../alerts`. The ORG-0099 incident shows MSG26 and requests no panel. Org Operator: History shown, no Alert deliveries panel and no `/alerts` request. At 375 px the document is 375 px wide. Console errors: two 401s from a full page reload before signing in again, none from the panels.
- **Torn down**: container removed, backend and Vite processes stopped, the generated credentials file deleted. Shared Neon not used.

Not run: `test:db` (no schema or write path changed).

## Not done

- api-design 13 and its events panel (R2).
- The 5.1 monitoring reads, 6.1 routes 08 to 11 and 13, 8.1 filters and the dirty-form guard.
- TK-144 / PR #120 untouched; its CI is green, no review yet (07:48).
