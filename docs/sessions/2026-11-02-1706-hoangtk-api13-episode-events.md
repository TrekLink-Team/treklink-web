# API 13 episode events, HoangTK

Standalone API 13 implementation from origin/dev 25dc0b1 on feat/incident-episode-events.
PR #313 merged at 08:58:05 UTC; no overlapping API 13 PR at preparation. Existing private files,
coverage, recovery stashes, credentials, hooks and keys preserved. No frontend, dispatcher,
Jira completion or duplicate Daily Report changes.

## Approved contract

R2-b: https://github.com/TrekLink-Team/treklink-web/issues/118#issuecomment-6573924382.
Final contract: https://github.com/TrekLink-Team/treklink-web/issues/118#issuecomment-6574378764.
The leader corrected the earlier paging assumption: keep API 13's array response, no pagination,
from/to parameters or SOS timestamp clipping. Linked incidentId defines the episode. Order by
occurredAt ascending, then eventId ascending. Members see custody-attributed events; unconditioned
Staff/Admin reads see all linked evidence. No cap unless a large episode is observed and ruled on.

## Implementation

Incidents keeps IncidentsController's GET :id/events, read Incident CASL policy, UUID validation
and the standard envelope. IncidentsQueryService first resolves authorized incident visibility,
then calls the incidents-owned INCIDENT_EVENTS interface with incident id and trusted scope.
Missing/foreign incident: 404; no read permission: 403; missing JWT: 401; bad UUID: 400.
No caller-selected paging/window is used, consistent with sibling history reads.

Gateway-sync provides the token through global IncidentEventsPortsModule, exporting only the
token. GatewayIncidentEvents reads through its own SyncQueryRepository. There is no incidents
import of gateway-sync and no forwardRef. The query selects only eventId, kind, observedAt and
coordinates, preserving nulls. Its organizationId/ATTRIBUTED filter uses immutable custody
attribution set at ingestion under D-040, not the device's current holder. Staff gets no such
filter. No schema migration: the only schema edit clarifies API 13's occurrence-time ordering
exception to the old comment; ledger ordering remains seq.

Catalog and generated API 13 updated in the same pass, plus module design port tables and task
notes. Broader tasks and DoD 8.1 are not completed. Suspected-message implementation remains queued.

## Verification evidence

- Focused units: 5 suites/61 tests pass. D-053 coverage across touched production files: 100% lines;
  IncidentsQueryService 94.73% branches, controller/provider/repository/modules/token 100% branches.
- API 13 HTTP: 10 tests pass through actual AppModule, JWT/CASL, query service, port and repository
  with Prisma stubbed. Covers Operator/Manager/Staff/Admin, 401/403/404/UUID, empty array and no
  caller-selected truncation. AppModule compilation also verifies global provider resolution.
- API 13 Postgres: 4 tests pass on local disposable treklink_week9 at loopback port 55439. Tests
  linked episode isolation, tie ordering, positions before/after SOS, null observedAt, custody
  attribution filtering, cross-organization/permission refusal, empty and missing incidents.
- Backend lint passes with one existing unused-variable warning; boundary checker passes with
  553 files, 54 owned models and 10 modules in an acyclic graph. Typecheck and build exit 0.
- Full backend unit/database/HTTP runs are captured under ignore/hoangtk/api13-all-*.log; final
  counts and any local baseline failures will be added before delivery.

Initial HTTP fixtures omitted passwordHash and permission fields, producing expected fixture
authentication failures; corrected fixtures now pass without weakening production auth. The first
db fixture omitted required payload, corrected before tests ran. The boundary parser read a test
description containing "into incidents" as SQL; reworded that description, checker unchanged.

Diagram gate: re-read course PDF sections 1.4/1.5, 2.5, 3 and 4 using pdf-parse. API 13 activity
and sequence rendered with bundled Mermaid 12 and headless Chrome; Codex opened both PNGs.
Activity cross-checked against route policy/404 handling; sequence against incidents-owned
query/port and gateway-sync repository, with no reverse module import. Images are private under
ignore/hoangtk/api13-diagram-*.png. No graded-report diagram changed.

Current model metadata at 10:06:07 UTC records gpt-6.1-sol. Use that exact model through HoangTK's
unchanged Checksum hook; never the global claude-opus-5-5 fallback. No merge authorization.

## Final local verification

The isolated incidents module registration test needed a global test provider for its newly
required INCIDENT_EVENTS dependency. Added the test-only provider; its four tests pass. The
final full unit run now has 244 suites/2818 tests passing and only one failing suite/test:
the known local handover PDF parser failure of #311, already reproduced on clean dev. No new
production failure remains. Duration 167.508 seconds. No local full-green claim.

Full db verification on the reused treklink_week9 database saw a loss scheduler counter mismatch,
expected 1, received 6. Created a new database treklink_api13_20261102 on the same local container,
applied existing migrations, and reran without deleting old data: all 41 suites/238 tests pass,
97.989 seconds. The discrepancy did not reproduce on a fresh database. Full HTTP: 21 suites/
441 tests pass, 39.262 seconds. Gateway: 12 suites/90 tests pass on Node 22 matching its SQLite
ABI. Backend tooling uses bundled Node 24.22.1.

The local episode-size read returned maximum 5 linked events in the exercised database. No cap
added. No large episode over a few hundred was observed in this verification.

Coverage of the changed incidents public barrel was also measured separately: 100% lines and
branches. All touched production files meet D-053. Checksum selftest: 61/61 using the existing
Git Bash python3 interpreter. Diff whitespace check passes. Workspace lint/typecheck/build and
frontend results: all workspace lint, typecheck and build commands exit 0; frontend has
101 files/1110 tests passing (215.31 seconds). CI independently verifies
the Linux full suites; known local PDF exception remains disclosed.
