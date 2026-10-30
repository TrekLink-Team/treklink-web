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
- [ ] 1.3 Provide `CONTRACT_CLOSE_CHECKS` (owner HoangTK)
  - **Do**: `blockingReason(contractId, deviceIds)` returns `OPEN_INCIDENTS` when any incident routed to the contract is outside `CLOSED`
  - **Test**: rentals AC-06
  - _Requirements: REQ-STA-02, FR-CON-13, BR-27_

## Phase 2: Creation, routing, alerts

- [ ] 2.1 Outbox and dispatcher (owner HoangTK)
  - **Files**: `backend/src/modules/incidents/alerts/alert-dispatcher.job.ts`, `channels/*.channel.ts`
  - **Do**: `incidents.deliverAlerts` every 2 s reads `PENDING` rows due now with `FOR UPDATE SKIP LOCKED`; channels web inbox, WebSocket (emits `incident.alert`, sent when the listener returns), email through `MailPort`, organization API stream; failure backs off `incidents.alertRetryBaseSeconds × 2^attempts` up to `incidents.alertMaxAttempts`, then `FAILED` and logged; delivery never blocks a transition
  - **Test**: AC-07 with a failing mail transport; WebSocket alert within 2 s of commit under the test load
  - **Note**: the MF-03 PR (2026-10-29, `docs/sessions/2026-10-29-1330-hoangtk-mf03-sos-to-incident.md`) builds the job with the web inbox and WebSocket channels only. Delivery is at least once: the WebSocket alert is emitted before `markSent` commits, so a failed commit repeats it (documented in the job; the banner keys by incident). Email and API event rows stay `PENDING` until their channels land, so the box stays open
  - _Requirements: REQ-UBI-04, REQ-EVT-13, AC-07, FR-INC-12, NFR-PERF-04_
  - _Story: US-UC30_
- [ ] 2.2 Routing (owner HoangTK)
  - **Files**: `backend/src/modules/incidents/routing.service.ts`
  - **Do**: route to the contract and organization the triggering event is attributed to, whatever that contract's state now; `RosterService.tiersAt(orgId, now)`; skip empty tiers; `UNATTRIBUTED` or nobody to alert goes to `UNROUTED`; the device's current holder is never consulted
  - **Test**: AC-09 (A's late SOS after handover to B routes to A); a suspended organization still routed
  - **Note**: `tiersAt` is added by HoangTK in the MF-03 PR (organizations 2.6, read only). Staff recipients of `UNROUTED` and `ESCALATED` are empty until the leader rules how `incidents` reads Staff accounts: platform design Figure 3 has no `incidents --> auth` edge. Open; the box stays open
  - _Requirements: REQ-EVT-03, REQ-STA-01, AC-09, FR-INC-03, BR-32, BR-36_
  - _Story: US-UC29_
- [ ] 2.3 `IncidentIngress.onSos(event, tx)` and `onPosition(event, tx)` (owner HoangTK)
  - **Files**: `backend/src/modules/incidents/incident-ingress.ts`
  - **Do**: the five correlation steps of design §4 under the device lock; reopen inside the reopen window (re-routed, reopen count, owner cleared); cadence: `incidents.cadenceCount` positions within `incidents.cadenceWindowSeconds` and no open incident create `SUSPECTED` from `CADENCE_INFERRED`, upgraded to `CONFIRMED` in place by a later SOS text; positions within `gatewaySync.retroTagGraceSeconds` before the SOS join the episode
  - **Test**: AC-01, AC-05; a replay produces no second incident or alert per tier
  - **Note**: `onSos` and `onPosition` are built in the MF-03 PR (2026-10-29) and run inside ingestion. `onSos` covers the five correlation steps and reopen. An SOS text carries no position, so the last position comes from `onPosition`: a plotted position joins a running episode (not `RESOLVED` or `FALSE_ALARM`) when it is at most `gatewaySync.retroTagGraceSeconds` older than the first SOS, and moves the last position unless its fix time is older than the stored `lastPositionAt` (migration `20261029180000_incident_last_position_at`, PR #114 review). `backend/test/mf03.db-spec.ts` proves create, route, position, replay rejection, append and reopen against Postgres. Leader ruling on PR #114 (2026-10-29): no device packet ends an incident. Past the reopen window the system closes the episode as `SYSTEM` and the SOS opens a new incident; inside the window, or with no window set, the SOS reopens it re-routed as at creation, to `UNROUTED` when unattributed (design §4 step 3). Open, outside the MF-03 happy path: cadence `SUSPECTED` creation, and tagging positions stored before the SOS arrived. The box stays open
  - _Requirements: REQ-EVT-01, REQ-EVT-02, REQ-EVT-10, REQ-ERR-03, AC-01, AC-05, FR-INC-01, FR-INC-02, FR-INC-11, BR-14, NFR-REL-03_
  - _Story: US-UC29, US-UC36_

## Phase 3: Timers

- [ ] 3.1 Scheduler jobs (owner HoangTK)
  - **Files**: `jobs/tier-timeouts.job.ts`, `jobs/stale-responses.job.ts`, `jobs/close-after-reopen-window.job.ts`
  - **Do**: `incidents.tierTimeouts` (5 s) moves `NOTIFY_*` past `tierDeadlineAt` to the next non-empty tier or `ESCALATED` with Staff alerted (MSG34); `incidents.staleResponses` (30 s) moves `ACKNOWLEDGED` or `RESPONDING` past `statusDueAt` to `ESCALATED`, owner kept, Manager and Staff alerted; `incidents.closeAfterReopenWindow` (60 s) closes `RESOLVED` and `FALSE_ALARM` past the window; every job calls `apply()` with the expected state, so a raced human action wins cleanly
  - **Test**: AC-02 with a fake clock; restart with a pending deadline fires once at the stored time (platform AC-09)
  - _Requirements: REQ-EVT-04, REQ-EVT-07, REQ-ERR-04, AC-02, FR-INC-05, FR-INC-07, FR-INC-11, BR-16, NFR-AVL-02_
  - _Story: US-UC31, US-UC37_

## Phase 4: Human actions

- [x] 4.1 Acknowledge, responding, status, resolve (owner HoangTK)
  - **Files**: `backend/src/modules/incidents/incidents.service.ts`
  - **Do**: acknowledge from `NOTIFY_*`, `ESCALATED` or `REPORTED` by a member of the routed organization: owner, time-to-acknowledge, status deadline; the loser of a concurrent acknowledgement gets 409 `ALREADY_OWNED` with the owner (MSG27); responding, status updates (reset the deadline) and resolve (time-to-resolve, reopen window) by the owner only (403 `NOT_OWNER`)
  - **Test**: AC-03 with two concurrent requests
  - **Note**: `IncidentsService` is in place (2026-10-26) and AC-03 passes against Postgres. MSG27 is built in the MF-03 PR (2026-10-29) through `OrganizationsService.memberNames` and passes against Postgres in `backend/test/mf03.db-spec.ts`. The owner name comes from `contactCard`, and the time from the latest `ACKNOWLEDGED` transition row in the display timezone, because `acknowledgedAt` keeps the first acknowledgement after an escalation takeover. A status update moves `statusDueAt` without a version bump, so the owner's `expectedVersion` for resolve stays valid
  - _Requirements: REQ-EVT-05, REQ-EVT-06, REQ-EVT-08, REQ-ERR-02, AC-03, FR-INC-06, FR-INC-07, FR-INC-08_
  - _Story: US-UC32, US-UC33_
- [ ] 4.2 False alarm and owner deactivation (owner HoangTK)
  - **Do**: a member declares a false alarm with a reason from `NOTIFY_*`, `ACKNOWLEDGED` or `RESPONDING`, Staff from `UNROUTED`; listen to `member.deactivated`: an owned `ACKNOWLEDGED` or `RESPONDING` incident goes to `NOTIFY_BACKUP` and alerts that tier
  - **Test**: Staff false alarm from `NOTIFY_PRIMARY` refused 409
  - **Note**: the member false alarm (api-design 07) is built in the MF-03 PR (2026-10-29). Open: Staff from `UNROUTED`, which needs a Staff permission row and the Staff recipients ruling, and the `member.deactivated` listener
  - _Requirements: REQ-EVT-08, REQ-EVT-11, FR-INC-08, D-034_
  - _Story: US-UC34_
- [ ] 4.3 Authority reports (owner HoangTK)
  - **Files**: `authority-reports.service.ts`
  - **Do**: a report with agency, reference and time on an `ESCALATED` or `UNROUTED` incident moves it to `REPORTED`; a report on a `DEFAULTED` contract (api-design 10, 409 `CONTRACT_NOT_DEFAULTED` otherwise); closing the case moves the incident to `CLOSED` (409 `CASE_ALREADY_CLOSED` on a repeat)
  - **Test**: AC-04
  - **Note**: TK-148 (2026-10-30) builds the incident report and the case closure as `AuthorityReportsService` (api-design 08, 09; TK-150 linked for 09). The state is checked before the version, in the order of the api-design 08 activity, and `INVALID_STATE_TRANSITION` reads "This cannot be done while it is {state}." Both edges alert no person, so R1 does not apply. Closing sets `caseClosedAt` once under a row lock; a `REPORTED` incident moves to `CLOSED`, an incident acknowledged after the report keeps its state. Beyond api-design 09: `closedAt` may not be in the future or before `reportedAt` (400), and the closure note goes to the transition and the audit record because `authority_reports` has no closure note column. `backend/test/authority-reports.db-spec.ts` covers AC-04. Open: api-design 10 (a `DEFAULTED` contract), whose story attribution (US-UC35 or US-UC50) waits on KhoaDD, so the box stays open
  - _Requirements: REQ-EVT-09, AC-04, FR-INC-10, BR-17_
  - _Story: US-UC35_
- [ ] 4.4 Stale flag (owner HoangTK)
  - **Do**: `markDeviceStale(deviceId, stale, lastPosition)` from the monitoring sweep flags or clears the incident, state unchanged, and alerts the owner or current tier
  - **Test**: the flag clears when the device is heard again
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
- [ ] 6.2 E2E (owner HoangTK)
  - **Files**: `backend/test/incidents.e2e-spec.ts`, `backend/test/tenancy.e2e-spec.ts`
  - **Do**: every Validation row of api-design 01 to 14; replay ×10 (TC-11); AC-01 to AC-09
  - **Note**: the MF-03 PR (2026-10-29) adds `backend/test/incidents.e2e-spec.ts`, 30 tests over api-design 01 to 07 through the real HTTP pipeline: the JWT guard, each route's CASL policy (Staff refused 403 on member actions), the query and body validation rows, the envelope and messages, and MSG27 as 409. `backend/test/mf03.db-spec.ts` covers the MF-03 main success scenario against Postgres, including a replay. TK-145 (2026-10-30) adds api-design 12 and 14 to that suite: envelope, 401, 404, the UUID check, Staff reads, and 403 for an Org Operator on the alert log. TK-148 (2026-10-30) adds `backend/test/authority-reports.e2e-spec.ts` for api-design 08, 09 and 11 (every Validation row, 403 for Org Operators and Managers, Staff and Admin allowed) and AC-04 in `backend/test/authority-reports.db-spec.ts`. Open: api-design 10 and 13, the tenancy suite on the real routes, replay ×10 (TC-11) and AC-02 and AC-06 to AC-09, so the box stays open
  - _Requirements: AC-01 to AC-09_

## Phase 7: Frontend Integration

- [ ] 7.1 Alert banner (MSG31), incident queue and detail with one-step acknowledge, status and outcome forms, Staff escalation queue and authority report form (owner LongNN, tracked in `specs/frontend/tasks.md` 8.1 to 8.3)

## Phase 8: Verification & DoD

- [ ] 8.1 Suite green; lint, boundary check, typecheck clean; `api-design/*.md` matching behaviour (owner HoangTK)
