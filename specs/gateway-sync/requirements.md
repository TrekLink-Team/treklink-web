# Requirements Specification: gateway-sync (field data to the cloud, exactly once)

**User Story**: As an **organization running groups where phones have no signal**, I want every SOS, position and telemetry packet my rented devices send to reach the platform exactly once and SOS first, even after hours offline, so that nothing that happened in the field is lost or counted twice.
**Story ID**: assigned when the backlog is regenerated | **Priority**: Highest | **Milestone**: MF-02

> **Authority**: Report 3 SRS (2026-10-04) UC-26 to UC-28, UC-42, FR-EVT-01 to FR-EVT-14, FR-DEV-06, FR-MON-04, BR-11, BR-12, NFR-REL-01 to NFR-REL-06, NFR-IF-01, NFR-PERF-02, E02-1 to E02-6; D-005, D-006 (`eventId`), D-007 (envelope and strategies), D-018 (stages), D-027 (operation endpoint), D-033 item 8 (Field Station), D-037 (credentials), D-038 (no device-side cancel). Firmware facts: `04-firmware-ground-truth.md`. Rewritten 2026-10-04 (D-036).

---

## 1. Domain Context & Scope

- **In-Scope**: the MQTT ingress adapters for Stage A, B and C topics; the canonical envelope and
  per-type strategies; `eventId` derivation and deduplication; persistence of field events with the
  renting organization; the device projection call; correlation hand-off to `incidents`; the sync audit;
  Stage B queue reports; Field Station health; the broker authentication hooks; the Field Station
  executable (queue, flush, local page) in `treklink-web/gateway/`.
- **Out-of-Scope**: incident rules (`incidents`); the live map and API stream (`monitoring`, fed by this
  module's events); the firmware's own queue (`treklink-firmware/specs/onboard-queue/`).
- **Depends on**: `platform`, `organizations` (station credentials), `devices`, `rentals` (renting
  organization), `incidents`. Provides `MQTT_HEALTH_PROBE`.

### Traceability

| This spec | SRS |
|---|---|
| Ingestion, dedup, audit | UC-26, FR-EVT-01, FR-EVT-05, FR-EVT-09 to FR-EVT-11, BR-11, NFR-REL-03, NFR-REL-06 |
| Field Station queue and flush | UC-27, FR-EVT-02 to FR-EVT-04, FR-EVT-06 to FR-EVT-08, BR-12, NFR-REL-02, NFR-REL-04, NFR-REL-05 |
| Local page | UC-28, FR-EVT-12, NFR-UI-04 |
| Health | UC-42, FR-EVT-13, NFR-IF-01 |
| Credentials at the broker | FR-EVT-14, D-037 |
| Positions | FR-DEV-06, FR-MON-04 |

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL derive `eventId = sha256(from + ":" + id)` in lower-case hex for every field packet and SHALL persist a field event at most once per `eventId`, under the database's unique index, in the same transaction as its projection and correlation. [FR-EVT-01, BR-11, D-006]
- **REQ-UBI-02**: The system SHALL write one append-only sync audit row per ingestion attempt, accepted or not, with its outcome. [FR-EVT-11]
- **REQ-UBI-03**: The system SHALL record on each field event the organization renting the device at ingestion, or none, so that history can be clipped to rental periods. [FR-MON-07]
- **REQ-UBI-04**: The system SHALL order and compare events by queue sequence and priority, never by wall-clock comparison across hosts, and SHALL store a device `rx_time` of 0 as unknown. [FR-EVT-08, E02-6]
- **REQ-UBI-05**: The system SHALL accept the stock Meshtastic JSON topics through adapters that produce one canonical envelope, and SHALL keep the stock payload shapes untouched (D-019). [FR-EVT-10, NFR-IF-02]

### Event-Driven

- **REQ-EVT-01**: WHEN a message arrives on `treklink/2/json/+/+` or `treklink/fs/+/2/json/+/+`, the system SHALL validate the envelope, resolve `from` to a device by `nodeNum`, classify it, and ingest it per [mqtt-ingress-contract.md](api-design/mqtt-ingress-contract.md). [UC-26]
- **REQ-EVT-02**: WHEN a text payload is classified, the system SHALL test the `SOS - FALL DETECTED` prefix before `SOS - ` and SHALL classify both as P0 SOS. [FR-EVT-09]
- **REQ-EVT-03**: WHEN an SOS or fall SOS is accepted, the system SHALL call `incidents` inside the ingestion transaction; WHEN a position is accepted, it SHALL call `incidents` for episode tagging and cadence. [FR-INC-01, FR-INC-02]
- **REQ-EVT-04**: WHEN a position or telemetry is accepted, the system SHALL call `devices.projectReading`; WHEN a position lies outside `monitoring.positionBounds` or WGS-84, the event SHALL be kept with no position (`INVALID_POSITION`); WHEN it implies a speed above `monitoring.maxPlausibleSpeedKmh` from the last plotted position, it SHALL be kept with `plotted = false` and not projected (`IMPLAUSIBLE_POSITION`). [FR-DEV-06, FR-MON-04]
- **REQ-EVT-05**: WHEN a message arrives on a Field Station topic, the system SHALL resolve the station by the username in the topic, refuse it if the credential is revoked, and accept the event only when the device is on a running contract of the station's organization (`NOT_RENTED_TO_STATION_ORG` otherwise). [FR-EVT-14]
- **REQ-EVT-06**: WHEN an event is accepted, the system SHALL emit `field.position` or `field.telemetry` after commit for `monitoring`. [FR-MON-02]
- **REQ-EVT-07**: WHEN the broker's go-auth hook asks, the system SHALL answer 200 for a valid credential or topic and 403 otherwise, behind `MQTT_AUTH_HOOK_SECRET`. [FR-EVT-14]
- **REQ-EVT-08**: WHEN a Field Station reports its health on `treklink/fs/<username>/health`, the system SHALL record its queue depth per tier, oldest retry count and last sync time through `organizations`. [FR-EVT-13]
- **REQ-EVT-09**: WHEN an Admin replays a quarantined `UNKNOWN_DEVICE` audit row, the system SHALL re-run ingestion on its stored raw message and write a new audit row. [UC-26]
- **REQ-EVT-12**: WHEN a `treklink_queue_health` report arrives, the system SHALL store a `DeviceQueueReport` and SHALL NOT create a field event or reach correlation. [NFR-IF-01]
- **REQ-EVT-13**: WHEN the latest queue report of a device has a non-zero total depth, the system SHALL report the device as buffering on the system-health page. [UC-42]
- **REQ-EVT-14**: WHEN a queue report's counter is lower than the previous report's, the system SHALL flag `rebootDetected` and SHALL NOT treat the difference as negative traffic. [NFR-REL-05]

### State-Driven (Field Station, Stage C)

- **REQ-STA-01**: WHILE the Field Station has an event to send, it SHALL have persisted it in SQLite before any network attempt. [FR-EVT-02]
- **REQ-STA-02**: WHILE the uplink is down, the Field Station SHALL keep queuing, and SHALL keep serving its local page. [FR-EVT-12, NFR-UI-04]
- **REQ-STA-03**: WHILE the queue is at its bound, the Field Station SHALL shed P3 first and never P0, logging each shed event. [FR-EVT-06, E02-5]

### Unwanted Behaviour

- **REQ-ERR-01**: IF a payload cannot be decoded, THEN the system SHALL audit it raw (`MALFORMED_ENVELOPE`), drop it and continue without blocking. [FR-EVT-05, E02-4]
- **REQ-ERR-02**: IF an `eventId` is already stored, THEN the system SHALL audit `DUPLICATE_REJECTED` and change nothing else. [E02-2]
- **REQ-ERR-03**: IF the uplink drops mid-flush, THEN the Field Station SHALL mark flushed only what the broker acknowledged and resume from the queue head. [FR-EVT-04, E02-1]
- **REQ-ERR-04**: IF the Field Station restarts, THEN every queued event SHALL survive with its original `from` and `id`. [FR-EVT-07, E02-3]
- **REQ-ERR-05**: IF a type strategy throws, THEN the system SHALL audit `NORMALIZATION_FAILED` for that packet only. [UC-26]

---

## 3. Non-Functional Requirements

| Property | Target | Source |
|---|---|---|
| Delivery latency | Field Station to cloud ≤5 s with the uplink up | NFR-REL-01 |
| Delivery after outage | ≥99 % of events generated during a 30 s to 30 min outage, ≥20 trials per condition | NFR-REL-02 |
| Duplicates | 10× replay ⇒ 0 duplicate events, incidents or alerts | NFR-REL-03, TC-11 |
| Ordering | ≥99 % P0 before any P2 or P3 on flush | NFR-REL-04, TC-12 |
| Concurrency | ≥20 simultaneous Field Station submissions, 0 loss, 0 duplication | NFR-PERF-02 |

---

## 4. Configuration

The `gateway-sync` section of the [Configuration Matrix](../platform/configuration-matrix.md), plus the
position rules owned by `monitoring`. Environment: `MQTT_BROKER_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`
(subscribe-only), `MQTT_ROOT` (default `treklink`), `MQTT_AUTH_HOOK_SECRET`. Field Station: its local
configuration file (`field-station-local-page.md`).

---

## 5. Acceptance Criteria

- **AC-01**: The same packet delivered by a node uplink and a Field Station is stored once. (BR-11)
- **AC-02**: A 10× replay of a recorded SOS episode yields one incident and the same event count. (TC-11)
- **AC-03**: 30 minutes offline with 200 queued events: on reconnect every P0 arrives before any P2 or P3. (TC-12)
- **AC-04**: A Field Station of organization A publishing for a device rented to B is audited `NOT_RENTED_TO_STATION_ORG`.
- **AC-05**: A malformed JSON message is audited and the next message is ingested. (E02-4)

---

## 6. Open Questions

None. The SOS cancel text is not consumed (D-038).
