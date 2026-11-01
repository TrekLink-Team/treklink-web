# 2026-11-01 19:00 (UTC+7): MF-05 return with a damaged and a missing unit, the close, the path back to AVAILABLE

KhoaDD under D-078 (task W27). Branch `feat/return-close-available`, cut from
`origin/dev` at `c5d9917` (contains the loss cases of treklink-web#228). Answers the supervisor demo of
2026-11-01 under the leader's rulings D-092 rules 3 and 4.

## Reproduction (before the change)

Local stack (Postgres 16, demo seed, backend and Vite dev server). The MF-01 Playwright journey made
RC-2026-0004 with five v3 units (TL-0003 to TL-0006, TL-0011); notice and `demo:term-end` took it to Return
due. As Staff at `/t/counter/:id`: TL-0003 to TL-0006 checked in ("Check-in complete. 4 of 5 devices
returned."), all four reset, three inspected Passed, TL-0006 Damaged (CASING_CRACKED, 400,000 VND). Where it
stopped:

- Close tab: only "A contract closes once every device is back or lost and it is RETURNED.", no Close
  action and no list of what blocks it (`ReturnCounter.tsx` before `5629fa4`). Screenshot
  `before-3-close-tab.png`.
- No Report lost on the counter, nor for Staff on `/t/contracts/:id` (Org Manager only), so TL-0011 could
  not be settled from the return; the only screen naming a missing unit was the Replace tab of a running
  contract, which needs an available replacement unit (`ReplacementPanel.tsx`). Screenshot
  `before-4-contract.png`.
- The Close action keyed off the cached `contract.status === 'RETURNED'`, and `refetchOnWindowFocus` is off
  app-wide, so a loss settled or an invoice paid in another window left the counter without the button
  until a reload (the missing close button).
- Returned units showed no next step. On the seed a Passed unit does go straight to AVAILABLE; TL-0006 sat
  in MAINTENANCE with nothing pointing at maintenance and the intake check.
- Backend: nothing blocked the path. `ReturnService.close` refused with 409 `INVALID_STATE_TRANSITION`
  while Return due, and the loss case of #228 moves the contract to RETURNED on settlement.

## Leader ruling (2026-11-01, this session)

D-092 rule 4 "inspection, then intake": keep `PASSED` to `AVAILABLE`. The intake check follows only a
maintenance record. Recorded in devices REQ-EVT-23 and design §2.

## What was built

- **rentals** api-design 20 `GET /api/contracts/:id/close-check` (`contract.operate`): `canClose` and each
  blocker (`NOT_RETURNED`, `DEVICE_OUT` with its open loss case, `BALANCE_OUTSTANDING`, `DAMAGE_PENDING`,
  `OPEN_INCIDENTS` with each incident). The close is unchanged. Contract detail `devices[].afterReturn`
  for TrekLink callers.
- **devices** `nextStepOf` (`next-step.ts`), `nextSteps`, `openLossCases`; api-design 07 `nextStep`.
- **billing** `pendingDamageOf`; **incidents** `openFor` and `CloseBlockingReason.refs`.
- **frontend** `features/close-contract` (blocker list, close dialog); the counter's Still out list with
  Report lost, the State now column and the Close tab and action bar driven by `useCloseCheck` (refetched on
  focus); the contract page Close panel and State now column; the device page Next step panel.

## Checks

Backend: lint 0 errors (1 warning in `incidents.e2e-spec.ts`, on `dev` before), boundary check passed, `tsc`
clean, unit 230 suites and 2592 tests, stubbed e2e 20 suites and 427 tests. `test:db` on Postgres 16: 34
suites and 208 tests, new `test/return-close.db-spec.ts` (2) included; run without `backend/.env`, whose
SePay key otherwise fails billing AC-03 locally. Frontend: lint 0 errors (1 warning in
`CounterPaymentDialog.tsx`, on `dev` before), typecheck and `typecheck:e2e` clean, vitest 83 files and 909
tests. Playwright `mf-01` (4) and `mf-05` (5, the old path with both units back) passed on the new code.

## Browser walk (after the change)

RC-2026-0004 and then RC-2026-0002 on the new MF-05 path (TL-0017 back damaged, TL-0018 missing), as
`staff@treklink.local` and `admin@treklink.local`:

- `mf05-4-checkin.png`: "1 of 2 devices returned."; Still out with TL-0018 and Report lost.
- `mf05-7-blockers.png`: Close tab blockers: not Returned (waits for the return due), TL-0018 with "Open
  loss case LOSS-0002", 400,000 VND unpaid; no Close action.
- `mf05-10-unpaid.png`: after the Admin settled LOSS-0002 in another window, the counter reads Returned and
  lists only "2,900,000 VND is unpaid on the contract's invoices."
- `mf05-12-closed.png`: after the counter payment, Close in the action bar; badge Closed.
- `after-8-can-close.png`: the contract page of RC-2026-0004, Returned, "Nothing blocks the close." with
  Close contract.
- `mf05-13-intake-next.png`: TL-0017 after its maintenance record: "Next step: Intake check"; the intake
  check made it Available. TL-0018 Retired.

## Spec changes

rentals REQ-EVT-18, REQ-EVT-19, REQ-ERR-05 (state answer and order), design note under Figure 22, api-design
03 and new 20; devices REQ-EVT-23, design §2 note, api-design 07; ui-design 5.5, 5.2, 4.2; tasks lines in
rentals 4.4, devices 3.1, frontend 4.2, 5.2, 5.5. Generated api-design 20 carries new Mermaid diagrams; the
D-067 handbook gate was not run, because the course PDF is not in this container. No hand-drawn diagram
changed.

## Not done

- The Playwright `mf-05` journey still drives the earlier path (both units back); it was not rewritten to
  the damaged-and-missing path.
- A unit recovered outside a contract still has no inspection endpoint (from #228); its Next step panel
  says so.
