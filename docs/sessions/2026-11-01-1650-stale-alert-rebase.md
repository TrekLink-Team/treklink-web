# 2026-11-01 16:50: rebase of the device-silent alert onto dev (task W24)

KhoaDD under D-078, run by the leader's cloud agent. Branch `fix/stale-flag-alert` (treklink-web #237),
8 commits rebased onto `origin/dev` at `89c7a47`, then pushed with `--force-with-lease`.

## Done

| Item | Where |
|---|---|
| Conflict in `AlertBanner.tsx` resolved: dev's poll mode (#271) and the `STALE` kind both hold. A polled alert is `kind: 'TRANSITION'`; `done` removes only the SOS of the acknowledged incident, so a device-silent alert of the same incident stays until dismissed | `frontend/src/app/AlertBanner.tsx` |
| Poll mode shows no device-silent banner: the incident read carries `stale` but neither the device's last reading MSG40 names nor the alert's recipients, so no trivial poll source exists | frontend REQ-EVT-05, frontend design §3 poll mode |
| Migration renamed `20261101120000_incidents_stale_alert` to `20261101190000_incidents_stale_alert`, SQL unchanged; it shared a timestamp with `20261101120000_demo_controls` (#245) and sorted before migrations applied on dev | `backend/prisma/migrations/`, `alert-deliveries.repository.ts`, incidents design and tasks, `2026-11-01-0700-stale-flag-follow-up.md` |
| Tests: SOS acknowledged keeps the device-silent alert; poll mode shows no device-silent banner | `frontend/src/app/AlertBanner.test.tsx` |

## Facts confirmed

- On `origin/dev` at `89c7a47` the newest migration is `20261101170000_rentals_handover_notes`.
  `20261101160000`, `20261101180000` and `20261101180100` are not on dev yet; `20261101190000` sorts after
  them when they land.
- The rebased commits keep their original `Checksum` trailers, which no longer match the rebased trees;
  the leader reseals locally.
