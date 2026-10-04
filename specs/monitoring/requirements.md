# Requirements Specification: monitoring (live map, organization API, history and reports)

**User Story**: As an **Org Operator**, I want a live map of my organization's rented devices and incidents that keeps working through reconnects, and as an **organization's own system**, I want the same stream through an API key; as **TrekLink Staff and Admin**, I want the whole fleet, device histories, reports and the system's health.
**Story ID**: assigned when the backlog is regenerated | **Priority**: High | **Milestone**: MF-04

> **Authority**: Report 3 SRS (2026-10-04) UC-38 to UC-42, UC-53 (history), UC-59, FR-MON-01 to FR-MON-10, FR-AUTH-11, FR-DEV-11, FR-BILL-10, FR-CFG-03, FR-EVT-13, FR-INC-13, BR-19, BR-21, BR-22, BR-30, NFR-LEG-01, NFR-LEG-04, E04-1 to E04-7, MSG32, MSG33; D-031 (Leaflet, OpenStreetMap, sovereignty overlay). Rewritten 2026-10-04 (D-036). This module is the read model: the only one allowed to import every other (`platform` design §2.1).

---

## 1. Domain Context & Scope

- **In-Scope**: the organization-scoped stream (`StreamEvent`) and its WebSocket and REST replay; the map
  snapshot and map configuration; the staleness sweep for devices and Field Stations; history clipped to
  rental periods; the organization API (devices, stream); device history (FR-DEV-11); reports
  (FR-BILL-10); system health (FR-MON-10).
- **Out-of-Scope**: decoding and storing events (`gateway-sync`); incident state (`incidents`); tile
  serving (OpenStreetMap, from the browser).
- **Depends on**: every module. Listens to the domain events of `platform` design §2.3.

### Traceability

| This spec | SRS |
|---|---|
| Live map | UC-38, FR-MON-01 to FR-MON-05, FR-MON-09, FR-CFG-03, BR-30 |
| Organization API | UC-39, FR-MON-05, FR-MON-06, BR-20 |
| History | UC-40, FR-MON-07 |
| Staleness | UC-41, FR-MON-03, FR-INC-13, BR-21 |
| Health, reports, device history | UC-42, UC-59, UC-53, FR-MON-10, FR-EVT-13, FR-BILL-10, FR-DEV-11 |
| Check-in cut-off | UC-43, FR-MON-08, E04-7 |

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL write every live update to the append-only stream with the organization renting the device at that moment, and SHALL deliver it only to that organization's members and keys and to TrekLink staff, enforced on the server. [FR-MON-02, FR-AUTH-11, BR-19]
- **REQ-UBI-02**: The system SHALL serve the map provider, tile URL, attribution, viewport and the sovereignty overlay from configuration, and the client SHALL render the overlay over Hoàng Sa and Trường Sa on every map. [FR-MON-01, FR-CFG-03, BR-30, NFR-LEG-01]
- **REQ-UBI-03**: The system SHALL never plot a position marked not plotted. [FR-MON-04, BR-22]

### Event-Driven

- **REQ-EVT-01**: WHEN `field.position`, `field.telemetry`, `incident.changed`, `device.labelChanged`, `device.handedOver` or `device.checkedIn` is received, the system SHALL append a stream entry and push it to the matching rooms, throttling positions per device to `monitoring.positionEmitMinIntervalMs`. [FR-MON-02]
- **REQ-EVT-02**: WHEN a client connects or reconnects with a cursor, the system SHALL replay every entry after it for the client's rooms, then `replay.done`, then live entries; WHEN the cursor is older than `monitoring.streamRetentionHours`, it SHALL answer `replay.expired` (REST: 410). [FR-MON-05, E04-3]
- **REQ-EVT-03**: WHEN the sweep finds a device silent beyond `monitoring.deviceStaleSeconds` or a Field Station beyond `monitoring.fieldStationStaleSeconds`, the system SHALL emit a stale entry with the last-seen time, tell `incidents` for a device with an open incident, and emit the recovery when it is heard again. [FR-MON-03, FR-INC-13, E04-1, E04-2]
- **REQ-EVT-04**: WHEN a device is checked in, the system SHALL emit `device.released` to the organization and SHALL send that organization nothing more about the device. [FR-MON-08, E04-7]
- **REQ-EVT-05**: WHEN an API key requests the organization API, the system SHALL authenticate it, apply `monitoring.apiRateLimitPerMinute` per key (429 beyond), and serve only the key's organization. [FR-MON-06, E04-5]
- **REQ-EVT-06**: WHEN history is requested for a device, the system SHALL clip it to the periods the caller's organization rented it (handover to check-in), or serve it whole to TrekLink staff. [FR-MON-07]
- **REQ-EVT-07**: WHEN `incidents` emits `incident.alert`, the system SHALL publish it to the recipient's personal room synchronously. [FR-INC-12]
- **REQ-EVT-08**: WHEN an API key is revoked, the system SHALL close its open sockets. [FR-ORG-06]

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
- **AC-06**: The map shows the Vietnamese labels over Hoàng Sa and Trường Sa. (TC-30)

---

## 6. Open Questions

None.
