# Reports (`/t/reports`)

| | |
|---|---|
| Owner | LongNN |
| Task | `specs/frontend/tasks.md` 9.4 |
| Assigned, due | 2026-10-21, 2026-10-23 |
| Status | Ready for review |
| Routes | `/t/reports` (`specs/frontend/design.md` §2) |
| Roles | TrekLink Staff and TrekLink Admin (monitoring 08 permits both; `design.md` §2 lists Staff, and Admin holds every Staff permission, auth REQ-UBI-05, FR-AUTH-10; three modules have a REQ-UBI-05, so the module is named). Organization roles: MSG26. |
| Use case, FRs, story | UC-59; FR-BILL-10; US-UC59 |
| Requirements | `specs/monitoring/requirements.md` (Health, reports, device history group), `specs/billing/requirements.md` FR-BILL-10 |
| Wireframe | ![Reports](9-4-reports.svg) |

Scope from the task: monitoring api-design 08; date range; CSV download

## Data

One page, five tabs, one per `kind`. The date range and the CSV button are shared by all tabs.

| Shown | Source (api-design file, property) |
|---|---|
| Tab labels: Utilization, Revenue, Overdue contracts, Lost units, Incident times | monitoring 08 path parameter `kind`: `utilization`, `revenue`, `overdue`, `lost`, `incident-times` |
| Echo of the range ("1 Oct 2026 to 31 Oct 2026") | monitoring 08 `from`, `to` (`to` is exclusive; the page shows the last included day) |
| Utilization tab: table columns variant, units in service, rented unit-days, available unit-days, utilization (%) | monitoring 08 `rows[].variant`, `unitsInService`, `rentedUnitDays`, `availableUnitDays`, `utilizationPct` |
| Utilization tab: horizontal bar per variant, length = `utilizationPct` | monitoring 08 `rows[].utilizationPct` |
| Revenue tab: table columns variant, invoiced, paid, outstanding (VND), with a totals row (sum of each column, computed on the client) | monitoring 08 `rows[].variant`, `invoicedVnd`, `paidVnd`, `outstandingVnd` |
| Revenue tab: bar chart per variant, invoiced beside paid | monitoring 08 `rows[].invoicedVnd`, `paidVnd` |
| Overdue tab: table columns contract code, organization, end date, days overdue, units out, late fee (VND), state; sorted by days overdue, largest first; the figures are as of the `to` date | monitoring 08 `rows[].contractCode`, `organization`, `endDate`, `daysOverdue`, `unitsOut`, `lateFeeVnd`, `state` |
| Lost tab: table columns asset tag, variant, organization, contract code, lost at, loss-case state, charge (VND) | monitoring 08 `rows[].assetTag`, `variant`, `organization`, `contractCode`, `lostAt`, `lossCaseState`, `chargeVnd` |
| Incident-times tab: four tiles (acknowledge median, acknowledge P95, resolve median, resolve P95) in seconds shown as "42 s" or "14 min" | monitoring 08 `rows[].ackMedianSec`, `ackP95Sec`, `resolveMedianSec`, `resolveP95Sec` of the selected organization row (see note below) |
| Incident-times tab: table per organization, columns organization, incidents, the four figures | monitoring 08 `rows[].organization`, `incidents`, `ackMedianSec`, `ackP95Sec`, `resolveMedianSec`, `resolveP95Sec` |
| Every chart has its table directly beside or under it, as the text equivalent | same `rows[]` |

Row shapes per kind are those of monitoring 08 (D-057 rule 10). Notes:
- A percentile of several organizations cannot be computed from their per-organization percentiles, so the endpoint returns it: `incident-times` ends with one row whose `organization` is null, computed over every incident of the period, unrouted ones included (monitoring 08, treklink-web#331). The page names it "All organizations" and opens the four tiles on it; a click on an organization name in the table shows that organization's tiles instead. If no such row comes, the tiles open on the organization with the most incidents.
- Rows carry the ids of their records (monitoring 08, D-059 rule 6): the overdue row has `contractId` and the lost row has `lossCaseId` and `contractId`. The Overdue contract code and the Lost contract code link to `/t/contracts/:id` (screen 5.2 detail), and the Lost asset tag links to `/t/loss-cases/:id` (screen 4.4 detail) when the unit has a loss case; a unit with none shows its asset tag as text.

## Actions

| Control | Endpoint | Confirmation | Success message |
|---|---|---|---|
| Tab switch | monitoring 08 `GET /api/reports/:kind?from&to` | none | none |
| Apply range (From, To) | same | none | none |
| Quick ranges: This month, Last month, Last 30 days | same | none | none |
| Download CSV (secondary, top right) | monitoring 08 `GET /api/reports/:kind?from&to&format=csv`; the CSV text arrives in `result` and the client saves it as `treklink-{kind}-{from}-{to}.csv` | none | the browser's download; button text "Downloaded" for 3 seconds |
| Row link, Overdue tab: contract code | navigation to `/t/contracts/:id` by the row's `contractId` | none | none |
| Row link, Lost tab: asset tag and contract code | navigation to `/t/loss-cases/:id` by `lossCaseId` (no link when the unit has no loss case) and to `/t/contracts/:id` by `contractId` | none | none |
| Row select, Incident-times tab: the organization name in the table | none (the tiles update from the loaded rows; the row over every incident is selected on load) | none | none |

The CSV is never built from the table in the client: the server file is the export, so what is
downloaded equals what the report states. The screen is read-only; the range is its main input.

## States

| State | What the user sees |
|---|---|
| Loading | Table skeleton under the tabs; range and tabs usable |
| Empty | MSG01 "No results match your filters." plus "Try a longer range" |
| Error `VALIDATION_FAILED` (400): period missing, ending before it starts, or longer than `monitoring.reportMaxRangeDays` (366) | The form blocks it first with MSG35 under To ("Choose an end after the start, at most 366 days later."); the server message is the backstop in a banner |
| Error `UNAUTHENTICATED` (401) | One silent refresh, then `/sign-in` |
| CSV download fails | Inline error beside the button with the server message and a Retry; the table stays |
| Not found or forbidden (403) | MSG26 full-page notice |
| Success | Table, chart (utilization and revenue tabs) and a footer line "{n} rows, generated {time}" |

## Form fields (if any)

One step of 2 fields; the active tab is not a field.

| Step | Field | Type | Required | Rule |
|---|---|---|---|---|
| 1 | From | date | yes | Inclusive, `YYYY-MM-DD` as in monitoring 08 |
| 1 | To | date | yes | Exclusive in the API; the picker shows the last included day and sends the next day; must be after From and at most `monitoring.reportMaxRangeDays` days after it (MSG35) |

Defaults: the current calendar month. The form enforces `monitoring.reportMaxRangeDays` (366 by default, 1 to 732) and MSG35.

## Mobile, accessibility, live data

- 360 px layout: not an operator screen. Tabs become a select; the range fields stack; tables become cards (one card per row, label and value pairs); the chart is hidden behind a "Show chart" disclosure and the table is the primary view. Download CSV is a full-width button.
- Tab order and focus after each action: tabs (arrow keys move between them, Enter selects), From, To, Apply, Download CSV, table, pager. Switching a tab moves focus to the table heading. The chart has a text alternative ("Revenue by variant: treklink-v3 invoiced 18,000,000 VND, paid 13,500,000 VND") and the table beside it carries the same data. Amounts are VND with thousands separators and no decimals (§8 item 8).
- WebSocket events and invalidated query keys: none; reports are historical. Query key `['reports', kind, from, to]`, stale time 5 minutes.

## Checklist

Chapter 06 §7 (Screen Design Checklist) and §8 (UI and UX practices), ticked by the owner before review.

- [x] Route and roles match `design.md` §2 (Admin noted)
- [x] Data: row shape per kind cited from monitoring 08; every chart has its table
- [x] Actions: endpoint for each control, CSV path stated
- [x] States: loading, empty, 400, 401, CSV failure, 403, success
- [x] Forms: 1 step, 2 fields
- [x] Mobile: collapse rule stated
- [x] Accessibility: tab keys, chart text alternative and table equivalent
- [x] Live data: none, stated
- [x] Traceability: UC-59, FR-BILL-10, US-UC59
- [x] §8 items 2, 4, 8 applied

## Report tables on CollectionView (D-096, 2026-11-04)

Added by KhoaDD. The five report tables of `/t/reports` render through `CollectionView` (chapter 06 §9):
the first column titles each row (variant, contract, asset tag or organization), the others are its fields,
and the row's summary card, formerly the phone card, is its details pane. Reports stay read only, with no
item actions; the charts, the totals row and the CSV download are unchanged.
