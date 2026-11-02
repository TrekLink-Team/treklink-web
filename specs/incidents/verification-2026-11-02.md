# Incidents 8.1 verification, 2026-11-02

Audit base: `dev` 829601c4698798a3863d5560a6128ae611b191f8, after KhoaDD merged API 13 in
[#314](https://github.com/TrekLink-Team/treklink-web/pull/314). Dispatcher wording is submitted
separately in [#322](https://github.com/TrekLink-Team/treklink-web/pull/322), head c46223c. It is
not treated as merged evidence in this audit. No production code changes belong to this audit.

## Checklist evidence

| Criterion | Result | Evidence and limit |
| --- | --- | --- |
| Whole local suite green | Unchecked | The dispatcher verification on the same dev base has 246 backend suites/2860 tests passing and one unchanged Rentals PDF test failing. #311 is a local parser issue, not a passing local test. |
| Latest dev Linux CI green | Verified | [CI 41461435950](https://github.com/TrekLink-Team/treklink-web/actions/runs/41461435950) completed successfully on exact audit base 829601c. #314 also passed its Linux CI, including the PDF renderer. |
| Workspace lint | Verified, zero errors | Current-base dispatcher gates exit 0. Existing backend unused-variable and frontend fast-refresh warnings remain; this is not a zero-warning claim. |
| Module boundaries | Verified | `node backend/scripts/check-module-boundaries.js`: 563 files, 55 owned models, 10 modules in an acyclic graph. Backend lint runs the same check. |
| Workspace typecheck/build | Verified | Both commands exit 0 in the dispatcher verification. No unrelated production changes were made. |
| API 13 contract and access | Verified | Real HTTP tests in `backend/test/incident-events.e2e-spec.ts`: actual JWT/CASL/query/global port, Operator/Manager/Staff/Admin, 401/403/404/invalid UUID and empty result. `backend/test/incident-events.db-spec.ts` proves linked episode filtering, before/after-SOS positions, stable occurredAt/eventId order and immutable custody attribution. These tests pass in latest-dev CI. |
| Complete api-design behavior reconciliation | Unchecked | API 05's documented request sample is rejected by its actual UUID DTO. See the reproduction below. Existing HTTP suites cover all 14 route surfaces, but this sample prevents declaring the complete API suite reconciled. |

API 13 has the accepted array response. It has no pagination, from/to query or SOS timestamp cap;
the linked incidentId defines its episode. Incidents owns its route, read policy and INCIDENT_EVENTS
port; gateway-sync's global ports module exports only the token. R2 is resolved, not an active blocker.

## API surface inspected

`IncidentsController` implements 01 to 08 and 12 to 14. `AuthorityReportsController` implements
09 to 11. Both keep the documented policy checks and response messages; global application guards
and the response envelope are exercised by the HTTP suites. Existing verification is grouped as:

| API designs | Passing HTTP evidence | Additional evidence |
| --- | --- | --- |
| 01 to 07,12,14 | `backend/test/incidents.e2e-spec.ts` | `IncidentsQueryService`, `IncidentsService`, controller DTOs; mutation views are mapped by `queries.views` |
| 08,09,11 | `backend/test/authority-reports.e2e-spec.ts` | `AuthorityReportsService` and `authority-reports.db-spec.ts` |
| 10 | `backend/test/authority-reports-contract.e2e-spec.ts` | Contract-status check and existing service tests |
| 13 | `backend/test/incident-events.e2e-spec.ts` | Real event port/repository and disposable-Postgres episode tests |

The current-base dispatcher full verification passes 43 database suites/242 tests, 21 HTTP suites/
441 tests, 12 Gateway suites/90 tests and 102 frontend files/1123 tests. The full backend local
failure above is retained. These counts describe c46223c verification; latest-dev green is established
separately by the exact-base CI link, rather than treating an unmerged feature as dev.
Read-only comparison of all 14 API documents against `build_api_design.render` reports zero drift.
It confirms catalog synchronization, not runtime validity of the sample below. Dispatcher PR #322
also completed all CI jobs successfully; it remains in review and is not counted as merged dev.

## API 05 request sample fails UUID validation

`api-design/05-post-incidents-id-status-updates.md` documents this request:

```json
{"note":"Reached the holder, minor knee injury","correctsId":"su-3"}
```

`StatusUpdateDto.correctsId` in `backend/src/modules/incidents/incidents.controller.ts` has
`@IsUUID()`. Running the documented JSON through `plainToInstance(StatusUpdateDto, body)` and
`class-validator.validate` returns:

```text
property: correctsId
isUuid: correctsId must be a UUID
```

The source catalog `scripts/specs/endpoints/incidents.py` also uses `su-3`, so regenerating without
correcting the catalog preserves the invalid example. This is a documentation sample gap, not an
authorization or UUID-validation defect. Keep the validation. A follow-up can replace illustrative
status-update identifiers in the catalog with consistent UUIDs and regenerate affected examples.
This audit does not change the contract or reopen the status-update implementation.

## Remaining module gaps

- `API_EVENT` alert delivery is still unimplemented: the dispatcher claims WEB/WEBSOCKET and EMAIL
  only; API_EVENT rows remain PENDING. REQ-EVT-13 and task 2.1 cannot be marked wholly complete.
- API 13 now supplies backend episode evidence, but the organization incident page does not yet
  consume it as an episode panel/map trail. Frontend tasks 8.1/8.2 also retain other open screen work.
  Their old "waits for R2" notes are superseded by #314; the missing UI is separate implementation.
- The suspected wording implementation is #322, pending its own CI/review at audit time. Existing
  alerts must keep their shown text on confirmation, per KhoaDD's #313 ruling.
- #311's local PDF failure remains recorded. The leader's delivery exception permits PR delivery;
  it does not make the local suite pass or complete incidents 8.1.

The parent task 8.1 remains unchecked. No Jira story is marked Done and no duplicate Daily Report is
posted. Historical MF-03 MQTT/browser SOS-to-RESOLVED evidence remains in the earlier Week 9 handoff;
this audit does not claim a new browser/hardware run.
