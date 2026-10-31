# Implementation Tasks: incidents

> Rewritten 2026-10-18 (D-051) in the full task format of `specs/README.md` §6. Fulfills `design.md`;
> endpoints are `api-design/01` to `14`. The lifecycle (D-034) and the alert outbox are the graded state
> machine and the MF-03 core.

| | |
|---|---|
| Lane owner | HoangTK (roadmap §5.1) |
| Reviewer | KhoaDD |
| Sprint | 4 (W9 to W10); Phase 1 and 2.3 start in Sprint 3 so gateway-sync can hand over SOS events |
| Stories | US-UC29, US-UC30, US-UC31, US-UC32, US-UC33, US-UC34, US-UC35, US-UC36, US-UC37 |
| Depends on | platform 2.7 and 2.8; auth 5.2 (`contactCard`); organizations 2.6 (`tiersAt`); rentals 4.5 |
| Unblocks | gateway-sync 2.3 (SOS hand-off), monitoring 2.3 (`incident.alert` listener), rentals 4.4 (close checks) |

## Phase 1: Foundation & Domain Modeling

- [x] 1.1 `IncidentsModule` and repositories (owner HoangTK)
  - **Files**: `backend/src/modules/incidents/incidents.module.ts`, `incidents.repository.ts`, `alert-deliveries.repository.ts`, `authority-reports.repository.ts`
  - **Do**: repositories over the `// @module incidents` models only; incident code `INC-<year>-<6 digits>` as the `schema.prisma` example `INC-2026-000045`; `incidents_one_open_per_device` maps to the correlation path, never to a 500
  - _Requirements: REQ-UBI-02, BR-13_
- [x] 1.2 `IncidentLifecycle.apply(id, expectedState, to, actor, reason, tx)` (owner HoangTK)
  - **Files**: `backend/src/modules/incidents/incident-lifecycle.ts`
  - **Do**: the D-034 transition table of design §2 with guards; compare-and-set on `state` and `version`; one sequenced `IncidentTransition` row; set or clear `tierDeadlineAt`, `statusDueAt`, owner and the reopen window per target state; outbox rows of design §3 in the same transaction; `incident.changed` and `audit.record` after commit; a packet never moves an incident except to open or reopen it
  - **Test**: `incident-lifecycle.spec.ts` over every pair of the twelve states (AC-06); each owned state has an owner with a status deadline or a pending tier deadline
  - _Requirements: REQ-UBI-01, REQ-UBI-03, REQ-UBI-04, REQ-UBI-05, REQ-ERR-01, AC-06, FR-INC-04, BR-15, BR-18, NFR-REL-07_
- [x] 1.3 Provide `CONTRACT_CLOSE_CHECKS` (owner HoangTK)
  - **Do**: `blockingReason(contractId, deviceIds)` returns `OPEN_INCIDENTS` when any incident routed to the contract is outside `CLOSED`
  - **Test**: rentals AC-06
  - **Note**: built by LongLP in the rentals close-guard work (`60652b7`, review of #104) as `IncidentsCloseCheck` in `providers/contract-close-check.provider.ts`, registered by `IncidentsPortsModule`; it also blocks on an open incident of any of the contract's devices. Unit-tested in `contract-close-check.provider.spec.ts`; ticked in TK-144 (2026-10-30)
  - _Requirements: REQ-STA-02, FR-CON-13, BR-27_

## Phase 2: Creation, routing, alerts

- [ ] 2.1 Outbox and dispatcher (owner HoangTK)
  - **Files**: `backend/src/modules/incidents/alerts/alert-dispatcher.job.ts`, `channels/*.channel.ts`
  - **Do**: `incidents.deliverAlerts` every 2 s reads `PENDING` rows due now with `FOR UPDATE SKIP LOCKED`; channels web inbox, WebSocket (emits `incident.alert`, sent when the listener returns), email through `MailPort`, organization API stream; failure backs off `incidents.alertRetryBaseSeconds × 2^attempts` up to `incidents.alertMaxAttempts`, then `FAILED` and logged; delivery never blocks a transition
  - **Test**: AC-07 with a failing mail transport; WebSocket alert within 2 s of commit under the test load
  - **Note**: the MF-03 PR (2026-10-29, `docs/sessions/2026-10-29-1330-hoangtk-mf03-sos-to-incident.md`) built the web inbox and WebSocket channels. TK-143 EMAIL dispatch (2026-10-31, HoangTK) adds the existing `MAIL_PORT`: each EMAIL row resolves only its recipient through `AccountsService.contactCard` and sends one message through the configured transport. Missing recipients and transport failures use the same persisted backoff and attempt limit. Delivery remains at least once: SMTP acceptance and WebSocket emission happen before `markSent` commits, so a failed settlement can repeat delivery. API_EVENT rows and the connected-socket 2-second timing proof remain open; this box stays unchecked
  - **Partly done** (2026-10-31, KhoaDD under D-078, reviews of #214 and #215): the dispatcher has two lanes, `incidents.deliverAlerts` (WEB, WEBSOCKET) and `incidents.deliverEmailAlerts` (EMAIL). EMAIL rows are claimed and leased in a short transaction, sent outside any transaction with a 10 s bound (`EMAIL_SEND_TIMEOUT_MS`, `TODO(params)` until a catalog parameter exists), and settled one row per transaction. A committed transition that queued rows emits `incident.alertsQueued`, which wakes both lanes; a lane claims again while a batch is full and never overlaps itself; the 2 s cron stays as the backstop. API_EVENT is still open
  - _Requirements: REQ-UBI-04, REQ-EVT-13, AC-07, FR-INC-12, NFR-PERF-04_
  - _Story: US-UC30_
- [ ] 2.2 Routing (owner HoangTK)
  - **Files**: `backend/src/modules/incidents/routing.service.ts`
  - **Do**: route to the contract and organization the triggering event is attributed to, whatever that contract's state now; `RosterService.tiersAt(orgId, now)`; skip empty tiers; `UNATTRIBUTED` or nobody to alert goes to `UNROUTED`; the device's current holder is never consulted
  - **Test**: AC-09 (A's late SOS after handover to B routes to A); a suspended organization still routed
  - **Note**: `tiersAt` was added by HoangTK in the MF-03 PR (organizations 2.6, read only). D-079 adds the `incidents --> auth` edge and `AccountsService.activeStaffAndAdminIds`; TK-144 uses it for `ESCALATED`. **Implementation pending review** (2026-10-31, TK-143 / US-UC30, HoangTK): task 2.2 now uses that same transactional read for `UNROUTED` creation and reopening, including an attributed organization with no reachable members. The existing lifecycle writes the recipient outbox rows. This notification slice traces FR-INC-12 and design §3 through TK-143; TK-142 stays closed. It follows PR #114's deferred Staff recipients and issue #118 R1 (resolved), not API 13/R2. Routing attribution and escalation rules are unchanged. Task 2.2 stays unchecked until its broader routing acceptance evidence is reconciled; TK-143 also retains the deferred email and API-event channels of task 2.1
  - _Requirements: REQ-EVT-03, REQ-STA-01, AC-09, FR-INC-03, BR-32, BR-36_
  - **Verification** (TK-143): routing unit tests cover both UNROUTED routes, empty recipients, transaction propagation and read failure (100% lines and branches). The new incidents-unrouted-alerts.db-spec.ts covers active Staff/Admin, dual-role deduplication, inactive/deleted exclusion, creation, reopening, ten replays, suspended-organization attribution and atomic rollback on disposable Postgres. Existing escalation and authority-report suites pass
  - _Story: US-UC29_
- [ ] 2.3 `IncidentIngress.onSos(event, tx)` and `onPosition(event, tx)` (owner HoangTK)
  - **Files**: `backend/src/modules/incidents/incident-ingress.ts`
  - **Do**: the five correlation steps of design §4 under the device lock; reopen inside the reopen window (re-routed, reopen count, owner cleared); cadence: `incidents.cadenceCount` positions within `incidents.cadenceWindowSeconds` and no open incident create `SUSPECTED` from `CADENCE_INFERRED`, upgraded to `CONFIRMED` in place by a later SOS text; positions within `gatewaySync.retroTagGraceSeconds` before the SOS join the episode
  - **Test**: AC-01, AC-05; a replay produces no second incident or alert per tier
  - **Note**: `onSos` and `onPosition` are built in the MF-03 PR (2026-10-29) and run inside ingestion. `onSos` covers the five correlation steps and reopen. An SOS text carries no position, so the last position comes from `onPosition`: a plotted position joins a running episode (not `RESOLVED` or `FALSE_ALARM`) when it is at most `gatewaySync.retroTagGraceSeconds` older than the first SOS, and moves the last position unless its fix time is older than the stored `lastPositionAt` (migration `20261029180000_incident_last_position_at`, PR #114 review). `backend/test/mf03.db-spec.ts` proves create, route, position, replay rejection, append and reopen against Postgres. Leader ruling on PR #114 (2026-10-29): no device packet ends an incident. Past the reopen window the system closes the episode as `SYSTEM` and the SOS opens a new incident; inside the window, or with no window set, the SOS reopens it re-routed as at creation, to `UNROUTED` when unattributed (design §4 step 3). Open, outside the MF-03 happy path: cadence `SUSPECTED` creation, and tagging positions stored before the SOS arrived. The box stays open
  - _Requirements: REQ-EVT-01, REQ-EVT-02, REQ-EVT-10, REQ-ERR-03, AC-01, AC-05, FR-INC-01, FR-INC-02, FR-INC-11, BR-14, NFR-REL-03_
  - _Story: US-UC29, US-UC36_

## Phase 3: Timers

- [x] 3.1 Scheduler jobs (owner HoangTK)
  - **Files**: `backend/src/modules/incidents/jobs/incident-timers.job.ts`
  - **Do**: `incidents.tierTimeouts` (5 s) moves `NOTIFY_*` past `tierDeadlineAt` to the next non-empty tier or `ESCALATED` with Staff alerted (MSG34); `incidents.staleResponses` (30 s) moves `ACKNOWLEDGED` or `RESPONDING` past `statusDueAt` to `ESCALATED`, owner kept, Manager and Staff alerted; `incidents.closeAfterReopenWindow` (60 s) closes `RESOLVED` and `FALSE_ALARM` past the window; every job calls `apply()` with the expected state, so a raced human action wins cleanly
  - **Test**: AC-02 with a fake clock; restart with a pending deadline fires once at the stored time (platform AC-09)
  - **Note**: built in TK-144 (2026-10-30) as one `IncidentTimersJob` with the three scheduled methods, sharing one loop (design §6). Each run reads up to 100 due incidents through `IncidentsRepository.dueTimers` and applies one transition per incident in its own transaction as `SYSTEM`; a `STALE_VERSION` or `INVALID_STATE_TRANSITION` from `apply()` means a person or an SOS moved it first and is skipped, any other failure is logged and retried on the next tick. Recipients come from `RoutingService.recipientsOf`, the routed organization's tiers at the run time. A window never set is not selected, so it never closes (leader ruling on PR #114). `backend/test/mf03-escalation.db-spec.ts` proves AC-02 with the empty backup tier skipped, the stale escalation with the owner kept, the window close and the null window against Postgres, by moving deadlines into the past instead of a fake clock; a deadline that fired once is not selected again. Staff recipients of `ESCALATED` follow D-079 (2026-10-30, KhoaDD under D-078): `RoutingService.recipientsOf` reads `AccountsService.activeStaffAndAdminIds`, the active accounts holding the `STAFF` or `ADMIN` role, through the new `incidents --> auth` edge of platform design Figure 3, so the lifecycle writes one alert row per account and channel; the db spec checks that two active Staff accounts and an Admin get one row per channel each, an inactive Staff account none, and a second run no further rows (HoangTK, 2026-10-30). Leader ruling 2026-10-30 (KhoaDD, answering the confirmation asked on PR #120): Admin is included, as design §3 stated before, and an account with an invitation not yet accepted is still alerted. The timer states are typed, so `NEXT` is a complete `Record` and needs no non-null assertion (PR #120 review). Restart test, leader ruling on PR #120: the db spec is accepted for platform AC-09 and REQ-ERR-04. The job keeps no in-memory timer state and re-reads (state, deadline) from Postgres on every tick, so moving stored deadlines into the past and checking that a second run selects nothing proves fire-once; no boot, stop and reboot test is written
  - _Requirements: REQ-EVT-04, REQ-EVT-07, REQ-ERR-04, AC-02, FR-INC-05, FR-INC-07, FR-INC-11, BR-16, NFR-AVL-02_
  - _Story: US-UC31, US-UC37_

## Phase 4: Human actions

- [x] 4.1 Acknowledge, responding, status, resolve (owner HoangTK)
  - **Files**: `backend/src/modules/incidents/incidents.service.ts`
  - **Do**: acknowledge from `NOTIFY_*`, `ESCALATED` or `REPORTED` by a member of the routed organization: owner, time-to-acknowledge, status deadline; the loser of a concurrent acknowledgement gets 409 `ALREADY_OWNED` with the owner (MSG27); responding, status updates (reset the deadline) and resolve (time-to-resolve, reopen window) by the owner only (403 `NOT_OWNER`)
  - **Test**: AC-03 with two concurrent requests
  - **Note**: `IncidentsService` is in place (2026-10-26) and AC-03 passes against Postgres. MSG27 is built in the MF-03 PR (2026-10-29) through `OrganizationsService.memberNames` and passes against Postgres in `backend/test/mf03.db-spec.ts`. The owner name comes from `contactCard`, and the time from the latest `ACKNOWLEDGED` transition row in the display timezone, because `acknowledgedAt` keeps the first acknowledgement after an escalation takeover. A status update moves `statusDueAt` without a version bump, so the owner's `expectedVersion` for resolve stays valid
  - **Note**: 2026-10-30, KhoaDD under D-078, dry run defect 15: a status update is corrected by a new one. `POST /api/incidents/:id/status-updates` takes an optional `correctsId` (api-design 05); the corrected row stays as written, because `incident_status_updates` is append-only. Migration `20261030230000_incident_status_update_corrections` adds the nullable, unique `correctsId` self relation. A foreign or unknown id is 400 `VALIDATION_FAILED`, an update already corrected 409 `CONFLICT_UNIQUE`, both checked under the incident row lock after the owner and state checks. A correction resets the stale timer like any status update. The detail read (api-design 02) returns `correctsId` and `correctedById`; the detail page offers Correct on an uncorrected update and shows the corrected badge (frontend ui-design 8-1). Like any status update, a correction is refused with 409 `INVALID_STATE_TRANSITION` once the incident is `RESOLVED` or `CLOSED`. Unit tests in `incidents.service.spec.ts`, `incidents.controller.spec.ts`, `incidents-query.service.spec.ts` and `incidents.repository.spec.ts`; `backend/test/incidents.db-spec.ts` checks against Postgres that the corrected row is unchanged, a second correction is 409, a foreign incident is 400, a correction can be corrected once, and the trigger still refuses an edit in place. No e2e spec
  - _Requirements: REQ-EVT-05, REQ-EVT-06, REQ-EVT-08, REQ-EVT-14, REQ-ERR-02, AC-03, FR-INC-06, FR-INC-07, FR-INC-08_
  - _Story: US-UC32, US-UC33_
- [x] 4.2 False alarm and owner deactivation (owner HoangTK)
  - **Do**: a member declares a false alarm with a reason from `NOTIFY_*`, `ACKNOWLEDGED` or `RESPONDING`, Staff from `UNROUTED`; listen to `member.deactivated`: an owned `ACKNOWLEDGED` or `RESPONDING` incident goes to `NOTIFY_BACKUP` and alerts that tier
  - **Test**: Staff false alarm from `NOTIFY_PRIMARY` refused 409
  - **Done** (2026-10-30, TK-147, HoangTK): Staff/Admin API 07 uses the existing `incident.respondUnrouted` permission. The service locks and checks `UNROUTED`, then supplies the STAFF actor and expectedVersion to the lifecycle; other states return 409, a stale version returns `STALE_VERSION`, and member organization isolation is unchanged. No new permission or migration was needed. This supersedes the permission/R1 open item in the earlier note below. Unit, HTTP and disposable-Postgres regression tests cover Staff/Admin, required reason/version, invalid states, member isolation, concurrent declarations and rollback. Together with the merged #140 listener, task 4.2 is complete
  - **Note**: the member false alarm (api-design 07) is built in the MF-03 PR (2026-10-29). Open: Staff from `UNROUTED`, which needs a Staff permission row and the Staff recipients ruling. **Partly done** (2026-10-30, KhoaDD under D-078): the `member.deactivated` listener is built as `OwnerDeactivationListener`; it moves each `ACKNOWLEDGED` or `RESPONDING` incident the member owns to `NOTIFY_BACKUP` as `SYSTEM` with `OWNER_DEACTIVATED`, one transaction each, with the recipients of `RoutingService.recipientsOf`: the organization's tiers after the member left the roster, plus the active TrekLink Staff and Admin, so when every tier is empty the `EMPTY_TIER` cascade reaches `ESCALATED` with them alerted (REQ-EVT-04, review of PR #140); a raced move is skipped and any other failure is logged, so the status deadline still escalates it. Importing the event from `auth` uses the `incidents --> auth` edge of platform design Figure 3 (D-079). `backend/test/incidents-owner-deactivation.db-spec.ts` covers an `ACKNOWLEDGED` owner to `NOTIFY_BACKUP`, a `RESPONDING` owner past an empty backup to `NOTIFY_MANAGER`, and every tier empty to `ESCALATED` with Staff and Admin alerted
  - _Requirements: REQ-EVT-08, REQ-EVT-11, FR-INC-08, D-034_
  - _Story: US-UC34_
- [x] 4.3 Authority reports (owner HoangTK)
  - **Files**: `authority-reports.service.ts`
  - **Do**: a report with agency, reference and time on an `ESCALATED` or `UNROUTED` incident moves it to `REPORTED`; a report on a `DEFAULTED` contract (api-design 10, 409 `CONTRACT_NOT_DEFAULTED` otherwise); closing the case moves the incident to `CLOSED` (409 `CASE_ALREADY_CLOSED` on a repeat)
  - **Test**: AC-04
  - **Note**: TK-148 (2026-10-30) builds the incident report and the case closure as `AuthorityReportsService` (api-design 08, 09; TK-150 linked for 09). The state is checked before the version, in the order of the api-design 08 activity, and `INVALID_STATE_TRANSITION` reads "This cannot be done while it is {state}." Both edges alert no person, so R1 does not apply. Closing sets `caseClosedAt` once under a row lock; a `REPORTED` incident moves to `CLOSED`, an incident acknowledged after the report keeps its state. Beyond api-design 09: `closedAt` may not be in the future or before `reportedAt` (400), and the closure note goes to the transition and the audit record because `authority_reports` has no closure note column. `backend/test/authority-reports.db-spec.ts` covers AC-04. Open: api-design 10 (a `DEFAULTED` contract), whose story attribution (US-UC35 or US-UC50) waits on KhoaDD, so the box stays open
  - **Done** (2026-10-30, KhoaDD under D-078, on top of TK-148 by the leader's ruling): api-design 10 is `AuthorityReportsService.reportContract` with `POST /authority-reports` on `AuthorityReportsController`, kept with this task and US-UC35. It reads the contract status through `ContractsService.statusOf` (rentals, no row lock): a missing contract is 404 (row added to api-design 10), another status 409 `CONTRACT_NOT_DEFAULTED` naming it, and the contract state never changes. Agency and reference take at most 200 characters, as in the api-design 08 DTO; `reportedAt` has no bound (screen 8.3 H-05). Tests: `authority-reports.contract.spec.ts`, `test/authority-reports-contract.e2e-spec.ts`
  - **Note** (2026-10-30, KhoaDD under D-078, #137 review follow-up): closing a case moves a `REPORTED` incident to `CLOSED` only when no other report on that incident is still open, so an incident reported again after a reopen and an escalation keeps its later case open. The count runs after the incident row lock, so two closures on one incident serialise and the last one closes it. api-design 09 lists the two `closedAt` 400 rows
  - _Requirements: REQ-EVT-09, AC-04, FR-INC-10, BR-17_
  - _Story: US-UC35_
- [ ] 4.4 Stale flag (owner HoangTK)
  - **Do**: `markDeviceStale(deviceId, stale, lastPosition)` from the monitoring sweep flags or clears the incident, state unchanged, and alerts the owner or current tier
  - **Test**: the flag clears when the device is heard again
  - **Partly done** (2026-11-01, KhoaDD under D-078, task W9): `IncidentsService.markDeviceStale(deviceId, stale, lastSeenAt, tx)`, exported to monitoring, sets or clears `stale` on the device's incident outside `CLOSED` under its row lock, in the staleness sweep's transaction; state, owner, deadlines and `version` stay (design §5). A change emits `incident.changed` and an `incident.stale` audit record after commit, so the queue and detail badge "Device silent" (screen 8.1) refreshes live; the frontend already rendered it. Tests: `incidents.service.spec.ts`, `test/incident-stale-flag.db-spec.ts` (flag kept with state and version, cleared once on recovery, a `CLOSED` incident untouched, rollback). Open: the alert to the owner or current tier (design §3 "stale flag" row). Every `alert_deliveries` row needs a `transitionId` and the dispatcher sends MSG31 for every row, so the alert waits for a leader ruling on its record and its text; the box stays open
  - _Requirements: REQ-EVT-12, FR-INC-13_

## Phase 5: Query / Retrieval

- [ ] 5.1 Incidents, transitions, events, alerts, authority reports (owner HoangTK)
  - **Do**: list with state, organization and stale filters (members see their own only); detail; transitions; events through `GatewaySyncService.eventsOfIncident`; alert deliveries; authority reports; `openByDevices`, `incidentsOfDevice`, `responseTimes(range)`, `alertDeliveryStats()` for monitoring
  - **Test**: a member reading another organization's incident gets 404 (auth AC-01)
  - **Note**: list and detail (api-design 01, 02) are built in the MF-03 PR (2026-10-29) as `IncidentsQueryService`. Both scope by the caller's CASL ability (PR #114 review): an unconditioned `incident.read` rule reads every organization, `incident.read.own` the caller's own, and an account with no organization and no unconditioned rule gets 403. The `stale` list filter waits for 4.4. Transitions (api-design 12) and alert deliveries (api-design 14) are built in TK-145 (2026-10-30) through the same scope check: the trail needs `read Incident`, the alert log `read AlertDelivery` (`alertDelivery.read` for Staff, `alertDelivery.read.own` for an Org Manager), so an Org Operator gets 403. `actor` is `SYSTEM` or the person's name, and `recipient` is null for an organization API event; an account `contactCard` cannot name is shown by its id. `sentAt` and `lastError` are returned as null when unset. Authority reports (api-design 11) are built in TK-148 (2026-10-30): open cases first, then `reportedAt` newest first, so a page without the `open` filter starts the closed group where the open one ends. Open: events (api-design 13, waits for R2 in treklink-web#118) and the monitoring reads
  - _Requirements: REQ-STA-01, FR-AUTH-11_

## Phase 6: API Presentation Layer

- [ ] 6.1 Controllers (owner HoangTK)
  - **Files**: `incidents.controller.ts`, `authority-reports.controller.ts`
  - **Do**: api-design 01 to 14 with each file's permission and `@ResponseMessage`
  - **Note**: `IncidentsController` serves api-design 01 to 07 since the MF-03 PR (2026-10-29), and 12 and 14 since TK-145 (2026-10-30). TK-148 (2026-10-30) adds 08 to `IncidentsController` and `AuthorityReportsController` with 09 and 11, each needing `authorityReport.manage` (Staff, Admin). Open: 10 and 13
  - **Partly done** (2026-10-30, KhoaDD under D-078): `AuthorityReportsController` also serves api-design 10 (`manage AuthorityReport`). The list (11) checks `read AuthorityReport`, which `authorityReport.manage` grants. Open: 13
- [ ] 6.2 E2E (owner HoangTK)
  - **Files**: `backend/test/incidents.e2e-spec.ts`, `backend/test/tenancy.e2e-spec.ts`
  - **Do**: every Validation row of api-design 01 to 14; replay ×10 (TC-11); AC-01 to AC-09
  - **Note**: the MF-03 PR (2026-10-29) adds `backend/test/incidents.e2e-spec.ts`, 30 tests over api-design 01 to 07 through the real HTTP pipeline: the JWT guard, each route's CASL policy (Staff refused 403 on member actions), the query and body validation rows, the envelope and messages, and MSG27 as 409. `backend/test/mf03.db-spec.ts` covers the MF-03 main success scenario against Postgres, including a replay. TK-145 (2026-10-30) adds api-design 12 and 14 to that suite: envelope, 401, 404, the UUID check, Staff reads, and 403 for an Org Operator on the alert log. TK-148 (2026-10-30) adds `backend/test/authority-reports.e2e-spec.ts` for api-design 08, 09 and 11 (every Validation row, 403 for Org Operators and Managers, Staff and Admin allowed) and AC-04 in `backend/test/authority-reports.db-spec.ts`. Open: api-design 10 and 13, the tenancy suite on the real routes, replay ×10 (TC-11) and AC-02 and AC-06 to AC-09, so the box stays open
  - _Requirements: AC-01 to AC-09_

## Phase 7: Frontend Integration

- [ ] 7.1 Alert banner (MSG31), incident queue and detail with one-step acknowledge, status and outcome forms, Staff escalation queue and authority report form (owner HoangTK per D-053 rule 4, tracked in `specs/frontend/tasks.md` 8.1 to 8.3; the alert banner is LongNN's shell work, frontend 1.4)

## Phase 8: Verification & DoD

- [ ] 8.1 Suite green; lint, boundary check, typecheck clean; `api-design/*.md` matching behaviour (owner HoangTK)
