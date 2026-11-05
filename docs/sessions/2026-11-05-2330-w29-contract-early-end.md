# W29: End now with the current term billed pro rata (D-097)

KhoaDD under D-078, 2026-11-05, branch `feat/contract-early-end`.

## What was built

- Spec: rentals REQ-EVT-27, REQ-EVT-28, REQ-ERR-17, AC-15, AC-16, amended REQ-STA-01 and REQ-EVT-10, design §2
  and §12, api-design 30 and 31; billing REQ-EVT-16, REQ-STA-03, AC-09, AC-10, design §10, api-design 10
  `owedToOrganizationVnd`; screens 5.2 and 6.1; the WF-05 line of the demo script §7.
- Backend: `ContractDecisionsService.endNow` and `endPreview`, `ChargesService.earlyEndCredit` and
  `creditEarlyEnd`, `BalanceService.afterCredit` and `owedToOrganizationVnd`, migration
  `20261105230000_contract_early_end` (the `EARLY_END_CREDIT` line type, its sign CHECKs, `contract.end` and
  `contract.end.own`).
- Frontend: `EndNowDialog` in More actions for Staff and the Org Manager on `ACTIVE` and `ENDING`, the owed
  note on the Money tab, the Early end credit label, Ending "not reached" on the lifecycle card.

## Decisions taken here, for review

| Decision | Why |
|---|---|
| The Manager's End now ends the contract at once, no Staff approval | asked of the leader with this as the recommendation; D-035 has no pending state for it |
| `EARLY_END_CREDIT` line type, not an `ADJUSTMENT` | reports read lines by type; an adjustment is a correction (billing design §10.2) |
| Used days counted in 24-hour periods from the term start, the end day counted, credit rounded up | "billed pro rata to the end day" (D-097 rule 2); rounding as the service credit |
| A preview endpoint (api-design 31) | the dialog names the credit and nothing is computed in the browser (screen 5.2) |

## Visual check (local demo seed, Postgres 16, Chromium)

| Screen | Widths | Themes | axe |
|---|---|---|---|
| Contract home, Manager and Staff, `ACTIVE` | 1440, 1280, 900, 360, 320, 320 by 240 | Canopy, Volt | 0 violations |
| End now dialog, Manager and Staff | 1440, 360, 320 | Canopy, Volt | 0 violations |
| Contract home, Staff, `RETURN_DUE` after End now | as above | both | 0 violations |
| Counter, Check-in of RC-2026-0002 | as above | both | 0 violations |
| Money tab, Manager, owed note | as above | both | 0 violations |
| Closing invoice with the credit line | 1440, 360, 320 | both | 0 violations |

The document did not scroll at any width except 320 by 240 (the 400 % zoom case the rule allows). Focus
opens on Keep the contract running in every dialog run.

## Found, not fixed (outside this task)

- The History tab of the contract home shows a gap above its command bar and the newest rows under it, on
  RC-2026-0001 as well, so it predates this branch.
- A closing invoice whose only line is the credit reads Paid with a negative total; the invoice status rule
  is billing's existing one.
- `test/variant-media.db-spec.ts` fails on a migrated database without the demo seed; its header says it
  needs the seed.
