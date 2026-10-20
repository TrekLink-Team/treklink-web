# `ComplianceCasePage` and channel key rotation

| | |
|---|---|
| Owner | TanNB |
| Task | `specs/frontend/tasks.md` 3.6 |
| Assigned, due | 2026-10-21, 2026-10-23 |
| Status | Not started |
| Routes | <from `specs/frontend/design.md` §2> |
| Roles | <roles; what each sees> |
| Use case, FRs, story | <UC-nn>; <FR-...>; US-UC63 |
| Requirements | <REQ-... from the module requirements.md> |
| Wireframe | ![ComplianceCasePage and channel key rotation](3-6-compliancecasepage-and-channel-key-rotation.png) |

Scope from the task: organizations api-design 27 to 31; open a case, record actions (suspend for Admin only), close with outcome and authority reference (required for fraud and theft); rotate key on the organization page clears the exposed flag

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
