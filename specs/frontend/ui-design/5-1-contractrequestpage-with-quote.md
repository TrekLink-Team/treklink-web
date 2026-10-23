# `ContractRequestPage` with quote (`/o/contracts/new`)

| | |
|---|---|
| Owner | LongLP |
| Task | `specs/frontend/tasks.md` 5.1 |
| Assigned, due | 2026-10-21, 2026-10-23 |
| Status | Ready for review |
| Routes | `/o/contracts/new` (`specs/frontend/design.md` §2) |
| Roles | Org Manager: the whole page. Org Operator: MSG26 (the route is Org Manager only). A Manager whose organization is not `ACTIVE` sees the page with an amber MSG28 banner and Send request disabled. |
| Use case, FRs, story | UC-15, UC-16 (availability is checked at approval, screen 5.3); FR-CON-01, FR-CON-02, FR-CON-07, FR-BILL-01, FR-BILL-02, FR-CFG-02; US-UC15 |
| Requirements | `specs/rentals/requirements.md` REQ-EVT-01, REQ-UBI-03, REQ-UBI-04, REQ-ERR-02, REQ-ERR-03; `specs/frontend/requirements.md` REQ-UBI-07 |
| Wireframe | ![ContractRequestPage with quote](5-1-contractrequestpage-with-quote.svg) |

Scope from the task: rentals api-design 01 and billing api-design 02; four steps at most

## Data

| Shown | Source (api-design file, property) |
|---|---|
| Variant choices with name and monthly price per device | billing 01 `result.variants[].id`, `name`, `monthlyPriceVnd` |
| Day-plan lengths offered | billing 01 `result.dayPlanLengths` |
| Minimum order quantity, as the quantity field's hint | billing 01 `result.minOrderQuantity` |
| Holding-fee ratio, as a percentage in the quote | billing 01 `result.holdingFeeRatio` |
| Quote: first payment, day-plan unit per day, days, total and the formula | billing 02 `result.firstPaymentVnd`, `unitPerDayVnd`, `days`, `totalVnd`, `formula` |
| Quote for a monthly plan: term fee, first payment (the holding fee) and the formula | billing 02 `result.termFeeVnd`, `firstPaymentVnd`, `formula` for `MONTHLY` (D-059 rule 6) |
| Organization state, for the not-active banner | auth 04 `result.organization.status` (`['me']`) |
| After sending: the new contract's code | rentals 01 `result.code` |

## Actions

| Control | Endpoint | Confirmation | Success message |
|---|---|---|---|
| Plan, variant or quantity changed (quote refresh, debounced 400 ms once all step 1 fields are valid) | billing 02 `POST /api/quotes` | none | the quote panel updates |
| Next and Back (between steps) | none | none | none |
| Send request (step 3, primary) | rentals 01 `POST /api/contracts` | none: nothing is charged until Staff approve and the first invoice is paid | toast MSG14; navigation to `/o/contracts/:id` (screen 5.2) |
| Cancel (header link) | none; back to `/o/contracts` | asks first if a field is filled (chapter 06 §8.7) | none |

## States

| State | What the user sees |
|---|---|
| Loading | Step 1 skeleton until billing 01 answers; the quote panel shows a spinner while billing 02 runs; Send request shows its pending state and is disabled until the server answers |
| Empty | No active variant in billing 01: "No devices can be rented right now. Contact TrekLink." and the steps are disabled |
| Error `VALIDATION_FAILED` (400, rentals 01, billing 02) | MSG02 under the field the server names |
| Error `BELOW_MOQ` (400, rentals 01, billing 02) | MSG13 under Quantity, with `minOrderQuantity` |
| Error `DAY_PLAN_LENGTH` (400, rentals 01) | MSG02 under Day plan length; not reachable through the select, shown only if the lengths change while the page is open |
| Error `ORGANIZATION_NOT_ACTIVE` (409, rentals 01) | MSG28 banner with the organization's state; Send request disabled |
| Error `UNAUTHENTICATED` (401) | `apiClient` refreshes once and retries, else `/sign-in` (frontend REQ-EVT-02) |
| Not found or forbidden | `FORBIDDEN` (403): MSG26 full page |
| Success | Toast MSG14 on the contract page |

## Form fields (if any)

| Step | Field | Type | Required | Rule |
|---|---|---|---|---|
| 1 Plan and devices | Plan | segmented control: Monthly, Day plan | yes | `MONTHLY` or `DAY` (rentals 01 `planType`) |
| 1 Plan and devices | Day plan length | select from `dayPlanLengths` | for a day plan | one of `rentals.dayPlanLengths` (rentals 01 `dayPlanDays`); hidden for Monthly |
| 1 Plan and devices | Hardware variant | select | yes | an active variant from billing 01 (rentals 01 `hardwareVariantId`) |
| 1 Plan and devices | Quantity | integer | yes | at least `rentals.minOrderQuantity` (rentals 01 `quantity`) |
| 2 Start date | Start date (handover day) | date | yes | not in the past (rentals 01 `requestedStartDate`) |
| 3 Review and send | none | | | read-only summary of steps 1 and 2 with the quote |

Three steps of at most four fields (chapter 06 §3, REQ-UBI-07). A running contract never changes, so the
review step states: "Plan, variant and quantity cannot change after the request. Need more devices? Send
another request." (FR-CON-07).

## Mobile, accessibility, live data

- 360 px layout: the steps stack in one column; the quote collapses into a summary bar under the current step (first payment) that expands on tap; Next and Send request are full width and at least 44 px high.
- Tab order and focus after each action: the step indicator is a list with `aria-current="step"`; Next moves focus to the next step's heading; a field error moves focus to the first invalid field. The quote panel is an `aria-live="polite"` region so a new amount is announced. VND amounts use thousands separators (chapter 06 §8.8).
- WebSocket events and invalidated query keys: no live events. Query keys `['plans']` (billing 01) and `['quote', planType, dayPlanDays, variantId, quantity]` (billing 02); sending invalidates `['contracts', 'own']`.

## Checklist

Chapter 06 §7 (Screen Design Checklist) and §8 (UI and UX practices), ticked by the owner before review.

- [x] Route and roles match `design.md` §2; Org Operator gets MSG26; not-active organization banner
- [x] Data: every field names billing 01, billing 02, rentals 01 or auth 04
- [x] Actions: quote refresh, send request (MSG14), cancel with a dirty-form check
- [x] States: loading, empty catalogue, every error code of rentals 01 and billing 02, success
- [x] Forms: three steps, at most four fields each, with type, requirement and rule
- [x] Mobile: 360 px layout described
- [x] Accessibility: step indicator, focus after Next and errors, live quote region
- [x] Live data: none; query keys listed
- [x] Traceability: UC-15, US-UC15
