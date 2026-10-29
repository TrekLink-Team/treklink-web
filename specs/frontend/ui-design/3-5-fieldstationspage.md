# `FieldStationsPage` (`/o/field-stations`)

| | |
|---|---|
| Owner | TanNB |
| Task | `specs/frontend/tasks.md` 3.5 |
| Assigned, due | 2026-10-21, 2026-10-23 |
| Status | Ready for review |
| Routes | `/o/field-stations` (`specs/frontend/design.md` §2) |
| Roles | Org Manager: the page with Create Field Station and Revoke. Org Operator: the same page read only, with the release and its download, without Create and Revoke. TrekLink Staff and Admin: no route here; they read station health on the system health page (task 9.3) and revoke through a compliance case action (task 3.6, `design.md` §4.1). |
| Use case, FRs, story | UC-06, UC-42; FR-EVT-13, FR-EVT-14, FR-EVT-18; US-UC06, US-UC42 |
| Requirements | `specs/organizations/requirements.md` REQ-UBI-03, REQ-EVT-09, REQ-EVT-11, REQ-ERR-06, AC-06, AC-08 |
| Wireframe | Figure 1 below, `3-5-fieldstationspage.svg` |

Scope from the task: organizations api-design 23 to 26; create shows the secret once; health columns with `outdated`; the current release with its version, SHA-256 and one download per operating system

## Wireframe

![FieldStationsPage](3-5-fieldstationspage.svg)

***Figure 1***: Wireframes of the Field Stations page (A), the create dialog (B1), the dialog that shows the new credential once (B2), the revoke confirmation (B3), the station limit refusal (C1), the release unavailable state (C2), the empty list (C3), and the 360 px layouts (D1, D2). The data is illustrative.

## Data

Release card:

| Shown | Source (api-design file, property) |
|---|---|
| Version and publication date | organizations 26 `result.version`, `result.publishedAt` |
| One row per file: operating system, size in MB, SHA-256 | organizations 26 `result.files[].os`, `sizeBytes`, `sha256`; the real SHA-256 is shown in full, wrapped on a phone |
| Download | organizations 26 `result.files[].downloadUrl`, a static file served outside the envelope |

Station table:

| Shown | Source (api-design file, property) |
|---|---|
| Name and username | organizations 23 `result[].name`, `result[].mqttUsername` |
| Version, with the badge Current or Outdated | organizations 23 `result[].version` and `result[].outdated`; a revoked row shows the version without a badge |
| Last sync, or "Never" when null | organizations 23 `result[].lastSyncAt`, in the viewer's timezone |
| Queue p0 / p1 / p2 / p3, or "No data yet" for an empty array | organizations 23 `result[].queueDepth`, read in index order (see Open points) |
| Oldest retry | organizations 23 `result[].oldestRetryCount` |
| Status: Active, or Revoked with its date | organizations 23 `result[].revokedAt` |
| Outdated notice ("1 of 3 active stations runs an older version") | counted from organizations 23: rows with `revokedAt` null and `outdated` true, against the rows with `revokedAt` null |
| Count line ("3 active stations, 1 revoked") | counted from organizations 23 `result` |

Credential dialog after creation: organizations 24 `result.brokerUrl`, `result.mqttUsername`, `result.mqttSecret`.

## Actions

| Control | Endpoint | Confirmation | Success message |
|---|---|---|---|
| Create Field Station (primary action) | organizations 24 `POST /api/organizations/:id/field-stations` | dialog form with the Name field | "Field Station credential created. Copy it now; it will not be shown again." (server message), shown inside the credential dialog |
| Copy (broker URL, username, secret) | none, browser clipboard | none | the button reads "Copied" for two seconds |
| Done (credential dialog) | none | none | closes the dialog and discards the secret from the page |
| Revoke | organizations 25 `POST /api/organizations/:id/field-stations/:stationId/revoke` | ConfirmDialog naming the station ("Revoke Field Station Office laptop?") with the effect: the broker refuses it from the next connection, its cache lasts up to 60 seconds, and events the station still holds are delivered once a new credential is configured | "Field Station credential revoked" (server message) |
| Download | none, a link to `downloadUrl` styled with `buttonClasses` | none | the browser's download |
| Retry (release card) | organizations 26 again | none | none |

A revoked row has no actions.

## States

| State | What the user sees |
|---|---|
| Loading | Skeleton release card and skeleton rows; Create and Revoke show their pending state and are disabled until the server answers. |
| Empty | EmptyState "No Field Stations yet" with the text "Create a credential, then run the Field Station on the laptop at your base." and the Create Field Station button (Figure 1, C3). |
| Never synced | Last sync "Never" and queue "No data yet" for a station that has not reported yet. |
| Outdated | An amber Alert above the table and the badge "Outdated" on each such row; the badge carries its words, never colour alone. |
| Error `VALIDATION_FAILED` | MSG02 under Name ("{field} is required."); the dialog keeps its value. |
| Error `STATION_LIMIT` | The server message "Revoke an unused Field Station before creating another." as an error Alert in the create dialog. No SRS message code exists (D-059 rule 3). |
| Error `INVALID_STATE_TRANSITION` (create) | MSG28 as an error Alert in the dialog, for example "This cannot be done while it is SUSPENDED." |
| Error `RELEASE_UNAVAILABLE` (503) | The server message "The Field Station download is unavailable. Try again later." as an error Alert in the release card with Retry; the station table stays usable (Figure 1, C2). |
| Error `NOT_FOUND` (organization, station) | The server message ("Field Station not found.") as an error Alert; the list refetches. |
| Forbidden | MSG26 full-page notice. |
| Unauthenticated | Redirect to `/sign-in` with the same-origin `?next=` path (D-059 rule 1). |
| Any other failure | The server message, or "Something went wrong.", as an error Alert. |
| Success | The credential dialog after creation; a toast for a revoke; the list refetches. |

## Form fields (if any)

Create Field Station (one step, one field):

| Step | Field | Type | Required | Rule |
|---|---|---|---|---|
| 1 | Name | text | yes | not blank; hint "Where the laptop runs, for example."; organizations 24 `name` |

Revoke (one step, one field): Reason, text, optional for a Manager, organizations 25 `reason`; the hint says it is required when TrekLink Staff revoke.

## Mobile, accessibility, live data

- 360 px layout (Figure 1, D1 and D2): the table becomes one card per station with the name, username and status, the version with its badge and the last sync, the queue, and a Revoke text button of at least 44 px; the Create button is shortened to "Create station". The outdated notice and the release card stack above the cards, and Download spans the width.
- Tab order and focus after each action: Create Field Station, Download, then Revoke of each row in order. The create dialog puts focus in Name. When the credential dialog opens, focus moves to the first Copy; each value has an accessible name (Broker URL, Username, Secret) and "Copied" is announced as a status. Done returns focus to Create Field Station. A confirm dialog traps focus, closes on Escape, lists Cancel first, and after a revoke focus moves to the page heading. Download is a link, not a Button (`design-system.md` §6).
- WebSocket events and invalidated query keys: no WebSocket event refreshes this page today (the live provider handles map and incident events only). Query keys `['org-field-stations', orgId]` and `['org-field-station-release', orgId]`. Create and revoke invalidate the station list. The secret lives only in the open dialog's state: it never enters the query cache, the URL or browser storage. The station list refetches every 30 seconds while the tab is visible and when the window regains focus, so health stays current (see Open points).

## Open points raised to the leader (D-052 rule 2)

1. **`queueDepth` shape.** organizations 23 returns four numbers in an array, and monitoring 06 returns an object `queueDepth.p0` to `p3`. The screen reads the array in index order as p0 to p3; confirm the order and whether both endpoints should use one shape.
2. **Health refresh.** No event pushes station health to the page, so the screen polls every 30 seconds (a proposal, not in any spec). Confirm the interval or an event.
3. **`STATION_LIMIT` has no SRS message code**, and the limit (`organizations.maxFieldStations`, default 5 in the seed migration) is not returned by any endpoint, so the screen cannot show "3 of 5".
4. **Staff revoke.** api-design 25 lets TrekLink Staff and Admin revoke, but no screen of this task gives them a route. The screen assumes they use the compliance case action of task 3.6; confirm.
5. **The release lists one row per file.** The sample has only `windows-x64`; the layout holds any number of operating systems.

## Checklist

Chapter 06 §7 (Screen Design Checklist) and §8 (UI and UX practices), ticked by the owner before review.

- [x] Route and roles match `specs/frontend/design.md` §2; what an Operator, Staff and Admin see is stated
- [x] Every shown field names its api-design file and property; nothing is shown that no endpoint returns
- [x] Every action names its endpoint, its confirmation and its message; revoke names the station (§8 item 1)
- [x] States cover loading, empty, every error code of api-design 23 to 26, forbidden (MSG26) and success
- [x] The form has one step and one field, with its rule
- [x] The 360 px layout is drawn (Figure 1, D1 and D2)
- [x] Tab order, focus after each action and accessible names are stated
- [x] Live data: no event, the query keys and the refetch rule are stated
- [x] Traceability: UC-06, UC-42, FR-EVT-13, FR-EVT-14, FR-EVT-18, US-UC06, US-UC42
- [x] One primary action per screen; status is text as well as colour (§8 items 1 and 3)
