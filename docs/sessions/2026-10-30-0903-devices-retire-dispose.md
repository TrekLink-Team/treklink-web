# 2026-10-30 09:03 UTC: devices retire and dispose (PR #124)

KhoaDD under D-078, built by the leader's cloud agent. Branch `feat/devices-maintenance`.

## State

- Rebased onto `origin/dev` (#134, #136 merged), no conflicts. No already-applied migration is
  modified (`git diff origin/dev -- backend/prisma/migrations` shows two added folders only);
  `20261030130000_permission_device_dispose` sorts after every migration on dev.
- The rebase rewrote every branch commit. **Reseal needed**: the wip commit (now `4fad346`) and
  the new commits below carry no `Checksum` line, by rule.

## Commits on top of the wip commit

- `ae85349` test: unit tests for device retire and dispose (devices 2.4, 2.7)
- `9f052dd` fix: send the ticked wipe steps from the dispose dialog
- `66f2680` docs: record retire and dispose progress on devices 2.4, 2.7 and frontend 4.2
- `904962c` docs: this handoff
- the `MAINTENANCE_OPEN` retire guard and this update (see `git log`)

## What was built

- `devices.lifecycle.spec.ts`: retire only from `MAINTENANCE`, dispose only from `RETIRED`; every
  other state 409 `INVALID_STATE_TRANSITION`; stale `expectedVersion` and a lost conditional move
  409 `STALE_VERSION`; each false wipe step 400 `WIPE_INCOMPLETE` before any write; 404.
- `devices.controller.spec.ts`: both routes in a transaction, policies `retire` and `dispose` on
  `Device`, 200 and 201 with their messages, a CASL ability without `device.retire` or
  `device.dispose` refused, DTO validation.
- Frontend: `disposeDevice(id, steps, method, version)` sends the steps as ticked; dialog tests
  for the new call shape and the `STALE_VERSION` and `WIPE_INCOMPLETE` refusals.

## Checks (2026-10-30, this session)

- Backend: eslint 0 errors (1 warning in `test/incidents.e2e-spec.ts`, not touched), `tsc` clean,
  module-boundary check passed (360 files, 9 modules); devices 13 suites, 108 tests after the ruling; full suite
  153 suites, 1683 tests.
- Local Postgres 16: `prisma migrate deploy` applies all migrations, `device.dispose` granted to
  ADMIN; `test:db` 10 suites, 73 tests.
- Frontend: lint and typecheck clean; `DeviceDetailPage.test.tsx` 11 tests after the ruling; full suite 33 files,
  431 tests.
- HTTP smoke on a fresh demo seed: Staff retire 403, stale 409, retire 200 `RETIRED`, repeat 409,
  dispose with a false step 400 `WIPE_INCOMPLETE`, dispose 201 `DISPOSED` with a
  `device_disposals` row, retire of an `AVAILABLE` unit 409.

## Spec changes

- `specs/devices/tasks.md`: dated "Partly done" lines on 2.4 (retire) and 2.7 (disposal only).
- `specs/frontend/tasks.md` 4.2: the progress line no longer claims the routes are unserved.
- api-design 16 regenerated (devices only) for the `MAINTENANCE_OPEN` row; 23 unchanged.

## Shared files touched

None in the new commits. The wip commit touched `error-code.enum.ts`, `catalog.py`,
`permission-matrix.md` and added the forward migration.

## Decision: retire with an open maintenance record (ruled 2026-10-30)

Retire used to accept a `MAINTENANCE` device whose maintenance record was still `OPEN`, leaving the
record open on a `RETIRED` device; the spec was silent. Options put to the leader: (1) refuse with
409 `MAINTENANCE_OPEN`, (2) close the record `UNREPAIRABLE` automatically, (3) leave as is. The
leader chose option 1. `DevicesService.retire` now asks `MaintenanceService.hasOpenRecord` after the
state check (409 `MAINTENANCE_OPEN`, "Close the maintenance record first."); the retire dialog shows
MSG29. api-design 16 regenerated from `scripts/specs/endpoints/devices.py` with the new 409 row.
Verified over HTTP on TL-0018 (open `INSPECTION_FAILED` record): 409 `MAINTENANCE_OPEN`.

## Not done

- Loss cases half of devices 2.7 (`loss-cases.service.ts`, `devices.lossSearch` job).
- Inspection routing unit tests (devices 2.4).

## Demo steps (MF-05, contract RC-2026-0002, TL-0017 and TL-0018)

Verified over HTTP; the UI labels come from the code, not a click-through. Without a notice,
`demo:term-end` renews the term instead of moving it to `RETURN_DUE`, so the notice comes first.

1. `manager@treklink.local`: `/o/contracts`, RC-2026-0002, **Give notice**.
2. `npm --prefix backend run demo:term-end -- RC-2026-0002` (expect "1 to RETURN_DUE").
3. `staff@treklink.local`: `/t/contracts/<id>`, **Open the counter**, Check-in tab, add TL-0017
   and TL-0018, **Check in 2 devices**.
4. Reset and inspection tab: **Record reset** on each, then **Inspect**: TL-0017 PASSED to
   `AVAILABLE`; TL-0018 DAMAGED (CASING_CRACKED) to `MAINTENANCE`, which issues the 400,000 VND
   closing invoice.
5. Invoices and payments: open that invoice, **Record counter payment** (CASH, 400,000); back at
   the counter, **Close contract**.
6. `/t/maintenance`: TL-0018 shows its `INSPECTION_FAILED` record. On spare TL-0011,
   **Open maintenance**, then **Complete** as Unrepairable.
7. `admin@treklink.local`: `/t/devices/<TL-0011>`, **Retire** with a reason, then **Dispose**
   (tick the three wipe steps, enter a method).
