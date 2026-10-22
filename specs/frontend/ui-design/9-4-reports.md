# Reports (`/t/reports`)

| | |
|---|---|
| Owner | LongNN |
| Task | `specs/frontend/tasks.md` 9.4 |
| Assigned, due | 2026-10-21, 2026-10-23 |
| Status | Ready for review |
| Routes | `/t/reports` (`specs/frontend/design.md` §2) |
| Roles | TrekLink Staff and TrekLink Admin (monitoring 08 permits both; `design.md` §2 lists Staff, and Admin holds every Staff permission, REQ-UBI-05). Organization roles: MSG26. |
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
| Revenue rows: variant, invoiced (VND), paid (VND), unpaid (derived as invoiced minus paid) | monitoring 08 `rows[].variant`, `invoicedVnd`, `paidVnd` (revenue sample) |
| Revenue total row (sum of the column) | derived on the client from `rows[]` |
| Utilization, Overdue, Lost, Incident-times rows | `rows[]` of the same endpoint; the response sample only documents the `revenue` row shape. The columns of the other four kinds are not specified (open item O-10). The screen renders `rows[]` generically as a table whose columns are the keys of the first row until the contract fixes them. |
| Revenue bar chart per variant (invoiced and paid) | monitoring 08 `rows[]` (revenue); every other kind is a table only |

## Actions

| Control | Endpoint | Confirmation | Success message |
|---|---|---|---|
| Tab switch | monitoring 08 `GET /api/reports/:kind?from&to` | none | none |
| Apply range (From, To) | same | none | none |
| Quick ranges: This month, Last month, Last 30 days | same | none | none |
| Download CSV (secondary, top right) | monitoring 08 `GET /api/reports/:kind?from&to&format=csv`; the CSV text arrives in `result` and the client saves it as `treklink-{kind}-{from}-{to}.csv` | none | the browser's download; button text "Downloaded" for 3 seconds |
| Row link, Overdue tab: contract code | navigation to `/t/contracts/:id` (screen 5.2) | none | none |
| Row link, Lost tab: asset tag | navigation to `/t/devices/:id` (screen 4.2) | none | none |

The CSV is never built from the table in the client: the server file is the export, so what is
downloaded equals what the report states. The screen is read-only; the range is its main input.

## States

| State | What the user sees |
|---|---|
| Loading | Table skeleton under the tabs; range and tabs usable |
| Empty | MSG01 "No results match your filters." plus "Try a longer range" |
| Error `VALIDATION_FAILED` (400): range missing, reversed or the date unparsable | Banner with the server message; the form blocks a reversed range first with MSG02 under To (wording to confirm, open item O-5) |
| Error `UNAUTHENTICATED` (401) | One silent refresh, then `/sign-in` |
| CSV download fails | Inline error beside the button with the server message and a Retry; the table stays |
| Not found or forbidden (403) | MSG26 full-page notice |
| Success | Table, chart (revenue only) and a footer line "{n} rows, generated {time}" |

## Form fields (if any)

One step of 2 fields; the active tab is not a field.

| Step | Field | Type | Required | Rule |
|---|---|---|---|---|
| 1 | From | date | yes | Inclusive, `YYYY-MM-DD` as in monitoring 08 |
| 1 | To | date | yes | Exclusive in the API; the picker shows the last included day and sends the next day; must be after From |

Defaults: the current calendar month. No maximum range is documented for this endpoint (open
item O-10), so none is enforced in the form.

## Mobile, accessibility, live data

- 360 px layout: not an operator screen. Tabs become a select; the range fields stack; tables become cards (one card per row, label and value pairs); the chart is hidden behind a "Show chart" disclosure and the table is the primary view. Download CSV is a full-width button.
- Tab order and focus after each action: tabs (arrow keys move between them, Enter selects), From, To, Apply, Download CSV, table, pager. Switching a tab moves focus to the table heading. The chart has a text alternative ("Revenue by variant: treklink-v3 invoiced 18,000,000 VND, paid 13,500,000 VND") and the table beside it carries the same data. Amounts are VND with thousands separators and no decimals (§8 item 8).
- WebSocket events and invalidated query keys: none; reports are historical. Query key `['reports', kind, from, to]`, stale time 5 minutes.

## Checklist

Chapter 06 §7 (Screen Design Checklist) and §8 (UI and UX practices), ticked by the owner before review.

- [x] Route and roles match `design.md` §2 (Admin noted)
- [x] Data: revenue columns cited; the four other kinds' columns are open item O-10
- [x] Actions: endpoint for each control, CSV path stated
- [x] States: loading, empty, 400, 401, CSV failure, 403, success
- [x] Forms: 1 step, 2 fields
- [x] Mobile: collapse rule stated
- [x] Accessibility: tab keys, chart text alternative and table equivalent
- [x] Live data: none, stated
- [x] Traceability: UC-59, FR-BILL-10, US-UC59
- [x] §8 items 2, 4, 8 applied
