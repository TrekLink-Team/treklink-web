# `LiveMapPage` for organizations and the fleet

| | |
|---|---|
| Owner | LongNN |
| Task | `specs/frontend/tasks.md` 9.1 |
| Assigned, due | 2026-10-21, 2026-10-23 |
| Status | Not started |
| Routes | <from `specs/frontend/design.md` §2> |
| Roles | <roles; what each sees> |
| Use case, FRs, story | <UC-nn>; <FR-...>; US-UC38, US-UC41 |
| Requirements | <REQ-... from the module requirements.md> |
| Wireframe | ![LiveMapPage for organizations and the fleet](9-1-livemappage-for-organizations-and-the-fleet.png) |

Scope from the task: monitoring api-design 01 and 02 then stream entries in `seq` order, ignoring entries at or below the snapshot cursor; stale markers with last-seen time; pulsing incident markers; late entries kept off the live map

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
