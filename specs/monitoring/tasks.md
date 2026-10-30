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
- [ ] 2.2 Replay and key revocation (owner LongNN)
  - **Do**: on connect or reconnect with a cursor, replay every entry after it for the client's rooms, then `replay.done`, then live; a cursor older than `monitoring.streamRetentionHours` gets `replay.expired` (REST 410); on `apiKey.revoked` close that key's sockets
  - **Test**: AC-02 (two minutes disconnected, every entry once and in order)
  - **Status**: the socket side is built: replay in batches for the client's scope, `replay.done` with its cursor, `replay.expired` for a cursor outside the retention window, live entries held back during a replay, and key revocation by `apiKey.revoked`. The REST 410 belongs to `GET /api/telemetry/stream` (task 3.2). `organizations` emits `apiKey.revoked` since 2026-10-30 (chain 2) and the REST 410 is in task 3.2; the box stays unticked until a socket test closes a real revoked key.
  - _Requirements: REQ-EVT-02, REQ-EVT-08, AC-02, FR-MON-05, FR-ORG-06_
- [ ] 2.3 `incident.alert` publishing (owner HoangTK)
  - **Do**: a synchronous listener publishes the alert to `user:<recipientId>`; returning means sent (incidents design §3)
  - **Test**: an alert reaches the recipient's socket within 2 s of the transition commit
  - **Note**: `LiveGateway.onIncidentAlert` is built in the MF-03 PR (2026-10-29), sending a `stream` event with `seq: 0` to `user:<id>` (incidents design §3). The 2 s socket timing test is open, so the box stays open
  - _Requirements: REQ-EVT-07, FR-INC-12, NFR-PERF-04_
- [ ] 2.4 Staleness sweep and pruning (owner LongNN)
  - **Files**: `jobs/stale-sweep.job.ts`, `jobs/prune-stream.job.ts`
  - **Do**: `monitoring.staleSweep` every `monitoring.staleSweepSeconds`: devices past `monitoring.deviceStaleSeconds` and stations past `monitoring.fieldStationStaleSeconds` emit stale and recovered transitions only and call `IncidentsService.markDeviceStale`; `monitoring.pruneStream` hourly deletes entries past retention
  - **Test**: AC-03; a device heard again emits one recovery
  - **Status**: `monitoring.pruneStream` is built (`jobs/prune-stream.job.ts`): hourly at minute 10, it deletes `stream_events` older than `monitoring.streamRetentionHours` in batches of 5000 and never touches `device_releases`. `monitoring.staleSweep` is not: it needs a read of devices silent past `monitoring.deviceStaleSeconds` from `devices`, the Field Station `lastSyncAt` from `organizations`, and `IncidentsService.markDeviceStale`, and none of the three exists on `dev`. The box stays unticked until the sweep lands.
  - _Requirements: REQ-EVT-03, AC-03, FR-MON-03, FR-INC-13, BR-21_
  - _Story: US-UC41_

## Phase 3: Read models

- [ ] 3.1 Map configuration and snapshot (owner LongNN)
  - **Files**: `live-map.service.ts`, `map.controller.ts`
  - **Do**: map provider, tile URL, attribution, viewport and the sovereignty overlay from configuration (api-design 01); snapshot from `visibleDevices`, `projections`, `openByDevices`, station health and the max `seq` (api-design 02)
  - **Test**: the overlay is present in the configuration response
  - **Status**: `GET /api/map/config` is built (api-design 01). 2026-10-30 (D-078 takeover, KhoaDD): `GET /api/map/snapshot` is built (api-design 02) behind `read LiveMap`, composed from `ContractsService.visibleDevices`, `DevicesService.projections`, `IncidentsQueryService.openByDevices`, `OrganizationsService.fieldStationHealth` and `StreamRepository.maxSeq`, read cursor first. `position.at` is the last-seen time until the projection keeps a fix time. `fieldStations` now lists each organization's stations not revoked with `lastSyncAt` and staleness against `monitoring.fieldStationStaleSeconds`. The box stays unticked: no db-spec was written, and the response was not walked against a running stack in this session.
  - _Requirements: REQ-UBI-02, FR-MON-01, FR-CFG-03, BR-30, NFR-LEG-01_
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
  - **Status** (2026-10-30): api-design 03 is built: `TelemetryHistoryController` and `HistoryService` (`GET /api/telemetry/devices/:id/history`, `read TelemetryHistory`, closed to API keys). An organization reads the `field_events` attributed to it, which ingestion already limits to its custody intervals; Staff and Admin read the whole history, `UNATTRIBUTED` included; a position marked not plotted is never returned. `clippedTo` lists the organization's whole rental periods that overlap the range (none for Staff and Admin), from the new `ContractsService.rentalPeriods`; the events come from the new `FieldEventQueryService.historyPoints`, which `GatewaySyncModule` now exports. The scope check (403) runs first, then the range (400, `to` after `from` and at most `monitoring.historyMaxRangeDays`), then the device (404, the same answer for another organization's device and an unknown one). `format=csv` returns the points as CSV text in `result`, like api-design 08. Unit-tested (service, controller query, both reads); no migration, because the permissions are seeded. Open: api-design 07 still lacks `incidents.incidentsOfDevice`; the `field_events` query was not run against Postgres (`test:db` could not connect on this machine); the response is not capped, and a 7-day range at a 5-second cadence is over 100,000 points per kind (unverified, record a cap in the spec if it hurts); the sequence diagram of api-design 03 still names `GatewaySyncService.events`, to be redrawn under the handbook gate of AGENTS.md §2.8. The box stays open for those
  - **Partly done** (2026-10-30, KhoaDD under D-078, review of #159): the history answers at most `HISTORY_MAX_POINTS` (50,000) points, oldest first, with `truncated`; index `field_events("deviceId", "occurredAt")` in migration `20261030200000_field_event_device_occurred_at`; `test/telemetry-history.db-spec.ts` covers two organizations, a plotted and an unplotted position, the range bounds and the cap; design §9, below Figure 6, states that the history trusts the ingestion attribution
  - _Requirements: REQ-EVT-06, REQ-ERR-01, REQ-ERR-02, FR-MON-07, FR-DEV-11_
  - _Story: US-UC40, US-UC53_
- [ ] 3.4 Reports and system health (owner LongNN)
  - **Files**: `reports.service.ts`, `system-health.service.ts`
  - **Do**: api-design 08: utilization, revenue per variant, overdue and lost units, time-to-acknowledge and time-to-resolve as medians and 95th percentiles over a date range, JSON or CSV in the envelope; api-design 06: `HealthService`, `gatewaySync.stats`, station health with `outdated`, buffering devices, `alertDeliveryStats`
  - **Test**: CSV header row and one row per variant; a station on an old version shows `outdated`
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
