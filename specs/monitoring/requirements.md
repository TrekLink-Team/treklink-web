# Requirements Specification: monitoring

**User Story**: As **Staff and Admin**, I want one live operational picture of every active trip, device and incident, and as a **Guide**, I want the same picture for my own trip only, so that a silent device, an offline gateway or a new SOS is visible within seconds and never mistaken for a quiet trail.
**Story IDs**: US-038, US-053, US-055, US-056, US-058, US-065, US-066 (E5) | **Priority**: High | **Main Flow**: **MF-04** (specified for Review 2, built after MF-03) | **Lanes**: TanNB (Socket.io gateway, read API, `TK-61`, `TK-46`), LongNN (map and monitoring UI, `TK-63`, `TK-64`, `TK-73`), per D-023

> **Authority**: D-012 (Goong over MapLibre, provider in configuration), D-015, D-016, D-023. MF-04 states the rule this module exists for: **role scoping is enforced server-side at the WebSocket emit**; filtering in the browser is not access control (E04-5). The map itself is a frontend concern (`specs/frontend/`); this module supplies the data feed.

---

## 1. Domain Context & Scope

- **In-Scope**:
  - A Socket.io namespace that authenticates with the access token and joins each socket to rooms computed server-side from role and Guide trip scope
  - Fan-out of domain events from `gateway-sync`, `devices`, `incidents` and `trips` to the right rooms
  - Device connectivity states `LIVE`, `STALE`, `BUFFERING`, `NEVER_SEEN` and gateway states `LIVE`, `STALE`, emitted on transition (E04-1, E04-2)
  - A snapshot endpoint for first load and for resynchronisation after a reconnect (E04-3, E03-7)
  - A position-trail read scoped like the live feed
  - Ownership of the thresholds that decide what is plotted: staleness, plausibility speed, battery warning levels (MF-04 configurable parameters)
- **Out-of-Scope**:
  - Rendering the map, markers and tiles: `specs/frontend/` (D-012)
  - Persisting positions or telemetry: `gateway-sync` owns `GatewayEvent`; `devices` owns the projection
  - Incident state: `incidents`
  - Horizontal scaling of Socket.io across several backend instances (single instance at this scale; a Redis adapter is the documented upgrade path)
- **Depends on**: `platform`, `auth`, `devices`, `trips`, `incidents`, `gateway-sync`.

### Traceability

| Group | MF | UC | FR | BR | Exception | Story |
|---|---|---|---|---|---|---|
| Live feed | MF-04 | UC-14 | FR-MON-01 (new) | | | US-053, US-056 |
| Server-side role scope | MF-04 | UC-14 | FR-MON-02 (new), FR-AUTH-03 | BR-13 | E04-5 | US-038 |
| Stale devices | MF-04 | UC-14 | FR-MON-03 | BR-15 | E04-1 | US-056 |
| Gateway connectivity | MF-04 | UC-14 | FR-MON-04 (new) | BR-15 | E04-2 | US-065 |
| Position plausibility | MF-04 | | FR-MON-05 | BR-16 | E04-4 | none |
| Reconnect and resync | MF-04, MF-03 | UC-14 | FR-MON-06 (new) | | E04-3, E03-7 | US-058 |
| Incident alerts | MF-03, MF-04 | UC-23 | FR-INC-08 | | | US-058, US-066 |

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL decide every socket's room membership on the server from the verified access token, the user's roles and, for Guides, the trip scope from `trips`; no client-supplied room name SHALL be honoured. [BR-13, E04-5, NFR-SEC-03]
- **REQ-UBI-02**: The system SHALL emit an event about a device, incident or trip only to rooms entitled to it: the trip's room, the `operators` room and the `admins` room; an event for a device on no trip SHALL go only to `operators` and `admins`.
- **REQ-UBI-03**: The system SHALL carry a monotonically increasing `seq` per emitted message and the `eventTime` of the underlying event, so clients can detect gaps and order updates.
- **REQ-UBI-04**: The system SHALL read every threshold of §4 from the parameter store; none SHALL be a literal. [D-015]

### Event-Driven

- **REQ-EVT-01**: WHEN a socket connects with a valid access token, the system SHALL join it to its rooms and send `monitoring:ready` listing them. WHEN the token is missing or invalid, the system SHALL refuse the connection with `UNAUTHENTICATED`.
- **REQ-EVT-02**: WHEN `device.position.updated` or `device.telemetry.updated` is received, the system SHALL emit `device:position` or `device:telemetry` within 2 s of the source commit, throttled to at most one message per device per `monitoring.positionEmitMinIntervalMs`, always delivering the latest value. [US-058 NFR ≤2 s]
- **REQ-EVT-03**: WHEN any `incident.*` domain event is received, the system SHALL emit `incident:new`, `incident:updated` or `incident:escalated` without throttling. [US-058]
- **REQ-EVT-04**: WHEN a device's connectivity changes between `LIVE`, `STALE`, `BUFFERING` and `NEVER_SEEN`, the system SHALL emit `device:connectivity` once per transition, with `lastSeenAt`. [E04-1, BR-15]
- **REQ-EVT-05**: WHEN a gateway's `lastPacketAt` crosses `monitoring.gatewayStaleSeconds` in either direction, the system SHALL emit `gateway:health`. [E04-2]
- **REQ-EVT-06**: WHEN `trip.status.changed` or a Guide assignment change affects a connected Guide's scope, the system SHALL add or remove that Guide's sockets from trip rooms at once, and SHALL send `monitoring:scope-changed`.
- **REQ-EVT-07**: WHEN a client requests the snapshot, the system SHALL return, within the caller's scope, active trips, their devices with last position, battery, battery level, connectivity and last-seen time, open incidents, and gateway states, plus the current `seq`. [E04-3, E03-7]
- **REQ-EVT-08**: WHEN a socket's access token expires, the system SHALL disconnect it with reason `TOKEN_EXPIRED`, so the client refreshes and reconnects rather than keeping a session past its authority.

### State-Driven

- **REQ-STA-01**: WHILE a device's `now - lastSeenAt` exceeds `monitoring.deviceStaleSeconds` and it is not buffering, the system SHALL report it `STALE` with its last-seen time; its last position SHALL remain available but marked stale, never presented as current. [E04-1, NFR-USE-05]
- **REQ-STA-02**: WHILE a device's latest queue-health report shows a non-zero depth, the system SHALL report it `BUFFERING` rather than `STALE`. [`gateway-sync` REQ-EVT-13]
- **REQ-STA-03**: WHILE a device's battery is below `monitoring.batteryCriticalPct` or `monitoring.batteryWarningPct`, reads and events SHALL carry `batteryLevel` `CRITICAL` or `WARNING`.

### Unwanted Behaviour

- **REQ-ERR-01**: IF a Guide requests a snapshot or trail for a trip or device outside their scope, THEN the system SHALL return 404 and the data SHALL never be sent to the client. [E04-5]
- **REQ-ERR-02**: IF a position is out of WGS-84 range or implies a speed above `monitoring.maxPlausibleSpeedKmh`, THEN it SHALL never be emitted or plotted; `gateway-sync` rejects it before projection (REQ-ERR-09, REQ-ERR-11 there) and this module applies the same check to the snapshot and trail reads. [E04-4, BR-16]
- **REQ-ERR-03**: IF the emit of one event fails, THEN the system SHALL log it and continue; clients recover through the snapshot when they detect a `seq` gap. [E03-7]

---

## 3. Non-Functional Requirements

| Property | Target | Source |
|---|---|---|
| Commit to socket | ≤2 s | US-058, `gateway-sync` NFR table |
| Gateway to dashboard | within the ≤5 s sync target plus the above | charter §5, MF-04 postcondition |
| Fleet scale | ≥50 devices, several trips, one instance | NFR-PERF-03 |
| Scope | 0 events for trip B delivered to a Guide of trip A, verified by a test that listens on the Guide's socket | E04-5 |

---

## 4. Configuration Matrix entries

| Parameter | Default | Location | Admin-editable | Source |
|---|---|---|---|---|
| `monitoring.deviceStaleSeconds` | 120 | DB | yes | MF-04 names it; value proposed (4 missed 30 s beacons) |
| `monitoring.gatewayStaleSeconds` | 120 | DB | yes | proposal |
| `monitoring.maxPlausibleSpeedKmh` | 30 | DB | yes | proposal (on foot, generous) |
| `monitoring.batteryWarningPct` | 30 | DB | yes | proposal |
| `monitoring.batteryCriticalPct` | 15 | DB | yes | proposal |
| `monitoring.positionEmitMinIntervalMs` | 1000 | DB | yes | proposal |
| `monitoring.staleSweepSeconds` | 15 | DB | yes | proposal |

Map provider, style URL, key and viewport are frontend configuration (`specs/frontend/`, D-012).

---

## 5. Acceptance Criteria

- **AC-01**: A Guide of trip A connected to the socket receives no message about trip B while trip B's devices report; the test listens on the socket and asserts silence.
- **AC-02**: A device silent for `deviceStaleSeconds` produces one `device:connectivity STALE` event and shows `STALE` in the snapshot with its last-seen time.
- **AC-03**: A device sending a queue-health report with depth above zero shows `BUFFERING`, not `STALE`.
- **AC-04**: A gateway silent for `gatewayStaleSeconds` produces `gateway:health STALE`.
- **AC-05**: A client that disconnects for 60 s, reconnects and calls the snapshot ends with the same state as a client that stayed connected (the `seq` gap is closed by the snapshot).
- **AC-06**: A position 50 km from the previous one five seconds later is never emitted.
- **AC-07**: Unassigning a Guide from trip A removes their socket from A's room without a reconnect.
- **AC-08**: Changing `monitoring.deviceStaleSeconds` from 120 to 60 changes when the next device turns stale (D-015 demo).

---

## 6. Open Questions

Carried into QUESTION entry C-003: default thresholds, whether Admin sessions receive every position update or only a coarser feed, and whether the Guide view includes other trips' SOS alerts nearby (proposed: no, scope is strict).
