# Implementation Tasks: monitoring

> Rewritten 2026-10-18 (D-051) in the full task format of `specs/README.md` §6. Fulfills `design.md`;
> endpoints are `api-design/01` to `08`; live push is `api-design/ws-live-contract.md`. This module is
> the read model and may import every other module (`platform` design §2.1).

| | |
|---|---|
| Lane owner | LongNN, backend and screens (D-056, roadmap §5.1); task 2.3 is HoangTK's, the alert delivery of MF-03 |
| Reviewer | KhoaDD; HoangTK is the secondary reviewer, since MF-03 consumes `LiveGateway` |
| Fallback | D-056 rule 5: if 1.1 has no open PR two working days after `platform` Phase 1 merges, or 1.1 and 2.1 are not merged before the `review-2` tag, both move back to HoangTK |
| Sprint | 4 (W9 to W10); 1.1 and 2.1 start in Sprint 3 so MF-02 events show on a map at Review 2 |
| Stories | US-UC38, US-UC39, US-UC40, US-UC41, US-UC42, US-UC53 (device history), US-UC59 |
| Depends on | gateway-sync 2.2; rentals 4.5; incidents 5.1; organizations 2.8; billing 2.4 |

## Phase 1: Foundation

- [x] 1.1 `MonitoringModule`, stream and `LiveGateway` (owner LongNN)
  - **Files**: `backend/src/modules/monitoring/monitoring.module.ts`, `stream.repository.ts`, `stream.service.ts`, `live.gateway.ts`
  - **Do**: `StreamEvent` repository (`insert`, `after(organizationId, seq, limit)`, `maxSeq`); Socket.io namespace `/live` with JWT and API-key handshakes; rooms assigned by the server only (`fleet`, `org:<id>`, `user:<id>`) per design §2 and `ws-live-contract.md`; an entry with no organization goes to `fleet` only
  - **Test**: a client cannot join a room by naming it; an `UNATTRIBUTED` entry reaches `fleet` only
  - _Requirements: REQ-UBI-01, FR-MON-02, FR-MON-06, BR-19, BR-36_

## Phase 2: Stream

- [ ] 2.1 Stream listeners (owner LongNN)
  - **Files**: `stream.listener.ts`, `DeviceRelease` in `schema.prisma` and its migration
  - **Do**: listen to `field.position`, `field.telemetry`, `incident.changed`, `device.labelChanged`, `device.handedOver`, `device.checkedIn`; take the organization from the event (field: attributed, incident: routed, `device.*`: named in the event), with no holder lookup; record each check-in in `DeviceRelease` and mark a field entry `late` when it occurred at or before the organization's latest check-in of the device, keeping it off the live map; throttle positions per device to `monitoring.positionEmitMinIntervalMs`; on check-in emit `device.released` and send nothing about the device after it; never push an entry marked not plotted as a position
  - **Test**: AC-01, AC-04 (not plotted), AC-05, AC-06
  - _Requirements: REQ-UBI-03, REQ-EVT-01, REQ-EVT-04, AC-01, AC-04, AC-05, AC-06, FR-MON-02, FR-MON-04, FR-MON-08, BR-22_
  - _Story: US-UC38_
  - **Status**: all six listeners are built. Each event already names its organization, so no `currentHolder` lookup exists and none is needed; the latest check-in of a device is stored in `DeviceRelease`, which pruning the stream never touches. Two parts wait on other modules: `incident.changed` carries ids only until `incidents` exports a read for `code`, `ownerName`, `lastPosition` and `stale`, while `rentals` now emits and exports `device.checkedIn`, which the listener uses. The box stays unticked until the incident enrichment lands.
  - **Partly done** (2026-10-30, KhoaDD under D-078, review of #157): `device.released` carries the `contractId` of the check-in, as `device.handedOver` does (ws-live-contract), so a client refreshes only that contract's invoices; `stream.listener.spec.ts` asserts it
  - **Partly done** (2026-10-31, KhoaDD under D-078, follow-up of #189): `incident.changed` names the incident's device in the entry's `deviceId`; every `incidents` emitter adds it to the in-process event, so the live map updates the marker from the entry. It still reloads the snapshot for an incident the marker does not hold yet, whose `code` only the snapshot carries until the enrichment (frontend `needsSnapshot`, review of #201). An event without it publishes `deviceId: null`. `stream.listener.spec.ts` and the three `incidents` emitter specs assert it
- [ ] 2.2 Replay and key revocation (owner LongNN)
  - **Do**: on connect or reconnect with a cursor, replay every entry after it for the client's rooms, then `replay.done`, then live; a cursor older than `monitoring.streamRetentionHours` gets `replay.expired` (REST 410); on `apiKey.revoked` close that key's sockets
  - **Test**: AC-02 (two minutes disconnected, every entry once and in order)
  - **Status**: the socket side is built: replay in batches for the client's scope, `replay.done` with its cursor, `replay.expired` for a cursor outside the retention window, live entries held back during a replay, and key revocation by `apiKey.revoked`. The REST 410 belongs to `GET /api/telemetry/stream` (task 3.2). `organizations` emits `apiKey.revoked` since 2026-10-30 (chain 2) and the REST 410 is in task 3.2; the box stays unticked until a socket test closes a real revoked key.
  - _Requirements: REQ-EVT-02, REQ-EVT-08, AC-02, FR-MON-05, FR-ORG-06_
- [x] 2.3 `incident.alert` publishing (owner HoangTK)
  - **Do**: a synchronous listener publishes the alert to `user:<recipientId>`; returning means sent (incidents design §3)
  - **Test**: an alert reaches the recipient's socket within 2 s of the transition commit
  - **Note**: `LiveGateway.onIncidentAlert` sends a `stream` event with `seq: 0` to `user:<id>` (incidents design §3). `backend/test/incident-alert-socket.db-spec.ts` verifies real authenticated clients against PostgreSQL. A committed transition wakes the dispatcher through `incident.alertsQueued` (incidents design §3), and the 2 s cron is only the backstop: five deliveries from three committed incidents, whose two UNROUTED incidents queue more WEB and WEBSOCKET rows than one claim batch of 100 (the suite tops the active Staff and Admin accounts up to 30 and counts the rows before asserting), reach their recipients within 2 s; one more case stops both dispatcher crons and still receives the alert within 2 s. It also verifies recipient isolation, rejected authentication, scoped reconnection, at-least-once duplicates and rollback isolation on the delivery rows. Ticked again 2026-10-31 by KhoaDD under D-078 after the review of #215: three local runs on Postgres 16 passed with the longest burst delivery at 24.3 ms. This is local verification, not a production load guarantee; see `docs/sessions/2026-10-31-1420-khoadd-tk143-dispatcher-review-fixes.md`.
  - _Requirements: REQ-EVT-07, FR-INC-12, NFR-PERF-04_
- [x] 2.4 Staleness sweep and pruning (owner LongNN)
  - **Files**: `jobs/stale-sweep.job.ts`, `jobs/prune-stream.job.ts`
  - **Do**: `monitoring.staleSweep` every `monitoring.staleSweepSeconds`: devices past `monitoring.deviceStaleSeconds` and stations past `monitoring.fieldStationStaleSeconds` emit stale and recovered transitions only and call `IncidentsService.markDeviceStale`; `monitoring.pruneStream` hourly deletes entries past retention
  - **Test**: AC-03; a device heard again emits one recovery
  - **Status**: `monitoring.pruneStream` is built (`jobs/prune-stream.job.ts`): hourly at minute 10, it deletes `stream_events` older than `monitoring.streamRetentionHours` in batches of 5000 and never touches `device_releases`.
  - **Done** (2026-11-01, KhoaDD under D-078, task W9): `monitoring.staleSweep` is `jobs/stale-sweep.job.ts`, a 5 s cron that sweeps once per `monitoring.staleSweepSeconds` under the job runner's advisory lock. It needed no new read: devices in custody come from `ContractsService.visibleDevices`, their `lastSeenAt` from `DevicesService.projections` and stations from `OrganizationsService.fieldStationHealth`, the reads of the snapshot, with the snapshot's rule (never stale before the first reading). Each transition is a row of the new `stale_marks` table (migration `20261101090000_monitoring_stale_marks`, design §1), written or deleted in one transaction with `IncidentsService.markDeviceStale`, and `monitoring.deviceStale` or `monitoring.stationStale` is emitted after commit; `StreamListener` turns them into `device.stale` and `station.stale` (ws-live-contract; the recovery now carries `lastSeenAt`). A device handed over while stale is reconsidered for the new holder; one checked in while stale recovers to `fleet` only. The snapshot read is unchanged. Tests: `jobs/stale-sweep.job.spec.ts` (AC-03, one recovery, no repeat, handover, rollback, cadence), `stream.listener.spec.ts`, `test/stale-sweep.db-spec.ts` (once across a restart, rollback, two concurrent sweeps). Checked 2026-11-01 on a fresh local Postgres 16: 28 of 28 db suites
  - _Requirements: REQ-EVT-03, AC-03, FR-MON-03, FR-INC-13, BR-21_
  - _Story: US-UC41_

## Phase 3: Read models

- [ ] 3.1 Map configuration and snapshot (owner LongNN)
  - **Files**: `live-map.service.ts`, `map.controller.ts`
  - **Do**: map provider, tile URL, attribution, viewport and the sovereignty overlay from configuration (api-design 01); snapshot from `visibleDevices`, `projections`, `openByDevices`, station health and the max `seq` (api-design 02)
  - **Test**: the overlay is present in the configuration response
  - **Status**: `GET /api/map/config` is built (api-design 01). 2026-10-30 (D-078 takeover, KhoaDD): `GET /api/map/snapshot` is built (api-design 02) behind `read LiveMap`, composed from `ContractsService.visibleDevices`, `DevicesService.projections`, `IncidentsQueryService.openByDevices`, `OrganizationsService.fieldStationHealth` and `StreamRepository.maxSeq`, read cursor first. `position.at` is the last-seen time until the projection keeps a fix time. `fieldStations` now lists each organization's stations not revoked with `lastSyncAt` and staleness against `monitoring.fieldStationStaleSeconds`. The box stays unticked: no db-spec was written, and the response was not walked against a running stack in this session.
  - **Partly done** (2026-11-01, KhoaDD under D-078, D-092 rule 2): the snapshot lists every unit of the scope's open contracts with `state` (`LIVE`, `OFFLINE`, `NOT_HEARD`), `handedOverAt` and `counterLocation` (REQ-UBI-04, design §4). `ContractsService.visibleDevices` now returns each unit's `handedOverAt`; the devices projection keeps `lastPositionAt`, the time of the reading that set the position (migration `20261101200100_devices_last_position_at`), so `position.at` is the fix time and an organization gets no position, last-seen time or battery from before the handover (D-040); TrekLink staff keep the stored values with the same states. The counter location is the new parameter `monitoring.counterLocation` (migration `20261101200000_monitoring_counter_location`), refused when malformed. The sweep sends the stale entry of a unit not heard since handover to `fleet` only (ws-live-contract). Tests: `live-map.snapshot.spec.ts`, `jobs/stale-sweep.job.spec.ts`, `devices.repository.projection.spec.ts`, and `test/live-map-units.db-spec.ts` (AC-08: 5 units, 2 live, 1 offline, 2 not heard, no pre-handover position) on a local Postgres 16. Open: the organization API (api-design 04) still answers the device's stored position whatever the custody interval; it was outside this task and is asked of the leader
  - _Requirements: REQ-UBI-02, REQ-UBI-04, AC-08, FR-MON-01, FR-CFG-03, BR-30, NFR-LEG-01_
  - _Story: US-UC38_
- [ ] 3.2 Organization API (owner LongNN)
  - **Files**: `org-api.controller.ts`
  - **Do**: api-design 04 and 05 behind `ApiKeyGuard`; `monitoring.apiRateLimitPerMinute` per key, 429 `RATE_LIMITED` beyond; only the key's organization
  - **Test**: organizations AC-05 end to end; the 61st request in a minute gets 429
  - **Status** (2026-10-30, KhoaDD, D-078 chain 2): `OrgApiController` serves api-design 04 and 05 with `@AuthOneOf('apiKey')`, the key's organization only, 410 `CURSOR_EXPIRED` through `ReplayService.isExpired`, and an in-process fixed one-minute window per key (`ApiRateLimiter`). Devices compose `rentals.visibleDevices`, `devices.projections` and `incidents.openByDevices`. The 61st-request test is a unit test with the parameter at 60; AC-05 end to end is open, so the box stays open
  - _Requirements: REQ-EVT-05, FR-MON-05, FR-MON-06, BR-20_
  - _Story: US-UC39_
- [ ] 3.3 Telemetry and device history (owner LongNN)
  - **Files**: `history.service.ts`
  - **Do**: api-design 03 serves events attributed to the caller's organization inside its rental periods; TrekLink staff get the whole history including `UNATTRIBUTED`; a range over 7 days or reversed is 400; api-design 07 composes `devices.trail`, `contractsOfDevice` and `incidentsOfDevice`
  - **Test**: a member asking for another organization's device gets 404 and nothing is sent
  - **Status** (2026-10-30): api-design 03 is built: `TelemetryHistoryController` and `HistoryService` (`GET /api/telemetry/devices/:id/history`, `read TelemetryHistory`, closed to API keys). An organization reads the `field_events` attributed to it, which ingestion already limits to its custody intervals; Staff and Admin read the whole history, `UNATTRIBUTED` included; a position marked not plotted is never returned. `clippedTo` lists the organization's whole rental periods that overlap the range (none for Staff and Admin), from the new `ContractsService.rentalPeriods`; the events come from the new `FieldEventQueryService.historyPoints`, which `GatewaySyncModule` now exports. The scope check (403) runs first, then the range (400, `to` after `from` and at most `monitoring.historyMaxRangeDays`), then the device (404, the same answer for another organization's device and an unknown one). `format=csv` returns the points as CSV text in `result`, like api-design 08. Unit-tested (service, controller query, both reads); the permissions are seeded, and the `(deviceId, occurredAt)` index came later with the cap (see the next line). Open: api-design 07 still lacks `incidents.incidentsOfDevice`. 2026-10-30, KhoaDD under D-078 (review of #159): the sequence of api-design 03 is redrawn from the code (`TelemetryHistoryController`, `HistoryService`, `ContractsService.rentalPeriods`, `FieldEventQueryService.historyPoints`, one `alt`) and renders with mermaid-cli; the handbook render check passed (KhoaDD's agent, 2026-10-30, scope note widened), and the hand-written class and sequence diagrams of `design.md` still name `TelemetryController` and `events`. The box stays open for those
  - **Partly done** (2026-10-30, KhoaDD under D-078, review of #159): the history answers at most `HISTORY_MAX_POINTS` (50,000) points, oldest first, with `truncated` (a truncated CSV ends with the comment row `# truncated`, review follow-up 2026-10-30); index `field_events("deviceId", "occurredAt")` in migration `20261030200000_field_event_device_occurred_at`; `test/telemetry-history.db-spec.ts` covers two organizations, a plotted and an unplotted position, the range bounds and the cap; design §9, below Figure 6, states that the history trusts the ingestion attribution
  - **Partly done** (2026-11-01, KhoaDD under D-078, seeded device history order): api-design 07 reads entries of one time in lifecycle order. `DevicesRepository.lifecycle` orders every list by time and id, `trail()` puts state rows of one time in the order of their moves (`inMoveOrder`), and `DeviceHistoryService` sorts oldest first with a tie rank (a reservation or a check-in before the unit's rows of that time, a handover, a release or a loss after them) and then reverses. The demo seed writes each device row at its lifecycle time (`seed-demo.ts`, block "Device lifecycle times"); `test/seed-demo-history.db-spec.ts` seeds and reads TL-0009, TL-0017 and TL-0019 in order. Open: `incidents.incidentsOfDevice`
  - _Requirements: REQ-EVT-06, REQ-ERR-01, REQ-ERR-02, FR-MON-07, FR-DEV-11_
  - _Story: US-UC40, US-UC53_
- [ ] 3.4 Reports and system health (owner LongNN)
  - **Files**: `reports.service.ts`, `system-health.service.ts`
  - **Do**: api-design 08: utilization, revenue per variant, overdue and lost units, time-to-acknowledge and time-to-resolve as medians and 95th percentiles over a date range, JSON or CSV in the envelope; api-design 06: `HealthService`, `gatewaySync.stats`, station health with `outdated`, buffering devices, `alertDeliveryStats`
  - **Test**: CSV header row and one row per variant; a station on an old version shows `outdated`
  - **Note** (2026-10-30, review of treklink-web#174): the revenue rows come from `BalanceService.revenue({from, to})` of `billing`, which answers `hardwareVariantId` and `variantCode`; the api-design 08 column `variant` is `variantCode`, and `variantCode` can be null (a contract the directory does not name, or a variant with no code), which the report has to render. The method reads every line due in the range and does not cap it, so this caller checks `monitoring.reportMaxRangeDays` first
  - _Requirements: FR-BILL-10, FR-MON-10, FR-EVT-13_
  - _Story: US-UC42, US-UC59_

## Phase 4: API Presentation Layer

- [ ] 4.1 Controllers (owner LongNN)
  - **Do**: api-design 01 to 08 with each file's permission and `@ResponseMessage`
- [ ] 4.2 E2E (owner LongNN)
  - **Files**: `backend/test/monitoring.e2e-spec.ts`, `backend/test/tenancy.e2e-spec.ts`
  - **Do**: every Validation row of api-design 01 to 08; the device moving from A's contract to B's (AC-01, AC-06); socket tests with two organizations
  - _Requirements: AC-01 to AC-07_

## Phase 5: Frontend Integration

- [ ] 5.1 Live map widget with the overlay, stale and incident markers, reconnect banner (MSG32) that keeps the last positions, map error state (MSG33) that keeps the panels live; system health and reports pages (owner LongNN, tracked in `specs/frontend/tasks.md` 9.1 to 9.4)
  - _Requirements: REQ-STA-01, REQ-STA-02, AC-07, FR-MON-09_

## Phase 6: Verification & DoD

- [ ] 6.1 Suite green; lint, boundary check, typecheck clean; `api-design/*.md` matching behaviour (owner LongNN)
