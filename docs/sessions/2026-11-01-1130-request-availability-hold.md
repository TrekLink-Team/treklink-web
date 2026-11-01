# Session 2026-11-01 11:30, W25: MF-01 availability and a hold at request (D-092 rule 1)

KhoaDD under D-078, branch `feat/request-availability-hold` from `origin/dev` at `bd43c4f`.

## Leader rulings of 2026-11-01 (asked in the session chat)

1. The request form reuses devices api-design 24 (`device.availability.org`, counts only); no new
   endpoint, permission or migration row.
2. An unpaid hold past `holdExpiresAt` cancels the request (`SYSTEM`, reason `HOLD_EXPIRED`).
3. A rejection releases the held units and voids the unpaid lines; a paid deposit is answered as
   `paidVnd` and refunded outside TrekLink.

These three belong in the treklink-docs decision register under D-092; this repository cannot write
there (not done in this session).

## What changed

- Spec: rentals REQ-EVT-01, 02, 03, 17, REQ-ERR-01, 11, AC-08, AC-09, design §2.1, task 2.7; billing
  REQ-EVT-02, 03, 11; api-design rentals 01, 03, 04, 05 and devices 24 regenerated; screen 5.1.
- Backend: the request holds its units, opens term 1 and issues the first invoice in one transaction;
  approval keeps held units; `rentals.requestHoldExpiry` every 10 minutes; migration
  `20261101200000_rentals_request_hold` (`holdExpiresAt`, `rentals.requestHoldHours` 24).
- Frontend: availability per variant and under Quantity, MSG11, the confirmation panel with the hold
  expiry and the deposit; detail and approval page lines.
- Demo script MF-01 steps 2, 2a, 4, 5, 6 (not clicked in a browser).

## Checks

Backend unit 2522/2522, e2e 427/427, db-specs 203/203 on a local Postgres 16 (new
`rentals-request-hold.db-spec.ts` 6/6, three runs), lint and boundary check clean, no schema drift.
Frontend 888/888, lint and typecheck clean. `check_mermaid.py` could not run: no `mmdc` here.
