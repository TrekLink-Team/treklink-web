# 2026-11-06 17:36 (UTC+7): HTTPS ingest fallback, gateway-sync spec draft (D-098 amended)

KhoaDD under D-078, docs only, branch `docs/https-ingest-fallback-spec` from `dev`. For the supervisor review of
2026-11-07 or 2026-11-08. Every file added or changed carries "Draft, pending supervisor acceptance (D-098 amended)".

## Written

- `specs/gateway-sync/requirements.md`: REQ-UBI-07, REQ-UBI-08, REQ-EVT-16 to REQ-EVT-19, REQ-STA-05, REQ-ERR-09 to
  REQ-ERR-12, AC-10 to AC-16, draft rows in §4.
- `specs/gateway-sync/design.md` §10 (Figures 9 and 10) and a note under §6.
- `specs/gateway-sync/api-design/08-post-gateway-sync-ingest.md`, generated from `scripts/specs/endpoints/gateway_sync.py`;
  the builder gained an optional `banner` per endpoint and `BANNER` per module so a generated file can carry the marker.
- `specs/gateway-sync/tasks.md` Phase 7, tasks 7.1 to 7.7, unticked.

## Facts read in the code (2026-11-06)

- Station credential: bcrypt hash per station, `FieldStationsService.byUsername` (`backend/src/modules/organizations/field-stations.service.ts:228`),
  checked by `BrokerAuthService.checkUser` (`backend/src/modules/gateway-sync/broker-hooks.service.ts:143-158`). Reused, no new credential.
- Shared ingest: `IngestionService.ingest` (`ingestion.service.ts:73`) and `rejectMalformed` (`:57`), after
  `FieldStationJsonAdapter.adapt` (`adapters/field-station-json.adapter.ts:28`).
- `MqttSubscriber` does not subscribe the Stage C topic yet (`mqtt/mqtt-subscriber.ts:25-28`), and the gateway adds no
  `fs_captured_at` or `fs_sent_at` yet (no match in `gateway/src`). The HTTPS transport depends on task 5.1's Stage C queue.
- No `trust proxy` in `backend/src`; hence `HTTPS_INGEST_TRUST_PROXY`.
- Ingestible fixture messages are 167 to 288 bytes of compact JSON (`backend/test/fixtures/mqtt/*.json`).

## Checks

- `python3 scripts/specs/build_api_design.py` (all modules): only gateway-sync changed.
- Mermaid: 12 blocks in `design.md` and api-design 08 rendered, 0 failed, with mermaid-cli 11.4.2 (not the pinned 12.0.0 of
  D-017, which is not in this container).
- `scripts/specs/check_tasks.py` needs the capstone SRS data, absent here; its checks 1 to 3 were run by hand on
  gateway-sync: every REQ and AC named, api-design 08 named, every task owned.

## Open for the leader

- Automatic fallback from MQTT to HTTPS while running (draft: no, the uplink is chosen once at start).
- `sync_audit_log.transport` column (draft: yes, design §10.7).
- Where the credential dialog shows the ingest URL (organizations api-design 24).
- The D-098 amendment itself is recorded in `treklink-docs`, which this session cannot read or edit.
