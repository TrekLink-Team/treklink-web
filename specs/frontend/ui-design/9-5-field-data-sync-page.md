# Field data sync page (`/t/admin/sync`)

| | |
|---|---|
| Owner | LongNN (built under D-078 by KhoaDD) |
| Task | `specs/frontend/tasks.md` 9.5 |
| Assigned, due | 2026-11-01, not assigned through the scaffold |
| Status | Built; written after the page (2026-11-01) |
| Routes | `/t/admin/sync` (`specs/frontend/design.md` §2), sidebar "Field data sync", group Fleet |
| Roles | TrekLink Staff and Admin: `read FieldEvent` (`fieldEvent.read`) for the page and its two lists, and `read FieldStation` (`fieldStation.read`) for the status read. Organization roles: MSG26. |
| Use case, FRs, story | UC-26, UC-42; FR-EVT-01, FR-EVT-05, FR-EVT-11, FR-EVT-13, FR-EVT-17, FR-EVT-18; US-UC42 |
| Requirements | `specs/gateway-sync/requirements.md` REQ-UBI-02, REQ-ERR-01, REQ-ERR-02, REQ-ERR-05, REQ-ERR-06, AC-05 |
| Wireframe | Not drawn yet; the built page is the reference |

Scope: MF-02 end to end for Staff, steps 4 and 5 of `docs/demo/2026-11-01-demo-script.md`. Everything the
page showed on 2026-10-31 stays.

## Data

| Shown | Source (api-design file, property) |
|---|---|
| Card "MQTT subscriber": `UP`, `DOWN` or `UNKNOWN`, red when down | gateway-sync 07 `broker.subscriber` |
| Card "Accepted" with "Last {n} min" | gateway-sync 07 `ingestion.accepted`, `ingestion.windowMinutes` |
| Card "Duplicates rejected" | gateway-sync 07 `ingestion.duplicates` |
| Card "Malformed", "Not decodable, audited raw"; attention tone above 0 | gateway-sync 07 `ingestion.malformed` |
| Card "Normalization failed"; attention tone above 0 | gateway-sync 07 `ingestion.normalizationFailed` |
| Card "Unattributed", "Stored with no organization, not in Accepted" | gateway-sync 07 `ingestion.acceptedUnattributed` |
| Card "Unknown device"; attention tone above 0 | gateway-sync 07 `ingestion.unknownDevice` |
| Field Stations table: station, organization, connection badge, last sync, last flush, queue depth P0 to P3 | gateway-sync 07 `fieldStations[]` |
| Recent field events: received, device, kind, ingress, attribution (first 20, newest first) | gateway-sync 03 `items[]` with `order: "desc"` |
| Sync audit: time, outcome badge, device, uplink, ingress, detail | gateway-sync 04 `items[].createdAt`, `outcome`, `assetTag`, `uplinkKey`, `ingress`, `detail` |
| Sync audit device: the asset tag, else the node id `!xxxxxxxx` of an unregistered node, else "Not decoded" | gateway-sync 04 `assetTag`, `nodeNum` |
| Sync audit raw payload of a malformed record, one line in monospace with the whole excerpt on hover, and "Raw payload cut by the server." when cut | gateway-sync 04 `rawExcerpt`, `rawTruncated` |
| Sync audit range "1 to 20 of 45" and pages | gateway-sync 04 `pageNumber`, `pageSize`, `totalCount`, `totalPages` |

Outcome labels: Accepted, "Accepted, unattributed", Duplicate rejected, Malformed, Normalization failed,
Unknown device, "Not rented to the station organization", Invalid position, Implausible position, Queue
report. Each badge is text with a glyph, never colour alone.

## Actions

| Control | Endpoint | Confirmation | Success message |
|---|---|---|---|
| Window select: 15, 60 or 240 minutes, applied on selection | gateway-sync 07 with `windowMinutes` | none | none |
| Refresh | gateway-sync 07, 03 and 04 again | none | none |
| Sync audit outcome filter: "Every outcome" or one outcome; back to page 1 | gateway-sync 04 with `outcome: [value]` | none | none |
| Sync audit pages: previous, numbered, next | gateway-sync 04 with `pageNumber`, `pageSize` 20 | none | none |

Read-only. The replay of a quarantined `UNKNOWN_DEVICE` record (api-design 05) is not on this page yet.

## States

| State | What the user sees |
|---|---|
| Loading | "Loading sync status…", "Loading recent events…" and the audit table skeleton; each part loads on its own |
| Empty | Zeros on the cards; "No Field Stations are registered yet."; "No field events have been ingested yet."; the audit reads "No ingestion attempts yet." or, with a filter, "No audit records with this outcome." with "Choose Every outcome to see the whole audit." |
| Error `VALIDATION_FAILED` (400) | Error panel with the server message and Retry, per part |
| Error `UNAUTHENTICATED` (401) | One silent refresh, then `/sign-in` |
| Not found or forbidden (403) | MSG26 for an organization role (the route guard); a Staff account without `read FieldStation` sees the status part's error panel and still the two lists |
| Paging | The previous audit page stays on screen while the next loads |
| Success | Cards, the station table, the event list and the audit list; every part polls every 30 seconds |

## Form fields (if any)

Two selects, not a form: the window (15, 60 or 240, default 60, within api-design 07's 1 to 1440) and
the audit outcome (empty for every outcome, or one `SyncOutcome`).

## Mobile, accessibility, live data

- 360 px layout: the cards stack in one column; the audit list becomes one card per record (outcome
  badge and time, device and ingress, detail and raw excerpt); the uplink and ingress columns hide below
  the md breakpoint.
- The audit table has the caption "Sync audit records, newest first"; the outcome filter has the label
  "Outcome" for screen readers; the page range is announced politely.
- Live data: no WebSocket event; polling every 30 seconds while the tab is visible. Query keys
  `['sync-status', windowMinutes]`, `['sync-status', 'recent-events']` and
  `['sync-status', 'audit', outcome or 'all', pageNumber]`; Refresh invalidates `['sync-status', 'audit']`.

## Checklist

- [x] Route and roles match `design.md` §2 and the permission matrix
- [x] Data: every figure and column names its gateway-sync api-design property
- [x] Actions: read-only, filter and paging named
- [x] States: loading, empty, filtered empty, 400, 401, 403, paging, success
- [x] Forms: two selects
- [x] Mobile: collapse rule stated
- [x] Accessibility: table caption, labelled filter, text badges
- [x] Live data: polling and query keys stated
- [x] Traceability: UC-26, UC-42, FR-EVT-05, FR-EVT-11, FR-EVT-17, US-UC42
- [ ] Wireframe image

## Shared tables and sorting (W29, 2026-11-01)

Added by KhoaDD under D-078 to apply `0-ui-standard.md` §2. The Field Stations table and the recent
field events ledger are the shared `DataTable`. The ledger's Received column sorts through
gateway-sync api-design 03 `order` (`desc` by default, `asc` on the second press), the only order
that API takes, so no other column sorts; the ledger now pages through the same answer with
Pagination and keeps the current rows on screen while a new order or page loads.
