# 2026-10-30 23:40, KhoaDD under D-078, undo a provisioning at the counter

## Goal

Dry run of 2026-10-30, MF-01 step 8, defect 5 on screen 5.4 (`CounterPage`, Devices step): Record
provisioning on the wrong unit could not be undone; the row stayed "Provisioned v1" until handover.

Branch `fix/counter-undo-provisioning` from `origin/dev` `4fafb53`. Lands after the 2026-11-01 demo
(`dev` frozen from 2026-10-31 22:00); branch pushed only.

## Found

- Provisioning (rentals api-design 09) writes an append-only `DeviceProvisioning` row and sets
  `keyVersion`, `keyOrganizationId` and `provisionedAt` on the device
  (`DevicesRepository.recordProvisioning`). It writes no audit entry, emits no event, takes no version
  and bumps neither the contract nor the device `version`.
- Swap (07) does not bump the contract version either; in `APPROVED` only the handover (10) checks it.
- No column holds a counter reading; the readings live on the page (see
  `2026-10-30-2330-counter-bulk-provisioning.md`).

## Decisions taken in this session (listed for the leader)

- Route `POST /api/contracts/:id/devices/:deviceId/provisioning/undo`, appended as api-design 19 so
  10 to 18 keep their numbers. POST, not DELETE, to carry the version in a body like the other actions.
- The version is the contract's (`expectedVersion`), which the page already holds; the undo increases it
  (compare and set, no transition row), so a signing screen opened before the undo reloads.
- Reused error codes `STALE_VERSION`, `INVALID_STATE_TRANSITION`, `DEVICE_NOT_ON_CONTRACT`,
  `DEVICE_NOT_PROVISIONED`; no new code, no new permission, no migration.
- The `DeviceProvisioning` row stays (append-only); the undo is the audit entry
  `contract.provisioningUndone`. The device trail therefore still lists the provisioning.

## Done

1. Specs: rentals REQ-EVT-16, REQ-ERR-10, design §4 paragraph, api-design 19 (catalog plus generator),
   task 2.6; devices REQ-EVT-04 sentence, design §3 row and class diagram, task 2.3 note; ui-design 5.4
   rows; frontend task 5.4 dated line.
2. Backend: `HandoverService.undoProvisioning`, `HandoverController.undoProvisioning`,
   `UndoProvisioningDto`, `ContractsRepository.bumpVersion`, `DevicesService.clearProvisioning` and
   its repository method. Unit, e2e and db-spec rows.
3. Frontend: `undoProvisioning` request, Undo on a provisioned row, `ConfirmDialog`, local override so
   the row shows "Not provisioned yet" before the contract read catches up, readings cleared, handover
   sends the version the undo answered.

## Checks

Backend unit 200 suites, 2186 tests; e2e 18 suites, 407 tests; `contracts-http.db-spec.ts` 24 tests on a
local Postgres 16 (fresh `initdb`, `prisma migrate deploy`); lint and boundary check clean; `tsc` clean.
Frontend 55 files, 646 tests; lint clean (one existing warning in `CounterPaymentDialog.tsx`); typecheck
clean.

## Not done

- `check_mermaid.py` and `check_tasks.py`: they need the sibling `scripts/srs` tooling, absent here.
- The 5.4 wireframe SVG is not redrawn.
- The other db-spec suites were not run; only the contracts HTTP suite this change touches.
- A browser walk of the Undo action.
