# API keys

| | |
|---|---|
| Owner | TanNB |
| Task | `specs/frontend/tasks.md` 3.4 |
| Assigned, due | 2026-10-21, 2026-10-23 |
| Status | Ready for review |
| Routes | `/o/api-keys` (`specs/frontend/design.md` §2) |
| Roles | Org Manager: the page with every action. Org Operator and TrekLink Staff or Admin: no access; an Operator who opens the route sees MSG26. |
| Use case, FRs, story | UC-06; FR-ORG-06; US-UC06 |
| Requirements | `specs/organizations/requirements.md` REQ-UBI-03, REQ-EVT-09, REQ-ERR-06, AC-05 |
| Wireframe | Figure 1 below, `3-4-api-keys.svg` |

Scope from the task: organizations api-design 20 to 22; the secret is shown once with a copy button and never again

## Wireframe

![API keys](3-4-api-keys.svg)

***Figure 1***: Wireframes of the API keys page (A), the create dialog (B1), the dialog that shows the new key once (B2), the revoke confirmation (C1), the refusal at the key limit (C2), the empty list (C3), and the 360 px layouts (D1, D2). The data is illustrative.

## Data

| Shown | Source (api-design file, property) |
|---|---|
| Key name | organizations 20 `result[].name` |
| Prefix (the first 8 characters, such as `tlk_7Hc2`) | organizations 20 `result[].prefix` |
| Created | organizations 20 `result[].createdAt`, in the viewer's timezone |
| Last used, or "Never" when null | organizations 20 `result[].lastUsedAt` |
| Status badge: Active, or Revoked with its date | organizations 20 `result[].revokedAt` |
| Count line ("2 active keys, 1 revoked") | counted from organizations 20 `result` |
| The full key, once, in the dialog after creation | organizations 21 `result.key` |

Nothing else about a key exists on the platform: only its SHA-256 hash is stored (REQ-UBI-03), so no screen can show the key again.

## Actions

| Control | Endpoint | Confirmation | Success message |
|---|---|---|---|
| Create API key (primary action) | organizations 21 `POST /api/organizations/:id/api-keys` | dialog form with the Name field | "API key created. Copy it now; it will not be shown again." (server message), shown inside the key dialog |
| Copy | none, browser clipboard | none | the button reads "Copied" for two seconds |
| Done (key dialog) | none | none | closes the dialog and discards the key from the page |
| Revoke | organizations 22 `POST /api/organizations/:id/api-keys/:keyId/revoke` | ConfirmDialog naming the key and its prefix ("Revoke API key ERP integration?") and stating that it stops working from the next request and cannot be undone | "API key revoked" (server message) |

A revoked row has no actions.

## States

| State | What the user sees |
|---|---|
| Loading | Skeleton rows; Create and Revoke show their pending state and are disabled until the server answers. |
| Empty | EmptyState "No API keys yet" with the text "Create a key to read your devices' telemetry from your own systems." and the Create API key button (Figure 1, C3). |
| Error `VALIDATION_FAILED` | MSG02 under Name ("{field} is required."); the dialog keeps its value. |
| Error `KEY_LIMIT` | The server message "Revoke an unused key before creating another." as an error Alert in the create dialog. No SRS message code exists (D-059 rule 3). |
| Error `NOT_FOUND` (organization, key) | The server message ("API key not found.") as an error Alert; the list refetches. |
| Forbidden | MSG26 full-page notice. |
| Unauthenticated | Redirect to `/sign-in` with the same-origin `?next=` path (D-059 rule 1). |
| Any other failure | The server message, or "Something went wrong.", as an error Alert. |
| Success | The key dialog after creation; a toast for a revoke; the list refetches. |

## Form fields (if any)

Create API key (one step, one field):

| Step | Field | Type | Required | Rule |
|---|---|---|---|---|
| 1 | Name | text | yes | not blank; hint "A label to tell your keys apart."; organizations 21 `name` |

## Mobile, accessibility, live data

- 360 px layout (Figure 1, D1 and D2): the table becomes cards with the name, prefix, status and last use, and a Revoke text button of at least 44 px; Create API key stays beside the title. The key dialog fills the width, wraps the key over two lines, and stacks Copy above Done.
- Tab order and focus after each action: Create API key, then Revoke of each row in order. The create dialog puts focus in Name. When the key dialog opens, focus moves to Copy; the key text is selectable and has the accessible name "New API key". Done returns focus to Create API key. A confirm dialog traps focus, closes on Escape, lists Cancel first, and after a revoke focus moves to the page heading. The status of a key is text, never colour alone.
- WebSocket events and invalidated query keys: none. Query key `['org-api-keys', orgId]`; create and revoke invalidate it. The full key lives only in the open dialog's state: it never enters the query cache, the URL or browser storage, so the list refetch returns prefixes only. The list refetches when the window regains focus, so `lastUsedAt` stays current.

## Open points raised to the leader (D-052 rule 2)

1. **The key limit is not shown.** `organizations.maxApiKeys` defaults to 5 (seed migration), but no endpoint returns it, so the screen cannot show "3 of 5". It shows the count of active keys and the `KEY_LIMIT` refusal.
2. **`KEY_LIMIT` has no SRS message code.** The screen shows the server message (D-059 rule 3). The message says "an unused key", while the limit counts active keys; confirm the wording.
3. **Name length and list order.** api-design 20 and 21 give no maximum for `name` and no sort order. The screen shows the list as returned and applies no length check beyond not blank.

## Checklist

Chapter 06 §7 (Screen Design Checklist) and §8 (UI and UX practices), ticked by the owner before review.

- [x] Route and roles match `specs/frontend/design.md` §2
- [x] Every shown field names its api-design file and property; nothing is shown that no endpoint returns
- [x] Every action names its endpoint, its confirmation and its message; revoke names the key (§8 item 1)
- [x] States cover loading, empty, every error code of api-design 20 to 22, forbidden (MSG26) and success
- [x] The form has one step and one field, with its rule
- [x] The 360 px layout is drawn (Figure 1, D1 and D2)
- [x] Tab order, focus after each action and accessible names are stated
- [x] Live data: no event, the query key and the invalidation are stated
- [x] Traceability: UC-06, FR-ORG-06, US-UC06
- [x] One primary action per screen; status is text as well as colour (§8 items 1 and 3)
