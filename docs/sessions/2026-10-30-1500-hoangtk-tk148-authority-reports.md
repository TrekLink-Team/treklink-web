# 2026-10-30 15:00, HoangTK, authority reports backend (TK-148)

## Goal

- Build incidents api-design 08 (report an incident to the authorities), 09 (record the case closed) and 11 (list reports), with task 4.3 and the matching parts of 5.1, 6.1 and 6.2.
- Branch `feat/TK-148-authority-reports`, cut from `origin/dev` `f521002`. Independent of PR #120 (TK-144) and PR #121 (TK-145).

## Mapping, confirmed with HoangTK before the branch

| Jira key | Story | Use case | Requirements | API | Tasks | Owner |
|---|---|---|---|---|---|---|
| TK-148 (primary) | US-UC35 Report to Authorities | UC-35 | FR-INC-04, FR-INC-10, BR-17 | 08, 11 | 4.3, 5.1, 6.1, 6.2 | HoangTK (backlog owner and tasks owner) |
| TK-150 (linked) | US-UC37 Close Incident | UC-35, UC-37 | FR-INC-04, D-034 | 09 | 4.3 | HoangTK |

Keys come from `treklink-docs` `build_backlog.py` `JIRA_KEYS`; live Jira was not readable from this session. Left out: api-design 10 (traces UC-50, TanNB's TK-163) and frontend 8.2 and 8.3, until KhoaDD rules on their attribution.

## Decisions

1. **Permission.** All three routes use the seeded `authorityReport.manage` (STAFF, ADMIN). No catalog edit, no migration. The service also refuses a caller with an organization, and the lifecycle guard requires the STAFF or ADMIN role.
2. **Order of checks on 08.** The state is checked before the version, as the api-design 08 activity orders them, with the contract's message "This cannot be done while it is {state}."
3. **No R1 dependency.** `AUTHORITY_REPORTED` and `CASE_CLOSED` pass empty recipients, so only the organization's API event row is written (none for an `UNROUTED` incident). AC-04 asserts no delivery row for either transition.
4. **Closure.** The report row is locked `FOR UPDATE`; a set `caseClosedAt` answers 409 `CASE_ALREADY_CLOSED`. A `REPORTED` incident moves to `CLOSED`; one a member acknowledged after the report keeps its state; a contract report returns `incidentState: null`.
5. **Beyond the contract, recorded in task 4.3.** `closedAt` may not be in the future or before `reportedAt`. The closure note is written to the transition and the audit record, because `authority_reports` has no closure note column.
6. **List order.** Open cases first, then `reportedAt` newest first, `id` as tie-break. Without the `open` filter a page reads the open group, then continues into the closed group at the right offset.
7. **Error code.** `CASE_ALREADY_CLOSED` added to `ErrorCode` under incidents, as listed in incidents design §7.

## Changed

| File | Change |
|---|---|
| `backend/src/modules/incidents/authority-reports.service.ts` | new: `reportIncident`, `closeCase`, `list` |
| `backend/src/modules/incidents/authority-reports.controller.ts` | new: api-design 09 and 11 |
| `backend/src/modules/incidents/authority-reports.repository.ts` | `lockById`, `closeCase`, `page`; takes `PrismaService` |
| `backend/src/modules/incidents/incidents.controller.ts` | api-design 08 and `AuthorityReportDto` |
| `backend/src/modules/incidents/incidents.module.ts` | registers the controller and service |
| `backend/src/common/errors/error-code.enum.ts` | `CASE_ALREADY_CLOSED` |
| Unit specs | service, both controllers (policy per route, DTO transforms), repository |
| `backend/test/authority-reports.e2e-spec.ts` | new, every Validation row of 08, 09 and 11 |
| `backend/test/authority-reports.db-spec.ts` | new, AC-04 against Postgres |
| `backend/test/incidents.db-spec.ts` | repository constructor argument |
| `specs/incidents/tasks.md` | 4.3, 5.1, 6.1 and 6.2 notes; boxes stay open |

## Verified

- Disposable `postgres:16` on localhost:55434, `prisma migrate deploy`; shared Neon not used. Container stopped after the run.
- `test:db`: 10 suites, 68 tests pass, including the new AC-04 spec. The SOS from a device on no contract is stored `ACCEPTED_UNATTRIBUTED` and opens an `UNROUTED` incident; a stale version is refused with no report written; the report moves it to `REPORTED`; the closure moves it to `CLOSED`; a second closure is refused and keeps the first time.
- `test:e2e`: 14 suites, 213 tests pass.
- `test:cov`: 144 suites, 1587 tests pass. All files 93.42 % lines, 85.96 % branches; `authority-reports.service.ts`, `.controller.ts`, `.repository.ts`, `incidents.controller.ts` and `error-code.enum.ts` are 100 % lines and branches.
- `typecheck` and `build` exit 0. `lint`: 0 errors, 1 warning in `test/incidents.e2e-spec.ts:299`, which predates this branch. Module boundary check passed.
- `npx prisma generate` was run locally because the generated client predated the TK-161 schema on `dev`; no database was touched by it.

## Not done

- api-design 10 and frontend 8.2 and 8.3 (attribution questions for KhoaDD).
- Tasks 4.3, 5.1, 6.1 and 6.2 stay open for their other parts.
