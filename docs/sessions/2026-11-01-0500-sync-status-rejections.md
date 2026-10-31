# 2026-11-01 05:00: rejection counts and the sync audit on the Field data sync page (gateway-sync 4.1, frontend 9.5)

KhoaDD under D-078, run by the leader's cloud agent (task W11). Branch `feat/sync-status-rejections`
from `origin/dev` at `7145a84`. Scope: gateway-sync reads, `SyncStatusPage`, their specs and the demo
script citations. No ingestion path, schema, migration, permission or seed changed.

## Done

| Item | Commit | Where |
|---|---|---|
| `normalizationFailed` in `syncStatus`; `listAudit` with `SyncAuditService` | `0b18b67` | `backend/src/modules/gateway-sync/`, `test/sync-audit.db-spec.ts`, api-design 04 and 07 regenerated, design §5 |
| Three cards and the Sync audit section | `7c879f5` | `SyncStatusPage.tsx`, `entities/gateway-sync/api.ts`, screen 9.5, frontend task 9.5 and route row, demo script steps 4 and 5 |
| Task lines | this commit | gateway-sync tasks 4.1, this file |

## Facts confirmed

- **Before this task** `syncStatus` already answered `malformed`, `acceptedUnattributed` and
  `unknownDevice` (`sync-status.service.ts`, api-design 07); the page showed only Accepted, Duplicates
  rejected and Unknown device. `NORMALIZATION_FAILED` was audited (`ingestion.service.ts:86`) but not
  counted.
- **`listAudit` already existed in the spec** (api-design 04, Admin only) and was not built; the task
  asked for Staff and Admin through `read FieldEvent`, so api-design 04 now says so.
  `syncAudit.read` (Admin only) remains in `catalog.py` with no route.
- **Raw payload of a malformed message**: the node adapter stores the text when it is not JSON and
  the parsed object otherwise (`adapters/node-json.adapter.ts:38-60`); `listAudit` answers either as
  text, cut at 500 characters.
- **Postgres 16 run**: `sync-audit.db-spec.ts` and `telemetry-history.db-spec.ts`, 7 of 7 tests, on a
  local cluster migrated with `prisma migrate deploy`.

## Not done

- `replayAudit` and `listQueueReports` (task 4.1); the replay button on the page.
- Screen 9.5's wireframe image; the README assignment table was not regenerated.
- `check_mermaid.py` and `check_tasks.py` need the capstone sibling folders, absent here.
- A browser walk of the page against a running backend.
