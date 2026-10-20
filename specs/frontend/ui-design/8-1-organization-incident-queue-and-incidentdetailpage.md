# Organization incident queue and `IncidentDetailPage`

| | |
|---|---|
| Owner | HoangTK |
| Task | `specs/frontend/tasks.md` 8.1 |
| Assigned, due | 2026-10-21, 2026-10-23 |
| Status | Not started |
| Routes | <from `specs/frontend/design.md` §2> |
| Roles | <roles; what each sees> |
| Use case, FRs, story | <UC-nn>; <FR-...>; US-UC32, US-UC33, US-UC34 |
| Requirements | REQ-UBI-03, REQ-UBI-07, REQ-UBI-09, AC-02 |
| Wireframe | ![Organization incident queue and IncidentDetailPage](8-1-organization-incident-queue-and-incidentdetailpage.png) |

Scope from the task: incidents api-design 01 to 07, 12 to 14; one-step acknowledge with at most 2 fields; status and outcome forms; false alarm with a reason; the search-and-rescue disclaimer on the queue

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
