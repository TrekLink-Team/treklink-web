# Organization home dashboard (`/o`)

| | |
|---|---|
| Owner | LongLP |
| Task | `specs/frontend/tasks.md` 5.6 |
| Assigned, due | Sprint 4 |
| Status | Built (2026-10-28), ready for review |
| Routes | `/o` (`specs/frontend/design.md` §2); the Org Manager's landing route after sign-in (D-059 rule 1), replacing the interim `/o/contracts` landing |
| Roles | Org Manager: the whole page. Org Operator: MSG26 (the route is Org Manager only; the Operator lands on `/o/map`). TrekLink accounts: MSG26. |
| Use case, FRs, story | UC-55; FR-BILL-06, FR-CON-14, FR-INC-01; US-UC55 |
| Requirements | `specs/frontend/requirements.md` REQ-UBI-07; `specs/billing/requirements.md` REQ-STA-02 |
| Wireframe | none yet; the layout is described under Data and Mobile below |

Scope from the task: contract summary from rentals api-design 02, balance due from billing api-design 10,
open incidents from incidents api-design 01 (`open=true`), devices out; widgets `ContractSummary`,
`InvoiceTable`, `IncidentQueue` of `design.md` §1.

## Data

| Shown | Source (api-design file, property) |
|---|---|
| Summary tiles: contracts by state (Requested, Approved, Active, Ending, Return due or Overdue) | rentals 02 `items[].status`, counted on the client from one page of `pageSize` at most `MAX_PAGE_SIZE`; the tile links to `/o/contracts?status=` |
| Devices out | rentals 03 `devices[]` of each ACTIVE, ENDING, RETURN_DUE or OVERDUE contract, counting rows with `handedOverAt` set and neither `checkedInAt` nor `lostAt`; at most five contracts are read, the tile says "and more" beyond that |
| Still due | billing 08 `items[]`, `totalVnd` minus `paidVnd` summed per contract, CLOSING invoices included, so a cancelled contract whose voiding adjustment settled it counts nothing (ruling on treklink-web#87 point 4); the tile shows the sum of what contracts still owe and the count of invoices with an overdue line (billing 08 `overdue=true`) of contracts that owe. The split into due now and later stays on the invoice page |
| Invoices needing payment | billing 08: the unpaid invoices of contracts that still owe, overdue first, five rows, in a `DataTable`; Pay opens the invoice |
| Open incidents | the `IncidentQueue` widget with incidents 01 `open=true`: `code`, `device.assetTag`, `device.holder.name`, `state`, `firstEventAt`, five rows; each row opens `/o/incidents/:id` (screen 8.1) |
| Next dates | rentals 02 `items[].currentTerm.endsAt` and `returnDueAt` of running contracts, the three nearest |

## Actions

| Control | Shown when | Endpoint | Confirmation | Success message |
|---|---|---|---|---|
| Request a contract (header, primary) | always | navigation to `/o/contracts/new` (screen 5.1) | none | none |
| Tile or row link | always | navigation to the list or detail it summarizes (screens 5.2, 6.1, 8.1) | none | none |
| Pay (invoice row) | an unpaid amount is due | navigation to `/o/invoices/:id` (screen 6.1), where Pay with SePay starts | none | none |

The dashboard changes nothing itself; every write happens on the page a link opens.

## States

| State | What the user sees |
|---|---|
| Loading | Each tile and widget shows its own skeleton; one slow source never blanks the page |
| Empty | No contracts: "Your organization has no contracts yet." with Request a contract. No open incidents: "No open incidents." No unpaid invoices: "Nothing to pay right now." |
| Error in one source | That tile or widget shows the server's message with Try again; the others stay |
| Organization not ACTIVE | An amber MSG28 banner with the organization's state from auth 04 `organization.status` |
| Not found or forbidden | `FORBIDDEN` (403): MSG26 full page |

## Form fields (if any)

None.

## Mobile, accessibility, live data

- 360 px layout: tiles in a two-column grid, then the invoices, the incidents and the next dates as stacked cards; every link target at least 44 px high.
- Tab order: header action, tiles in reading order, then each widget. Tiles are links with a text label and the number; status is never colour alone (chapter 06 §8.3). VND with thousands separators (§8.8).
- WebSocket events and invalidated query keys: `incident.changed` invalidates `['incidents', 'o', { open: true }]`; `device.label` and `device.released` invalidate `['contract', id]`. Query keys reuse those of screens 5.2, 6.1 and 8.1, so the dashboard and the pages share their cache.

## Open points for review

1. **Incidents endpoint**: incidents api-design 01 has no controller yet (HoangTK's lane). Until it exists the incident widget shows "Incidents are not available yet." instead of an error. Built that way on 2026-10-28.
2. **No aggregate endpoint**: the page composes existing list endpoints rather than adding a dashboard endpoint. If the reads prove slow on Neon, an `organizations` or `monitoring` summary endpoint is the follow-up, through a spec.
3. **Wireframe**: an SVG wireframe in the style of the other screens follows if the layout above is approved.

## Checklist

Chapter 06 §7 (Screen Design Checklist) and §8 (UI and UX practices), ticked by the owner before review.

- [x] Route and roles match `design.md` §2; Org Operator and TrekLink accounts get MSG26
- [x] Data: every field names rentals 02, 03, billing 08, 09 or incidents 01
- [x] Actions: navigation only; writes happen on the linked pages
- [x] States: loading per source, empty, error per source, not-active banner, 403
- [x] Forms: none
- [x] Mobile: 360 px layout described
- [x] Accessibility: tab order, text status labels, VND formatting
- [x] Live data: `incident.changed`, `device.label`, `device.released`; query keys shared with the pages
- [x] Traceability: UC-55, US-UC55
- [ ] Wireframe SVG: not drawn; the built page was walked in a browser on local PGlite on 2026-10-28
