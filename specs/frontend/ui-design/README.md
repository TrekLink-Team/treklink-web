# Screen designs (`ui-design/`)

One file per screen, `<route-slug>.md` (for example `o-contracts-new.md` for `/o/contracts/new`),
with its wireframe image `<route-slug>.png` or `.svg` next to it. Written in the SD phase of the
story by the screen's owner (D-053) and checked against the Screen Design Checklist,
`treklink-docs/_docs/01-conventions/06-frontend-conventions.md` §7, and the UI and UX practices, §8.

## Assignments

| Screens | Owner |
|---|---|
| Auth pages, contracts (`/o/contracts*`, `/t/contracts*`, `/t/counter/*`), invoices, payments, prices, damage charges | LongLP |
| Organization pages (`/register`, `/o/members`, `/o/roster`, `/o/api-keys`, `/o/field-stations`, `/t/organizations*`, `/t/compliance-cases*`) | TanNB |
| Incident pages (`/o/incidents*`, `/t/incidents`) | HoangTK |
| Fleet and maintenance (`/t/fleet`, `/t/devices/*`, `/t/stock-take`, `/t/maintenance`, `/t/loss-cases*`, `/o/loss-cases`) | KhoaDD |
| Shared layout and components, maps (`/o/map`, `/t/map`), public plans page, reports, administration (`/t/admin/*`), SRS §3.1.2 and §3.1.3 | LongNN |

Deadline 2 to 3 days from the assignment; the leader finishes what is not done (D-052).

## Template

```markdown
# <Page name> (`<route>`)

| | |
|---|---|
| Roles | <roles; what each sees> |
| Use case, FRs, story | UC-nn; FR-...; US-UCnn |
| Wireframe | ![<page>](<route-slug>.png) |

## Data
| Shown | Source (api-design file, property) |

## Actions
| Control | Endpoint | Confirmation | Success message |

## States
| State | What the user sees |
| Loading | |
| Empty | |
| Error `<CODE>` | MSGnn |
| Not found or forbidden | MSG26 |

## Form fields (if any)
| Step | Field | Type | Required | Rule |

## Mobile, accessibility, live data
- 360 px layout:
- Tab order and focus after each action:
- WebSocket events and invalidated query keys:
```
