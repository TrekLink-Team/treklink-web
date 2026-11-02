# Service credits: `ServiceCreditsPage`, the request from the contract page, the contract's credits

| | |
|---|---|
| Owner | LongLP |
| Task | `specs/frontend/tasks.md` 6.5 (billing task 8.2) |
| Assigned, due | 2026-11-02, 2026-11-04 |
| Status | Ready for review |
| Routes | `/t/service-credits` (new, `specs/frontend/design.md` §2), the request and the credits card on `/t/contracts/:id`, the credits card on `/o/contracts/:id`, the line on `/o/invoices/:id` and the invoice panel of `/t/billing`, the close blocker on `/t/contracts/:id` and `/t/counter/:contractId` |
| Roles | TrekLink Staff: request a credit, read every credit, record a refund. TrekLink Admin: everything Staff do, and decide a credit they did not request. Org Manager: the credits of its own contracts, read only. Org Operator: nothing (no `serviceCredit.read.own`); the card is hidden. Other organizations: MSG26 |
| Use case, FRs, story | D-092 rule 5; billing design §9; no backlog story yet (the leader adds one through `build_backlog.py`) |
| Requirements | `specs/billing/requirements.md` REQ-EVT-12 to REQ-EVT-15, REQ-STA-02, REQ-ERR-06 to REQ-ERR-08, AC-06 to AC-08; rentals REQ-EVT-18 |
| Wireframe | None drawn. The queue is the layout of screen 6.4 (`6-4-prices-damage-rates-damagechargespage.svg`, damage charges part) with the columns below; the card and the request dialog follow screen 5.2 |

Scope from the task: billing api-design 18 to 22; request from a checked-in unit with a FAILED inspection on
`/t/contracts/:id`; the Admin decision queue and the Staff refunds on `/t/service-credits`; the credits on both
contract pages; the `SERVICE_CREDIT` line on the invoice and the `SERVICE_CREDIT_PENDING` close blocker.

Out of scope, kept for later: a request from the maintenance record (design §9.6 names it as a second entry);
the maintenance page links to the device, whose contract page carries the request. Linking an incident as the
source of the outage start: the dialog takes the note; billing 18 accepts `outageSourceIncidentId` for a later
picker.

## Data

| Shown | Source (api-design file, property) |
|---|---|
| Queue and card rows: device, cause, outage from and to, days, amount, status, raised | billing 19 and 20 `items[].assetTag`, `cause`, `outageFrom`, `outageTo`, `outageDays`, `computedVnd`, `status`, `createdAt` |
| Decided and applied amounts | billing 19 and 20 `decidedVnd` (shown when it differs from `computedVnd`), `appliedVnd` (shown while `APPROVED` with a part on invoices) |
| Source of the outage start, next to the amount in the decision dialog | billing 20 `outageSourceNote`, or "Incident" when `outageSourceIncidentId` is set |
| Decision reason, refund reference | billing 19 and 20 `decisionReason`, `refundReference`, `refundedAt` |
| Whether the viewer requested the credit | billing 20 `items[].requestedById` compared with auth 04 `result.id` |
| Contract link in the queue | billing 20 `contractId` to `/t/contracts/:id` |
| Request eligibility on a device row | rentals 03 `devices[].contractDeviceId`, `checkedInAt`, `inspection.id`, `inspection.result` (`FAILED`) |
| Line on the invoice | billing 09 `lines[].type` `SERVICE_CREDIT`, negative `amountVnd`; the line status reads "Credit" |
| Close blocker | rentals 20 `blockers[]` `SERVICE_CREDIT_PENDING` with `amountVnd` and `assetTag` |

On a credit the Admin requested, Decide stays reachable, disabled, with the reason "Another Admin must decide:
you requested this credit." (BR-24, as screen 6.4); the server's 403 remains for a forced request.

## Actions

| Control | Shown when | Endpoint | Confirmation | Success message |
|---|---|---|---|---|
| Request service credit (device row action, `/t/contracts/:id`) | Staff or Admin, the row is checked in (`checkedInAt`) and its inspection is `FAILED` | opens the request dialog | none | none |
| Request (dialog, primary) | as above | billing 18 `POST /api/contracts/:id/service-credits` | none | toast "Service credit requested."; the contract's credits refetch |
| Filter by status (queue) | always | billing 20 `GET /api/service-credits?status=` | none | none |
| Decide (queue row action) | Admin, `REQUESTED`; disabled with its reason on the viewer's own request | opens the decision dialog | none | none |
| Record decision (dialog, primary) | as above | billing 21 `POST /api/service-credits/:id/decision` with the row's `version` | Reject asks "Reject the {amount} credit on {assetTag}?" | toast MSG03; the queue, the contract's credits and the balance refetch |
| Record refund (queue row action) | Staff or Admin, `REFUND_DUE` | opens the refund dialog | none | none |
| Save refund (dialog, primary) | as above | billing 22 `POST /api/service-credits/:id/refund` | none | toast MSG03; the queue refetches |
| Open contract (queue row) | always | link | none | none |

## States

| State | What the user sees |
|---|---|
| Loading | Table skeleton rows; each primary button shows its pending state until the server answers |
| Empty | Queue on Requested: "No service credits are waiting for a decision." On Refund due: "No refunds are waiting to be recorded." Other filters: "No service credits match these filters." Contract card: "No service credits on this contract." |
| Error `VALIDATION_FAILED` (400, billing 18, 21) | The server's message in the dialog, under the field it names when it names one (outage start, fault record, amount, reason) |
| Error `DEVICE_NOT_ON_CONTRACT` (409, billing 18) | The server's message in the dialog |
| Error `INVALID_STATE_TRANSITION` (409, billing 18, 21, 22) | MSG28 text from the server; the queue or the card refetches (another Admin decided first, or the unit is not back) |
| Error `DUPLICATE_CREDIT` (409, billing 18) | "A service credit already covers part of this outage." under Outage start |
| Error `STALE_VERSION` (409, billing 21) | The server's message; the queue refetches so the Admin sees the current row |
| Error `SEPARATION_OF_DUTY` (403, billing 21) | "A different Admin must decide this credit." in the dialog |
| Error `DUPLICATE_REFERENCE` (409, billing 22) | MSG10-style text under Reference: "This reference is already recorded." |
| Not found or forbidden | `NOT_FOUND` (404) or `FORBIDDEN` (403): MSG26 |
| Success | Toast; the affected lists refetch |

## Form fields (if any)

| Step | Field | Type | Required | Rule |
|---|---|---|---|---|
| Request | Cause | select: Battery, Radio, GPS, Board, Firmware | yes | (billing 18 `cause`) |
| Request | Outage start | date and time | yes | not in the future, not before the unit's handover (billing 18 `outageFrom`) |
| Request | Source of the start | text area | yes | the call or counter visit and its time, at most 500 characters (billing 18 `outageSourceNote`) |
| Request | Fault record | read-only text | | the row's FAILED inspection and its time (billing 18 `faultInspectionId` from rentals 03) |
| Decide | Decision | radio: Approve, Reduce, Reject | yes | (billing 21 `decision`) |
| Decide | Credit (VND) | integer | for Reduce | above 0 and below the computed amount (billing 21 `decidedVnd`) |
| Decide | Reason | text area | for Reduce and Reject | not empty, at most 500 characters (billing 21 `reason`) |
| Refund | Reference | text | yes | the bank-transfer reference, at most 100 characters (billing 22 `reference`) |

The dialog states that the outage end is computed: "The outage ends at the replacement's handover, the
check-in or the term end, whichever comes first." Every form is one step of at most four fields.

## Mobile, accessibility, live data

- 360 px layout: the queue and the card use `DataTable`, which scrolls sideways on a narrow screen (looked at in
  the browser pane at 440 px on 2026-11-02); dialogs open full screen with full-width buttons at least 44 px high.
- Tab order and focus after each action: status filter, then the queue. Dialogs trap focus and return it to the
  row action; after a decision the queue refetches and focus returns to the table. Status is a text label;
  amounts are right-aligned VND with thousands separators.
- WebSocket events and invalidated query keys: no live events. Query keys `['service-credits', filters]` and
  `['service-credits', 'contract', contractId]`; a request invalidates both and the contract detail; a decision
  invalidates both and `['contract-balance', contractId]`; a refund invalidates both.

## Checklist

Chapter 06 §7 (Screen Design Checklist) and §8 (UI and UX practices), ticked by the owner before review.

- [x] Route and roles match `design.md` §2; Org Operator sees nothing; Staff record refunds; Admin decides
- [x] Data: every field names billing 09, 18 to 22, or rentals 03 and 20
- [x] Actions: request, decide, record a refund, each with its confirmation where one is due and its message
- [x] States: loading, empty per list, every error code of billing 18 to 22, 403 and 404
- [x] Forms: every field with type, requirement and rule; at most four per form
- [x] Mobile: narrow layout described
- [x] Accessibility: focus trap and return, text labels
- [x] Live data: none; query keys listed
- [x] Traceability: D-092 rule 5, billing REQ-EVT-12 to REQ-EVT-15
