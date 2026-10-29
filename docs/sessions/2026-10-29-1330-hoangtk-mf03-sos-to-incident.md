# HoangTK MF-03 SOS to incident, happy path (SD and CO), 2026-10-29

## Goal and dates

- MF-03 runs its main success scenario end to end by Saturday 2026-10-31 (D-066). Issue #98 records that MF-02 stores an SOS but no incident opens.
- This PR runs the D-053 phases for the MF-03 happy path. The SD commits are due today at 17:00 ICT and the CO commits today at 23:00 ICT. UT, to the D-053 bar of 80% branch and 100% line coverage on changed files, and RV follow on the same PR.
- Branch `feat/TK-142-mf03-sos-to-incident` from dev `582c1f2`. TK-142 is the key of the earlier incident PRs #56, #66 and #81.

## Rulings approved by HoangTK before SD

1. CO covers the backend happy path and the organization queue and detail page (frontend 8.1). Timers (3.1), owner deactivation (4.2 listener), authority reports (4.3), the stale flag (4.4), close checks (1.3), the Staff page (8.2) and the authority report page (8.3) are out of this PR.
2. Routing needs `RosterService.tiersAt` (organizations 2.6, TanNB). HoangTK adds the read only, `tiersAt(orgId, instant)`. Shift create, edit, delete and list stay with TanNB.
3. The dispatcher sends the WebSocket and web inbox channels. Email and the organization API stream follow later.
4. SD records the cut list, the design notes below and the spec corrections, on one PR with CO.

## Cut list: the MF-03 happy path

The scenario: a holder on an active contract presses SOS. The event is ingested and attributed (MF-02). An incident opens and routes to the organization's primary tier. The on-duty member gets the MSG31 alert on the banner and in the queue, acknowledges, marks responding, posts a status and resolves.

| Task | Part in this PR | Left for later |
|---|---|---|
| incidents 2.3 | `onSos` with the five correlation steps of design §4, including reopen | `onPosition`, cadence `SUSPECTED` creation, retro-tagging of positions |
| incidents 2.2 | `RoutingService`: route to the attributed contract and organization, `tiersAt`, empty tiers skipped, `UNATTRIBUTED` to `UNROUTED` | Staff recipients (see design note 3) |
| incidents 2.1 | outbox dispatcher job, WEB and WEBSOCKET channels, retry with backoff, `FAILED` at the limit | EMAIL, API_EVENT |
| incidents 4.1 | MSG27 text with the owner's name and time (auth `contactCard` is on dev) | none |
| incidents 4.2 | member false alarm (api-design 07) | Staff false alarm from `UNROUTED`, the `member.deactivated` listener |
| incidents 5.1 | list (01) and detail (02) with device, holder and owner | transitions, events, alerts (12 to 14), monitoring reads |
| incidents 6.1 | `IncidentsController` for api-design 01 to 07 | 08 to 14, `AuthorityReportsController` |
| monitoring 2.3 | `incident.alert` listener in `LiveGateway` to `user:<id>` | none |
| gateway-sync | ingestion calls `onSos` inside its transaction and links the event to the incident | `onPosition` hand-off |
| organizations 2.6 | `tiersAt` read only | everything else of 2.6 |
| frontend 8.1 | `/o/incidents` queue, `/o/incidents/:id` detail, acknowledge, responding, status, resolve, false alarm | transitions, events and alerts tabs (12 to 14) |
| seed | one roster shift for the demo organization, so the demo SOS reaches a primary member | none |

## Design notes (SD)

1. **Recipient ids are user ids.** `Incident.ownerId` and `AlertDelivery.recipientId` reference `User`, and the lifecycle sets the owner from the actor's user id. `tiersAt(orgId, at)` therefore returns user ids: the primary and the backup of the shift with `startsAt <= at < endsAt`, each only while the member is active, and every active `ORG_MANAGER`. No shift, or a shift without a primary, gives an empty tier, which the lifecycle skips (EMPTY_TIER).
2. **Routing input.** Ingestion already holds the custody of `ContractsService.custodyAt` (`contractId`, `organizationId`). It passes both to `onSos`, so routing reads no rentals table. An unattributed SOS routes to `UNROUTED`. A suspended organization is still routed (BR-36); `tiersAt` does not check organization status.
3. **Staff recipients are empty in this PR (gap).** Figure 3 of platform design has no `incidents --> auth` edge, and Staff accounts belong to `auth`. `UNROUTED` and `ESCALATED` transitions therefore write no Staff alert row today, only the API event. The happy path does not reach either state. The fix is a leader ruling: an `auth` port such as a Staff directory provided to `incidents`, or a new Figure 3 edge. Raised in the PR body.
4. **Creation history.** `onSos` inserts the incident in `DETECTED`, writes transition 1 (`fromState` null, reason `CREATED`, `refEventId` the SOS), then calls `IncidentLifecycle.apply` with `ROUTED` for transition 2. Existing lifecycle code is unchanged.
5. **Linking the event.** `field_events` belongs to `gateway-sync`. `onSos` returns the incident id, and `IngestionRepository` sets `incidentId` on its own row in the same transaction (the schema allows the one-way link).
6. **Append and upgrade.** An SOS on an open incident increments `eventCount`, moves `lastEventAt` and the last position, and upgrades `SUSPECTED` to `CONFIRMED`. It does not change the state or the version, so a member's `expectedVersion` stays valid, the same rule as a status update.
7. **Dispatcher.** `incidents.deliverAlerts` runs every 2 s (`*/2 * * * * *`). In one transaction it selects up to 100 `PENDING` rows due now for the channels that have a sender, `FOR UPDATE SKIP LOCKED`. WEB counts as sent once the row exists, since the queue page reads it. WEBSOCKET emits `incident.alert` through the in-process event emitter and counts as sent when the listener returns. A failure bumps `attempts` and sets `nextAttemptAt` to `now + incidents.alertRetryBaseSeconds × 2^attempts`; at `incidents.alertMaxAttempts` the row is `FAILED` and logged. EMAIL and API_EVENT rows stay `PENDING` until their senders land, which is visible in the alert list rather than lost.
8. **Alert payload.** `{ incidentId, code, deviceLabel, holderName, at, message }` (ws-live-contract). `deviceLabel` is the asset tag (`DevicesService.assetTags`). `holderName` is the holder label of the contract device (a new rentals read). `message` is MSG31: `SOS: {device} ({holder}), {time}. Acknowledge now.`, with the time in ICT, HH:mm.
9. **The personal event on the wire.** `incident.alert` goes to `user:<id>` as a `stream` event with `seq: 0`. It is not stored in the stream table, because stream entries are scoped by organization, not by person. The client delivers an `incident.alert` without reading or moving its replay cursor. A missed alert is still in the queue, through the WEB row.
10. **Names.** The owner and status-update authors need `fullName`, which belongs to `auth`. `incidents` reads them through a new `OrganizationsService.memberNames(userIds)`, built on the `contactCard` read organizations already uses. MSG27, `{actor} took this incident at {time}.`, uses the same read and the time of the latest `ACKNOWLEDGED` transition (the 2026-10-26 ruling 5).
11. **Holder label.** A new read in `rentals`, `ContractsService.holderLabels(pairs)` for `(contractId, deviceId)`, returns `holderName` and `holderPhone` of the contract device row. It returns nothing after the contract closes, because the label is erased then (FR-CON-14).
12. **Permissions.** Reads use `ability.can('read', 'Incident')` (`incident.read` for Staff, `incident.read.own` for members), and member actions use `ability.can('respond', 'Incident')` (`incident.respond.own`). The service still checks the organization and answers 404 for another organization's incident.

## Cross-lane edits in this PR

| File | Lane | Why |
|---|---|---|
| `organizations/roster.service.ts`, `OrganizationsService.memberNames` | TanNB | rulings 2, design note 10 |
| `rentals/contracts.service.ts` `holderLabels` | LongLP | design note 11 |
| `gateway-sync/ingestion.service.ts`, `ingestion.repository.ts` | KhoaDD | design notes 2 and 5 |
| `prisma/seed-demo.ts` | KhoaDD | one roster shift for the demo |
| `frontend/src/shared/socket/socketClient.ts` | LongNN | design note 9 |

Every edit adds a read or a call. None changes an existing behaviour of that lane.

## Spec corrections made in SD

- `specs/incidents/tasks.md` 2.1, 2.2, 4.1: notes on the narrowed scope, the Staff-recipient gap, and MSG27 now unblocked.
- `specs/organizations/tasks.md` 2.6: `tiersAt` lands with incidents; the rest stays with TanNB.
- `specs/incidents/design.md` §3: the wire form of `incident.alert` (design note 9).

## Open for the leader

- Design note 3, the Staff recipients of `UNROUTED` and `ESCALATED`.

## CO record (2026-10-29)

### Implementation

- `organizations`: `RosterRepository` and `RosterService.tiersAt`, exported; `OrganizationsService.memberNames`.
- `rentals`: `ContractsService.holderLabels` over `ContractsRepository.findHolderLabels`.
- `incidents`: `RoutingService`, `IncidentIngress.onSos`, `AlertDispatcherJob` (`incidents.deliverAlerts`, every 2 s), the outbox claim and settlement in `AlertDeliveriesRepository`, `IncidentsQueryService`, `IncidentsController` (api-design 01 to 07), `IncidentsService.falseAlarm` and MSG27. The module now imports `organizations`, `rentals` and `devices` (Figure 3 edges) and exports `IncidentIngress`.
- `gateway-sync`: ingestion calls `onSos` for `SOS` and `FALL_SOS` in its transaction and links the event (`IngestionRepository.linkIncident`).
- `monitoring`: `LiveGateway.onIncidentAlert`.
- Seed: one roster shift on ORG-0001, Operator primary and Manager backup.
- Frontend: `entities/incident`, `IncidentsPage`, `IncidentDetailPage`, the routes and the navigation entry, and the `incident.alert` bypass in `socketClient`.

### Verification

- Backend: typecheck and `nest build` passed; lint and the module-boundary check passed (254 files, 9 modules, acyclic). Unit: 106 suites, 1154 tests passed. HTTP and replay e2e: 9 suites, 69 tests passed.
- Postgres: all 5 database suites, 44 tests, passed on a disposable Postgres 16 container with explicit URLs and migrations applied there only. The container was removed afterwards; Neon was not touched. The new `backend/test/mf03.db-spec.ts` runs the main success scenario: an attributed SOS opens an incident in ingestion, routed to `NOTIFY_PRIMARY` with transitions 1 and 2 and the outbox rows; a replay is `DUPLICATE_REJECTED`; the dispatcher sends WEB and WEBSOCKET (MSG31 with the holder) and leaves EMAIL and API_EVENT `PENDING`; a second SOS appends; the primary acknowledges and the backup receives MSG27 naming the owner; responding, status and resolve; an SOS inside the window reopens it.
- Coverage of the changed backend files (incidents and roster): 97.6% lines, 95.7% branches. Below the D-053 bar: `incidents.controller.ts`, 80.4% lines and 0% branches, the DTO transforms and policy lambdas. These are for the UT phase through an HTTP e2e suite (task 6.2).
- Frontend: typecheck, lint and `vite build` passed; 15 files, 292 tests passed.

### Findings recorded in the same pass

- An SOS text carries no position on the wire (firmware ground truth, the SOS PortNum row): the fix arrives as a separate `POSITION_APP` packet, which reaches an incident only through `onPosition`. Until `onPosition` lands, an incident shows "Position unavailable". Recorded in incidents 2.3 and gateway-sync 2.3.
- Running `npm ci` inside `backend/` rebuilds the shared root `node_modules` for that workspace only and drops the frontend packages. Run it at the repository root.

## Completion round (2026-10-29, UT and the position hand-off)

Asked by HoangTK: finish the MF-03 scope with position handling, the HTTP e2e of 6.2, and the D-053 coverage bar, then mark PR #114 ready.

### Changes

- `IncidentIngress.onPosition`: a plotted position joins the device's running episode (not `RESOLVED` or `FALSE_ALARM`) when it is at most `gatewaySync.retroTagGraceSeconds` older than the first SOS. It sets the last position when none is known, or moves it unless the fix is older than the last SOS, and emits `incident.changed` after commit when it moved. Ingestion calls it for every plotted position that is not an SOS and links the event to a joined incident.
- `appendEvent` no longer takes a position, and `SosEvent` carries none: an SOS text never has one (FGT), so those branches could not run. `eventCount` stays a count of SOS packets, and a position never moves `lastEventAt`, the SOS correlation anchor.
- Not built, outside the happy path: cadence `SUSPECTED` creation, and tagging positions stored before the SOS arrived (incidents 2.3 stays open).
- `frontend/src/app/router.tsx`: the dev-only design-system loader is a named function, so the production branch is one line. Behaviour is unchanged.

### Tests added

- Backend: `test/incidents.e2e-spec.ts` (30 tests, api-design 01 to 07 on the real HTTP pipeline); `onPosition` and `movePosition` unit cases; the position step of `test/mf03.db-spec.ts`; unit tests for the repository and service lines this PR's changed files did not yet cover (`ContractsRepository` delegate calls, `OrganizationsService.channelKeyVersion` and `labelsOf`, the `IngestionRepository` reads and writes, the `LiveGateway` refused handshake).
- Frontend: `src/pages/incident-pages.test.tsx` (16 tests), the incident routes and the production build branch in `router.test.tsx`, and the storage-blocked path of `socketClient`.

### Coverage method

D-053 measures the files the PR changes through the CI coverage report, and CI produces none. The backend figure merges the Jest coverage of the unit, e2e and database runs (`istanbul-lib-coverage`, configs rooted at `backend/` in the scratchpad, not committed). The frontend figure uses `@vitest/coverage-v8` 3.2.7, installed with `--no-save` so no dependency enters the PR. One frontend run failed a test while the backend suites ran on the same CPU; three later runs passed, so the failure is load timing, not a defect (unverified which test).

### Verification, completion round

- Backend, in CI order on a fresh disposable Postgres 16 (removed afterwards, Neon untouched): migrations applied; demo seed created 35 row groups and a second run created none; lint and the boundary check passed (255 files, 9 modules, acyclic); typecheck and build passed. Unit: 107 suites, 1175 tests. Database: 5 suites, 44 tests, `mf03.db-spec.ts` now including the position step. HTTP e2e: 10 suites, 99 tests. The `organizations` unit suites were rerun after their last added cases: 23 tests passed.
- Merged coverage of the 22 changed backend production files: 100% lines on every file; branches at least 83.3% on every file (`incidents.controller.ts` 83.3%, the lowest).
- Frontend: typecheck, lint and `vite build` passed; 312 tests passed. Coverage of the 7 changed source files: 100% lines on every file; branches at least 88.5% (`navigation.ts`).

## Closeout (2026-10-29)

### State at close

- Branch `feat/TK-142-mf03-sos-to-incident`, 8 commits on `dev` `582c1f2` (this record is the last), all sealed by HoangTK with `claude-opus-5-5`. `dev` had not moved; nothing to rebase.
- [PR #114](https://github.com/TrekLink-Team/treklink-web/pull/114), open and Ready for Review. Before this record was pushed, CI passed on `60b83ae`: Backend (NestJS), Frontend (React), Gateway Bridge, checksum / verify. Mergeable; blocked only by the required review. Reviewer requested: ruskicoder (KhoaDD); no review or comment yet. Auto-fix is on in the session that opened it.
- Not merged into `dev`, by instruction.
- Left untouched, not this session's: `capstone/.provenance/` and `capstone/Documents/meetings/2026-10-21-screen-design/` (untracked), and the uncommitted edits to the generated backlog files in `treklink-docs/_docs/03-backlog/`.

### Done in this session

- Verified for the leader that HoangTK had five merged PRs (#45, #49, #56, #66, #81) and none since 2026-10-26.
- MF-03 main success scenario (D-066), SD, CO and UT on PR #114: incidents 4.1 ticked; incidents 2.1, 2.2, 2.3, 4.2, 5.1, 6.1, 6.2, monitoring 2.3 and frontend 8.1 built in part, each with a dated note in its `tasks.md`.

### Open and owned by HoangTK

| Task | Remaining |
|---|---|
| incidents 3.1 | `tierTimeouts`, `staleResponses`, `closeAfterReopenWindow`: the escalation half of MF-03 (roadmap MF-03 row: SOS, tiered alert, escalation) |
| incidents 2.2 | Staff recipients of `UNROUTED` and `ESCALATED`, waiting on a leader ruling (below) |
| incidents 2.1 | EMAIL through `MailPort`, the organization API stream |
| incidents 2.3 | cadence `SUSPECTED` creation; tagging positions stored before the SOS |
| incidents 4.2 | Staff false alarm from `UNROUTED`; the `member.deactivated` listener |
| incidents 4.3, 4.4, 1.3 | authority reports; stale flag; `CONTRACT_CLOSE_CHECKS` |
| incidents 5.1, 6.1 | api-design 08 to 14, transitions, events, alerts, monitoring reads, `AuthorityReportsController` |
| incidents 6.2, 8.1 | e2e for 08 to 14, tenancy on the real routes, replay ×10, AC-02, AC-04, AC-06 to AC-09; final DoD |
| monitoring 2.3 | the 2 s socket timing test |
| frontend 8.1 | panels for api-design 12 to 14, device and created-from filters, dirty-form guard |
| frontend 8.2, 8.3 | `StaffIncidentsPage`; authority reports |
| treklink-docs#59 | core direction study, assigned to every member, still open |
| Report 4 (SDD) | co-owner with KhoaDD; Report 5 reviewer (roadmap §documents) |
| Reviews | secondary reviewer of LongNN's monitoring PRs, for example #103 (roadmap lane table) |

### Blockers and dependencies

- **Leader ruling, Staff recipients:** platform design Figure 3 has no `incidents --> auth` edge. Needed before 3.1 can alert Staff on `ESCALATED` (MSG34), and before 4.2 and 8.2 for Staff.
- **PR #114 review by KhoaDD:** the next incidents branch builds on its files. Either wait for the merge and branch from `dev`, or stack on `feat/TK-142-mf03-sos-to-incident` and say so in the new PR.
- **D-066, Saturday 2026-10-31:** MF-03 must run through the real screens and the real API on the seed. This session verified the API and the database path, not a browser walk.
- **Roadmap:** W9 (Nov 2 to 8) Iteration 1 review, W10 all main flows demoable, W11 feature complete.

### Recommended next, in order

1. Walk MF-03 in the browser on the local stack and the demo seed before 2026-10-31: replay an SOS for TL-0009 or TL-0010, see the MSG31 banner as `operator@treklink.local`, then acknowledge, respond, add a status and resolve on `/o/incidents/:id`. Fix what the walk finds on PR #114, and answer KhoaDD's review there.
2. Ask the leader for the Staff-recipients ruling. Then build incidents 3.1, the escalation half of MF-03, as one new story PR through SD, CO, UT and RV (D-053).
3. Then 4.3 with frontend 8.2 and 8.3 (the Staff end of escalation), then api-design 08 to 14 with the 8.1 panels.

### Review round 1 (KhoaDD, changes requested, after the closeout)

Handled on PR #114, started through Auto-fix and finished in a follow-up session on 2026-10-29 at HoangTK's request:

- **Blocking, fixed:** an SOS against a `RESOLVED` or `FALSE_ALARM` incident that could not reopen it (past the window, or unattributed inside it) was appended silently. Now the device closes the episode with `REOPEN_WINDOW_ENDED` and the SOS opens a new incident in the same transaction. `IncidentLifecycle` lets the `DEVICE` actor take that edge, and only for that actor drops the window guard. Covered by ingress and lifecycle unit cases and by steps 8 and 9 of `mf03.db-spec.ts`. Design §4 step 3 records the rule; the §2 diagram label waits for the next handbook-gated diagram pass.
- **Suggestion, fixed:** list and detail scope by the caller's CASL ability, passed from the controller through a new `@CurrentAbility()` in `common/decorators/access.decorator.ts` (incidents sits below `auth`). An unconditioned `read Incident` rule reads every organization; `incident.read.own` reads the caller's organization; an account with no organization and no unconditioned rule is refused 403 before any row is read, so an org-less member can no longer match `organizationId: null` rows either.
- **Suggestion, documented:** WebSocket delivery is at least once; a failed `markSent` commit repeats the alert, and the banner replaces it by incident id.
- **Suggestion, fixed:** `incidents.lastPositionAt` stores the fix time (migration `20261029180000_incident_last_position_at`, additive, backfilled from `lastEventAt` where a position exists). `movePosition` compares against it, so an out-of-order fix newer than the last SOS no longer overwrites a newer position. Unit case in `incidents.repository.reads.spec.ts`, db-spec step 1c.
- **Nits:** one `clockTime` helper (`incidents/display-time.ts`) for MSG27 and MSG31; the incident entity reads `queryString` and `Page` from the new `shared/api/query.ts`. The contract and billing entities keep their copies, because moving them would bring LongLP's `entities/contract/api.ts` (52.6% lines) under this PR's coverage bar; that cleanup is left to the entity owner.

Verification, 2026-10-29: backend lint and module boundaries, 1184 unit tests, 99 e2e tests and `nest build` pass; frontend lint, 312 tests and `tsc && vite build` pass. `test:db` and the new migration were not run locally: no Docker daemon and no Postgres on 5432, and Neon is off limits for tests (D-010). CI runs both against its own `postgres:16` service.

Rebased onto `dev` the same day at HoangTK's request, because the PR had turned `CONFLICTING` and CI does not run on a conflicting PR. Conflicts in `incidents.module.ts` and `incidents.repository.ts` kept both sides: dev's `IncidentsPortsModule` and `countOpenFor`, and this branch's controller, reads and ingress. Three integration fixes followed. Dev's close-check spec now builds `IncidentsRepository` with a `PrismaService`. The module test's stand-in platform module is global, like `PrismaModule` in the app. The new rentals calls spec expects dev's live-row filter `replacedBy: { is: null }`. After the rebase: backend lint, typecheck, 1315 unit tests, 166 e2e tests and the build pass, and frontend lint, 335 tests and the build pass.

### Starting the next session

Open the agent on `capstone/` and paste:

```text
You are an expert assistant specializing in NestJS, Prisma and React on the TrekLink capstone (FPT FA26SE159), a LoRa-mesh trekking safety platform. You are working on project TrekLink for HoangTK (GitHub wangf28), lane owner of the `incidents` module and MF-03 (SOS to tiered alert to escalation). Here is the context of where we left off: the MF-03 main success scenario (D-066) is on PR #114 (https://github.com/TrekLink-Team/treklink-web/pull/114), branch feat/TK-142-mf03-sos-to-incident, Ready for Review with CI green, review requested from KhoaDD (ruskicoder); do not merge it. The full record, open-task table, blockers and recommended order are in treklink-web/docs/sessions/2026-10-29-1330-hoangtk-mf03-sos-to-incident.md; read its Closeout section first and do not redo completed work. Follow AGENTS.md: resolve the docs root, read conventions 07, 10, 11 and 14, the decision register and the roadmap, and check recent session files. Perform a full project scan of treklink-web/specs/incidents (requirements, design, tasks, api-design), backend/src/modules/incidents and the related gateway-sync, organizations and monitoring code, and frontend/src/pages/Incident*.tsx to fully understand the current setup. Check PR #114 for review comments and CI first. Then propose today's task, normally the MF-03 browser walk on the demo seed before Saturday 2026-10-31, then incidents 3.1 escalation timers once the leader rules on Staff recipients. Ask your clarification questions and wait for my approval before writing code.
```
