# WF-05 staging, 2026-11-06

DS-05b completed the return, separate Admin approval, invoice and close workflow. Its business
states and invoice arithmetic passed. Two findings remain for KhoaDD review: the counter loses
its damage amount/status hint on reload (#406), and the demo counter payment lacks a sandbox
label (#407). WF-05 as a whole remains incomplete because DS-05a needs a separate confirmed fixture.

## Environment and method

- Site: https://treklink-web.vercel.app, 07:46 to 07:58 ICT, automated headless Chrome at 1440 by 1000.
- Used the published demo Staff and a separate demo Admin through the actual UI and live API.
- D-097's End contract now from merged #401 replaced the earlier time-shift proposal. The live
  action and preview returned 200. The deployment SHA was not exposed or verified. The staging Git
  branch contained #401, but that alone is not evidence of the deployed SHA.
- No database script, reset/seed, scenario switch, deployment or guard workaround was run.
- Reset, damage and loss entries are sandbox rehearsal records. No physical hardware operation,
  actual damage, actual loss, cash exchange or bank transfer is asserted.
- The fixture is consumed. RC-2026-0002 is CLOSED, TL-0017 remains MAINTENANCE, TL-0018 is RETIRED.
  Do not reset or reuse it without an approved preparation. The loss screen advises channel-key
  rotation for ORG-0001. No key rotation or unrelated compliance action was performed.

## DS-05b results

Contract RC-2026-0002, organization ORG-0001, devices TL-0017 and TL-0018.

| Step | ICT | Result | Evidence |
|---|---|---|---|
| Staff ends the ENDING contract now, with a disclosed rehearsal reason | 07:47 | PASS, RETURN_DUE, credit 750,000 VND for 25 unused days of 30 | [Confirmation](01-end-confirmation.png) |
| Staff checks in only TL-0017 | 07:47 | PASS, 1 of 2 returned, TL-0018 stays out | Execution record |
| Staff records the simulated reset | 07:49 | PASS, reset accepted before inspection | Execution record |
| Read threshold, then record damaged inspection with two active catalog codes | 07:50 to 07:51 | PASS, threshold 500,000 VND, total 700,000 VND, PENDING_APPROVAL, MAINTENANCE | [Codes](07-damage-before-submit.png), [queue](14-damage-approval-queue.png) |
| Staff reports, triages and confirms TL-0018 lost | 07:53 | PASS, LOSS-0001 confirmed, 2,500,000 VND charge | Execution record |
| Separate Admin settles LOSS-0001 as Charged | 07:54 | PASS, SETTLED, contract RETURNED, TL-0018 RETIRED | [Settlement](13-loss-settled.png), [device](29-tl0018-retired.png) |
| Separate Admin approves the damage charge | 07:54 | PASS, APPROVED, 700,000 VND DAMAGE line | Execution record and final invoice |
| Staff reads the closing invoice | 07:55 | PASS, 2,500,000 + 700,000 - 750,000 = 2,450,000 VND | [Credit](27-early-end-credit-line.png), [totals](28-confirmed-payment-reference.png) |
| Staff records the exact closing balance as a CASH rehearsal receipt | 07:55 | Ledger PASS, 2,450,000 VND CONFIRMED. Sandbox label FAIL, isSandbox:false, see #407 | [Payment](28-confirmed-payment-reference.png) |
| Staff closes the contract, then signs in fresh to verify persistence | 07:55 to 07:58 | PASS, CLOSED, due now 0 VND, due later 0 VND | [Closed and zero balance](26-persisted-zero-balance.png) |
| Verify damaged unit stays in maintenance | 07:55 | PASS, TL-0017 MAINTENANCE with open inspection-damage maintenance | [Device](24-tl0017-maintenance.png) |

The opening term invoice was already paid 900,000 VND. The counter therefore shows total paid
3,350,000 VND after the 2,450,000 VND closing receipt. Closing invoice INV-2026-000006 is paid in full.
Receipt reference: WF05-DS05B-20261106-RC0002.

## Findings and acceptance limits

- [#406](https://github.com/TrekLink-Team/treklink-web/issues/406): reloading the counter drops the
  transient amount/pending hint. The charge remains persisted and can be approved. The workflow
  continued through Damage charges, with no approval bypass.
- [#407](https://github.com/TrekLink-Team/treklink-web/issues/407): the demo CASH receipt returned
  isSandbox:false and has no payment SANDBOX badge. The repository currently sets this flag to false
  for every counter payment, while API 13 says sandbox payments stay labelled. KhoaDD must resolve
  the intended contract. No payment record was changed to conceal this finding.
- DS-05a is BLOCKED pending a separate approved contract. No other contract was mutated.
- F-11/F-21 from PR #395 was not tested on staging. Its PR was still unmerged during this run.

All nine submitted screenshots were visually inspected. They contain demo business data and no
credentials or tokens. [execution.json](execution.json) records the successful live mutation
responses without auth headers or raw customer fields. The harness paused on changed action labels
and the reloaded-counter hint. It resumed from confirmed persisted states without repeating
successful business writes. The browser closed after each bounded phase.
