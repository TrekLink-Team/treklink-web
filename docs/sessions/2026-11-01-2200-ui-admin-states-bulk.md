# 2026-11-01 22:00 (UTC+7): UI standard on the admin pages, bulk selection, missing admin pages (task W29)

KhoaDD under D-078. Branch `feat/ui-admin-states-bulk`, cut from `origin/dev` at `34c4a2e` (W28 merged:
the standard, `Menu`, `StateChangeMenu` and DataTable selection were on dev). No new npm dependency.

## Built

- Backend: `PATCH /api/devices/:id` (devices api-design 08, already specified): firmware only,
  `device.operate`, compare-and-set on `expectedVersion` (409 `STALE_VERSION`), `audit.record
  device.update` after commit. No new permission, migration or error code; api-design regenerates
  with no diff.
- `shared/ui/BulkAction.tsx` and `bulkSequence.ts`: confirm with the count, one reason or required
  steps, the single-row endpoint in sequence, then a toast or a per-row summary.
- Row actions with only the allowed transitions per state and role: Fleet (intake, reset, retire,
  dispose), Accounts (menu), Damage charges, Maintenance, Organizations (`StateChangeMenu`), the Staff
  contract queue (review, reject, cancel, open counter), the org contract list (cancel), Staff
  incidents (report, false alarm on `UNROUTED`), contract devices, authority reports.
- Bulk: Fleet (reset, retire), Accounts (reset code, reactivate, deactivate), Damage charges (approve,
  waive), Maintenance approvals (approve, reject).
- Onto `DataTable`: all twelve listed tables. Only gateway-sync events sort (api-design 03 `order`).
- `/t/field-stations` for Staff and Admin with an organization filter and Revoke (reason required).
- Verify form: it already rendered for Staff; a test now holds it.

## Checks

- Frontend: lint 0 errors, 1 warning that predates the branch (`CounterPaymentDialog.tsx:14`);
  typecheck and `typecheck:e2e` clean; Vitest 93 files, 1027 tests (base 89, 995).
- Backend: lint and boundary check pass (532 files, 10 modules); `tsc` clean; unit 238 suites, 2690
  tests; stubbed e2e 20 suites, 429 tests. The db-specs did not run (CI runs them).
- `a11y.spec.ts`, local Postgres 16, demo seed, `E2E_STUB_TILES=true`, Chromium 1243: 48 passed.
- `scripts/specs/check_tasks.py` cannot run here: it needs the SRS data of another repository.

## Spec changes

ui-design 0, 3-2, 3-5, 4-2, 4-3, 5-2, 5-3, 6-1, 6-4, 7-1, 8-1, 8-2, 8-3, 9-5; `specs/frontend/tasks.md`
1.7; `specs/devices/tasks.md` 4.1.

## Shared files touched

Router (`/t/field-stations`), navigation (one entry), `shared/ui/index.ts`. No module file, error
code, catalog, migration or seed.

## Not done

Device page retire dialog still hand-built; `window.confirm` on four discard prompts; no pagination
on API Keys, Members, Field Stations, Parameters (those APIs return whole lists); dashboard tables;
error summary; `AccountMenu` onto `Menu`.

## Demo steps

1. `staff@treklink.local`: Devices, TL-0001, Edit firmware, Save. Maintenance, Open maintenance on
   TL-0007 and TL-0008.
2. `admin@treklink.local`: Devices, tick TL-0007 and TL-0008, Retire 2 devices, reason: both refused
   with MSG29 in the summary. Organizations, Change status of ORG-0001 (Suspend, Close only).
3. `staff@treklink.local`: Field stations, Revoke fs-org-0001-1 with a reason.
4. `admin@treklink.local`: Accounts, tick Demo Staff, Send reset code to 1 account.
5. `manager@treklink.local`: Contracts, Request a contract, then its row's Cancel contract.
6. `operator@treklink.local`: Contracts shows no row action.
