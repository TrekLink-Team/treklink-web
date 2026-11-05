# Requirements Specification: monitoring (live map, organization API, history and reports)

**User Story**: As an **Org Operator**, I want a live map of my organization's rented devices and incidents that keeps working through reconnects, and as an **organization's own system**, I want the same stream through an API key; as **TrekLink Staff and Admin**, I want the whole fleet, device histories, reports and the system's health.
**Story ID**: the Stories row of `tasks.md` (backlog D-051) | **Priority**: High | **Milestone**: MF-04

> **Authority**: Report 3 SRS (2026-10-14; traceability checked 2026-10-19) UC-38 to UC-42, UC-53 (history), UC-59, FR-MON-01 to FR-MON-10, FR-AUTH-11, FR-DEV-11, FR-BILL-10, FR-CFG-03, FR-EVT-13, FR-INC-13, BR-19, BR-21, BR-22, BR-30, NFR-LEG-01, NFR-LEG-04, E04-1 to E04-7, MSG32, MSG33; D-031 (Leaflet, OpenStreetMap, sovereignty overlay); D-092 rule 2 (every contracted unit on the organization's map, amended 2026-11-01; the same states and custody clipping on the organization API, leader ruling of 2026-11-01). Rewritten 2026-10-04 (D-036). This module is the read model: the only one allowed to import every other (`platform` design §2.1); Report 3 register v2 of 2026-10-29 UC-66, FR-CON-16, FR-MON-11, BR-46 (the rented-device console and the group filters, BM04 F-11 and F-21, treklink-web#305).

---

## 1. Domain Context & Scope

- **In-Scope**: the organization-scoped stream (`StreamEvent`) and its WebSocket and REST replay; the map
  snapshot and map configuration; the staleness sweep for devices and Field Stations; history clipped to
  rental periods; the organization API (devices, stream); device history (FR-DEV-11); reports
  (FR-BILL-10); system health (FR-MON-10).
- **Out-of-Scope**: decoding and storing events (`gateway-sync`); incident state (`incidents`); tile
  serving (the basemap tile servers of `monitoring.mapBasemaps`, from the browser).
- **Depends on**: every module. Listens to the domain events of `platform` design §2.3.

### Traceability

| This spec | SRS |
|---|---|
| Live map | UC-38, FR-MON-01 to FR-MON-05, FR-MON-09, FR-CFG-03, BR-30, D-092 rule 2 |
| Organization API | UC-39, FR-MON-05, FR-MON-06, BR-20, D-040, D-092 rule 2 |
| History | UC-40, FR-MON-07 |
| Staleness | UC-41, FR-MON-03, FR-INC-13, BR-21 |
| Health, reports, device history | UC-42, UC-59, UC-53, FR-MON-10, FR-EVT-13, FR-BILL-10, FR-DEV-11 |
| Check-in cut-off | UC-43, FR-MON-08, E04-7 |
| Rented-device console, group filters | UC-66, FR-CON-16, FR-MON-11, BR-46 |

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL write every live update to the append-only stream with its organization: for a field event, the organization it is attributed to; for an incident, the routed organization; for a `device.*` event, the current holder. It SHALL deliver each entry only to that organization's members and keys and to TrekLink staff, enforced on the server; an entry with no organization, including every `UNATTRIBUTED` event, goes to the fleet room only. [FR-MON-02, FR-MON-06, FR-AUTH-11, BR-19, BR-36]
- **REQ-UBI-02**: The system SHALL serve the basemaps (tile URL, attribution and zoom limits of each), the default basemap, the viewport and the sovereignty overlay from configuration, and the client SHALL render the overlay over Hoàng Sa and Trường Sa on every map and every basemap, on an opaque mask that hides the basemap's own labels for both archipelagos. [FR-MON-01, FR-CFG-03, BR-30, NFR-LEG-01, D-072, D-085]
- **REQ-UBI-03**: The system SHALL never plot a position marked not plotted. [FR-MON-04, BR-22]
- **REQ-UBI-04**: The map snapshot SHALL list every unit of the scope's open contracts from its handover until its check-in or confirmed loss, reporting or not, each with a `state`: `LIVE` when it was heard during its custody interval and within `monitoring.deviceStaleSeconds`, `OFFLINE` when it was heard during its custody interval and has been silent longer, and `NOT_HEARD` when nothing was heard from it since the handover. For an organization's view, the last position and the last-seen time SHALL lie inside the organization's custody interval or be null, so no position, reading time or battery reading from before the handover is sent (D-040); a `NOT_HEARD` unit carries the TrekLink counter location of `monitoring.counterLocation`, the last place it was known to be. TrekLink staff keep the device's last position and last-seen time whatever the interval, with the same states. The organization API's device list (api-design 04) SHALL give each unit the same `state` and the same clipped position, last-seen time and battery as the organization's map snapshot at the same time, and no stream entry delivered to an organization SHALL carry a reading time from before its custody interval. [FR-MON-02, FR-MON-03, FR-MON-06, BR-21, D-040, D-092 rule 2]
- **REQ-UBI-05**: Every unit of an organization's map snapshot, organization API device list and console row SHALL carry its group (`id`, `name`, `parentId`, or null) and its holder label, read from `rentals` in the same request; the snapshot and the console SHALL accept a `groupId` filter that includes the group's subgroups. A group never changes the organization's channel or what its members may see. [FR-MON-11, BR-46]
- **REQ-UBI-06**: The web client SHALL draw every device marker at its reading and never offset it (leader ruling 2026-11-06, superseding the W14c ring spread). Below zoom 14, markers whose targets sit within 48 px of each other SHALL draw as one cluster badge at the centroid of their readings, with the device count, coloured by the most severe state inside (SOS, then the other incident states, then not heard since handover, then offline, then live), named by the count, each state that is not live and the place ("12 devices, 1 SOS, near 11.5601, 108.5402"), with a 44 px target; activating it SHALL zoom in to its members' bounds, or list them WHEN the map is at its maximum zoom or they share one spot. From zoom 14, markers whose 24 px targets overlap SHALL stay stacked at their readings, the most severe on top, and activating any of them SHALL list every device of the stack with its popup content. [FR-MON-01, NFR-UI-01, WCAG 2.2 2.5.8]
- **REQ-UBI-07**: For TrekLink callers only, the map snapshot SHALL carry each unit's open dock session (`docked`) and list a docked unit outside any custody interval with state `DOCKED` at `monitoring.counterLocation`, and the `device.docked` and `device.undocked` stream entries SHALL go to the `fleet` room only; an organization caller, room or API key SHALL never see either (devices design §12.8, REQ-STA-05, REQ-EVT-37). [FR-MON-02, FR-AUTH-11, D-092 rule 2]

### Event-Driven

- **REQ-EVT-01**: WHEN `field.position`, `field.telemetry`, `incident.changed`, `device.labelChanged`, `device.handedOver` or `device.checkedIn` is received, the system SHALL append a stream entry and push it to the matching rooms, throttling positions per device to `monitoring.positionEmitMinIntervalMs`. [FR-MON-02]
- **REQ-EVT-02**: WHEN a client connects or reconnects with a cursor, the system SHALL replay every entry after it for the client's rooms, then `replay.done`, then live entries; WHEN the cursor is older than `monitoring.streamRetentionHours`, it SHALL answer `replay.expired` (REST: 410). [FR-MON-05, E04-3]
- **REQ-EVT-03**: WHEN the sweep finds a device silent beyond `monitoring.deviceStaleSeconds` or a Field Station beyond `monitoring.fieldStationStaleSeconds`, the system SHALL emit a stale entry with the last-seen time, tell `incidents` for a device with an open incident, and emit the recovery when it is heard again. [FR-MON-03, FR-INC-13, E04-1, E04-2]
- **REQ-EVT-04**: WHEN a device is checked in, the system SHALL emit `device.released` to the organization and SHALL send that organization nothing more about the device that occurred after the check-in; a late event attributed to its custody interval SHALL still reach it, flagged late and kept off the live map. [FR-MON-08, E04-7, E02-7]
- **REQ-EVT-05**: WHEN an API key requests the organization API, the system SHALL authenticate it, apply `monitoring.apiRateLimitPerMinute` per key (429 beyond), and serve only the key's organization. [FR-MON-06, E04-5]
- **REQ-EVT-06**: WHEN history is requested for a device, the system SHALL serve only the events attributed to the caller's organization, which lie inside the periods it rented the device (handover to check-in), or serve it whole, `UNATTRIBUTED` events included, to TrekLink staff. [FR-MON-07, BR-36]
- **REQ-EVT-07**: WHEN `incidents` emits `incident.alert`, the system SHALL publish it to the recipient's personal room synchronously. [FR-INC-12]
- **REQ-EVT-08**: WHEN an API key is revoked, the system SHALL close its open sockets. [FR-ORG-06]
- **REQ-EVT-09**: WHEN an Org Manager opens the rented-device console, the system SHALL list every device the organization holds now across its contracts, one row per device on the contract holding it (rentals `visibleDevices`), with the hardware variant, asset tag, contract code and plan, the unit `state` and the clipped battery and last-seen time of REQ-UBI-04, the group and the holder label, and whether a fault report or a loss case is open; filterable by contract, group (a top-level group includes its subgroups, and `none` keeps the devices in no group) and `state`; paged. A member of another organization, or an Org Operator, gets 403 (Report 3 RBAC: the console is the Manager's). [FR-CON-16, FR-MON-11, UC-66, BR-19, D-040]

### State-Driven

- **REQ-STA-01**: WHILE the WebSocket is reconnecting, the web client SHALL show MSG32 and keep the last known positions. [FR-MON-05]
- **REQ-STA-02**: WHILE the map provider is unreachable, the web client SHALL show MSG33 and keep the device and incident panels live. [FR-MON-09]

### Unwanted Behaviour

- **REQ-ERR-01**: IF a member or key asks for another organization's device, history or stream, THEN the system SHALL answer 404 and send nothing. [E04-4]
- **REQ-ERR-02**: IF a history range exceeds 7 days or is reversed, THEN the system SHALL return 400.

---

## 3. Non-Functional Requirements

| Property | Target | Source |
|---|---|---|
| Push latency | position on the map ≤2 s after ingestion commits | NFR-PERF-04 |
| Scale | 10 organizations, 50 rented devices, without architectural change | NFR-PERF-03 |
| Map attribution | OpenStreetMap contributors shown; tile policy respected (named User-Agent, no bulk prefetch) | NFR-LEG-04, D-031 |

---

## 4. Configuration

The `monitoring` section of the [Configuration Matrix](../platform/configuration-matrix.md).

---

## 5. Acceptance Criteria

- **AC-01**: An operator of A never receives a stream entry of B's device, including after the device moves from A's contract to B's. (TC-19)
- **AC-02**: A client disconnected for 2 minutes reconnects with its cursor and receives every missed entry once, in order.
- **AC-03**: A device silent past the threshold turns stale on the map with its last-seen time. (TC-21)
- **AC-04**: A position 50 km from the last one 10 s earlier is not plotted. (TC-22)
- **AC-05**: After check-in, the organization's map and API stop showing the device. (E04-7)
- **AC-06**: A position from A's custody that synchronizes after the device was handed to B reaches A's stream and history flagged late, and never B's room or API. (E02-7, TC-36)
- **AC-07**: The map shows the Vietnamese labels over Hoàng Sa and Trường Sa. (TC-30)
- **AC-08**: An organization holds a contract of 5 units where 2 report, 1 reported and went silent past the threshold and 2 never reported since the handover: its snapshot lists all 5, 2 `LIVE`, 1 `OFFLINE` with its last position and last-seen time, and 2 `NOT_HEARD` at the counter location with no position, even when those 2 reported before the handover. Its organization API (api-design 04) answers the same `state`, `position`, `lastSeenAt` and `batteryPct` for each of the 5. (D-092 rule 2, D-040)
- **AC-09**: A Manager whose organization holds 7 units on two contracts, 3 of them in group A and 1 in its subgroup A1, opens the console: 7 rows; filtered by A: 4 rows; by A1: 1 row; a unit checked in disappears from the console and from A's count. (BM04 TC-F21-01 and TC-F21-02, FR-CON-16, FR-MON-11; the console's `state`, battery and last seen use the custody clipping of REQ-UBI-04)
- **AC-10**: The organization's map snapshot filtered by group A returns only A's and A1's units, each with its group and holder; the fleet view of TrekLink Staff is unchanged. (F-11, FR-MON-11)
- **AC-11**: With TL-0051 docked at the counter and `RESERVED` (not handed over), the Staff fleet snapshot lists it `DOCKED` at the counter location with `docked.since`, the organization's snapshot of the same contract does not list it, and a `device.docked` entry reaches the `fleet` room and no `org:` room. (devices AC-34)

---

## 6. Open Questions

None.
