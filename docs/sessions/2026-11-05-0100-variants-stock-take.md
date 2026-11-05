# 2026-11-05 01:00 (UTC+7): W20A, hardware variants admin (4.1) and stock-take (4.5)

KhoaDD under D-078, branch `feat/devices-variants-stocktake` from `dev` at `35ca5cd`.

## Spec changes

- `specs/devices/requirements.md`: REQ-EVT-29 (variant writes audited, edits compare-and-set), REQ-EVT-30
  (stock-take classification), REQ-ERR-19 (`STALE_VERSION`, `SCHEDULE_INVALID` rules), AC-22, AC-23.
- `specs/devices/design.md` section 11: the variant rules table, the delete refusal through the foreign key,
  the stock-take groups, the taker names through `ACCOUNT_DIRECTORY`.
- `scripts/specs/endpoints/devices.py`, regenerated api-design 01 to 04, 25 and 26: `version` on every
  variant answer, `expectedVersion` on the PATCH (with the sensor flags and the two 400 codes), device ids
  and `scannedCount` on the stock-take answer, the three counts on the list.
- Screen 4.5: an unknown tag links to screen 4.2 without the tag prefilled (FleetPage reads no prefill
  parameter and was held by another session).
- Kept from the approved screen spec, not the W20A prompt: a stock-take is one request with the scan list in
  session storage, not a server-side session per location. No location concept exists in the schema.

## Environment

- Postgres 16 from apt (`pg_ctlcluster 16 main start`), databases `treklink_test`, `treklink_demo`,
  `treklink_ci`; never a Neon host. Seed passwords must be 8 characters or more
  (`auth.passwordMinLength`), or the seed exits before writing anything.
- Chromium from `/opt/pw-browsers/chromium-1243`; the repository's Playwright looks for another build.

## Walk

- `/t/admin/variants` as the Admin (list, form dialog, details pane) and `/t/stock-take` as Staff (empty,
  four scans, a submit and its result) at 1280, 900 and 360 px wide, light and dark: 26 checks, no
  horizontal overflow, no serious or critical axe violation (WCAG 2.0 and 2.1 A and AA). Screenshots looked
  at; two fixes from the walk (a bare count on the 360 px card, a repeated baseline in the pane).
