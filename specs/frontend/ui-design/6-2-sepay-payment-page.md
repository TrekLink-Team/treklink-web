# SePay payment page

| | |
|---|---|
| Owner | LongLP |
| Task | `specs/frontend/tasks.md` 6.2 |
| Assigned, due | 2026-10-21, 2026-10-23 |
| Status | Not started |
| Routes | <from `specs/frontend/design.md` §2> |
| Roles | <roles; what each sees> |
| Use case, FRs, story | <UC-nn>; <FR-...>; US-UC19 |
| Requirements | REQ-UBI-08, NFR-UI-03 |
| Wireframe | ![SePay payment page](6-2-sepay-payment-page.png) |

Scope from the task: billing api-design 11, 15; VietQR image labelled sandbox; poll the payment until `CONFIRMED` (MSG20) or `EXPIRED` (MSG25)

## Data

| Shown | Source (api-design file, property) |
|---|---|
| | |

## Actions

| Control | Endpoint | Confirmation | Success message |
|---|---|---|---|
| | | | |

## States

| State | What the user sees |
|---|---|
| Loading | |
| Empty | |
| Error `<CODE>` | MSGnn |
| Not found or forbidden | MSG26 |

## Form fields (if any)

| Step | Field | Type | Required | Rule |
|---|---|---|---|---|
| | | | | |

## Mobile, accessibility, live data

- 360 px layout:
- Tab order and focus after each action:
- WebSocket events and invalidated query keys:

## Checklist

Chapter 06 §7 (Screen Design Checklist) and §8 (UI and UX practices), ticked by the owner before review.
