# Authentication events (`/t/admin/audit`, Authentication tab)

| | |
|---|---|
| Owner | LongNN |
| Task | `specs/frontend/tasks.md` 7.3 |
| Assigned, due | 2026-10-21, 2026-10-23 |
| Status | Ready for review |
| Routes | `/t/admin/audit` (`specs/frontend/design.md` §2 lists one audit route; this screen is its "Authentication" tab and the audit log of 7.4 is the other tab, see open item O-3) |
| Roles | TrekLink Admin only. Staff and organization roles: MSG26. |
| Use case, FRs, story | UC-58; FR-AUTH-08; US-UC58 |
| Requirements | `specs/auth/requirements.md` REQ-UBI-08, REQ-ERR-02 |
| Wireframe | ![Authentication events](7-3-authentication-events.svg) |

Scope from the task: auth api-design 17 with filters

## Data

| Shown | Source (api-design file, property) |
|---|---|
| Time (viewer timezone, UTC on hover) | auth 17 `items[].createdAt` |
| Event type, as a text badge | auth 17 `items[].type` |
| Email | auth 17 `items[].email` |
| Account (link to filter by this account) | auth 17 `items[].userId` |
| IP address | auth 17 `items[].ip` |
| Pager | auth 17 `pageNumber`, `pageSize`, `totalCount`, `totalPages` |

Event types shown in the filter (11 values of `AuthEventType` in `backend/prisma/schema.prisma`):
`LOGIN_SUCCEEDED`, `LOGIN_FAILED`, `LOGOUT`, `TOKEN_REFRESHED`, `TOKEN_REUSE_DETECTED`,
`PASSWORD_SET`, `PASSWORD_RESET_REQUESTED`, `PASSWORD_RESET_COMPLETED`, `ACCOUNT_LOCKED`,
`ACCOUNT_DEACTIVATED`, `ACCOUNT_REACTIVATED`. `TOKEN_REUSE_DETECTED` and `ACCOUNT_LOCKED` carry a
red badge with their text (security signals, §8 item 3). The list is append-only: no row has an
action. The log never holds an attempted password (REQ-UBI-08), so no such column exists.

## Actions

| Control | Endpoint | Confirmation | Success message |
|---|---|---|---|
| Apply filters: account, type, from, to | auth 17 `GET /api/auth-events?userId&type&from&to&pageNumber&pageSize` | none | none |
| Account filter | auth 09 `GET /api/accounts?q=` for TrekLink accounts; organization members are matched by the `email` shown on the row (auth 17 has no organization filter, open item O-4) | none | none |
| Clear filters | none (resets the query) | none | none |
| Refresh | same as Apply | none | none |
| Row: "Filter by this account" | auth 17 with `userId` set | none | none |

There is no primary action: the screen is read-only. Filters sit above the table (§8 item 2).

## States

| State | What the user sees |
|---|---|
| Loading | Table skeleton of 8 rows; filter bar usable |
| Empty | MSG01 "No results match your filters." with Clear filters |
| Error `VALIDATION_FAILED` (400) | Banner with the server message; typical cause is a reversed range, which the form also blocks with MSG02 "From must be before To." (wording to confirm, open item O-5) |
| Error `UNAUTHENTICATED` (401) | One silent refresh, then `/sign-in` |
| Not found or forbidden (403) | MSG26 full-page notice |
| Success | Rows render newest first; the filter values are kept in the URL query string so a link reproduces the view (no personal data goes in it: ids and enum values only) |

## Form fields (if any)

One step of 4 filter fields.

| Step | Field | Type | Required | Rule |
|---|---|---|---|---|
| 1 | Account | typeahead (name or email) | no | Resolves to a uuid for `userId` |
| 1 | Event type | select, 11 values above | no | Enum `AuthEventType` |
| 1 | From | date and time | no | Inclusive; sent as ISO 8601 UTC |
| 1 | To | date and time | no | Exclusive; must be after From |

## Mobile, accessibility, live data

- 360 px layout: not an operator screen. Filters collapse into a "Filters" disclosure above the list; each row becomes a card: badge and time on the first line, email and IP below.
- Tab order and focus after each action: tab bar (Authentication, Audit log), filter fields, Apply, table, pager. After Apply, focus moves to the result count line ("{n} events"), announced by a polite live region so a screen reader hears the new count.
- WebSocket events and invalidated query keys: none; the log is not streamed. The query key is `['auth-events', filters]`; the Refresh control refetches it.

## Checklist

Chapter 06 §7 (Screen Design Checklist) and §8 (UI and UX practices), ticked by the owner before review.

- [x] Route and roles match `design.md` §2 (tab split noted as O-3)
- [x] Data: every column names its source; the 11 event types come from the Prisma enum
- [x] Actions: read-only, no primary action, filters named
- [x] States: loading, empty, 400, 401, 403, success
- [x] Forms: 1 step, 4 filter fields
- [x] Mobile: collapse rule stated
- [x] Accessibility: tab order, live region for the count, badges carry text
- [x] Live data: none, query key stated
- [x] Traceability: UC-58, FR-AUTH-08, US-UC58
- [x] §8 items 2, 3, 4 (server paging), 8 (timezone) applied
