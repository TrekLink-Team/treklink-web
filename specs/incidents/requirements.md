# Requirements Specification: incidents

**User Story**: As **Staff on duty**, I want every SOS episode from the field to become exactly one Incident that I can acknowledge in one step, work, resolve and close, with every action recorded; as a **Guide**, I want to be alerted to an SOS on my own trip, acknowledge it and file response notes from my phone; as the **team**, we want MTTA and MTTR measured from the record, so RQ3 is answered from data rather than recollection.
**Story IDs**: US-054, US-057 to US-064, US-066, US-072, US-088 (E5) | **Priority**: **Highest** | **Main Flow**: **MF-03** | **Lane**: HoangTK (`incidents`, MF-03 owner)

> **Authority**: D-006 (episode correlation is a lookup, not a hash), D-007, D-008, D-016, D-018. `04-firmware-ground-truth.md` §2: an SOS is announced by **one** unacknowledged text frame, beacons that follow are position-only, and **cancelling on the device transmits nothing** (`TrekLinkSOSHelper.cpp:57–61`), so only an operator ends an episode. No MF-03 clarification interview has been held; every open point is in QUESTION entry C-002.

---

## 1. Domain Context & Scope

- **In-Scope**:
  - The **Incident 5-state FSM** `DETECTED, ACKNOWLEDGED, IN_PROGRESS, RESOLVED, CLOSED`, with reopen (UC-26) and the lighter dismissal of a suspected episode (US-088) (charter §2, BR-10)
  - Episode correlation on behalf of `gateway-sync`: create, append, reopen, confidence upgrade, under a per-device lock (BR-08, BR-12, E03-2, E03-5, E03-6)
  - Suspected episodes raised from beacon cadence, visually and procedurally distinct (BR-09, E03-1)
  - Incidents with no active trip, flagged unassigned for triage (E03-4)
  - Manual incidents raised by Staff (US-064)
  - Acknowledgement by Staff or by a Guide of the trip, first write wins (E03-3)
  - Append-only audit trail with actor, role, time and note on every transition (BR-10, BR-11)
  - Response notes (UC-17)
  - Escalation when an Incident stays unacknowledged (MF-03 configurable auto-escalation)
  - MTTA and MTTR per Incident and in aggregate (RQ3, US-072)
- **Out-of-Scope**:
  - Delivering alerts to browsers: `incidents` emits domain events; `monitoring` fans them out over WebSocket
  - Contacting authorities or search-and-rescue; the platform is a coordination tool (NFR-LEG-04)
  - Parsing packets: `gateway-sync` produces `TrekLinkEvent`s and calls this module
- **Depends on**: `platform`, `auth`, `devices` (device lookup), `rentals` (which trip and rental a device is on, E03-4).

### Traceability

| Group | MF | UC | FR | BR | Exception | Story |
|---|---|---|---|---|---|---|
| One episode, one Incident | MF-03 | UC-13 | FR-EVT-05 | BR-08 | E03-2, E03-5 | US-057 |
| Suspected episode | MF-03 | UC-13 | FR-EVT-06 | BR-09 | E03-1 | US-088 |
| FSM and audit | MF-03 | UC-16 | FR-INC-02, FR-INC-04 | BR-10, BR-11 | | US-054, US-059 |
| Acknowledge | MF-03 | UC-15 | FR-INC-01 (new) | | E03-3 | US-060, US-063 |
| Update, resolve, close | MF-03 | UC-16 | FR-INC-02 | BR-10 | | US-061, US-062 |
| Reopen | MF-03 | UC-26 | FR-INC-06 | BR-12 | E03-6 | none |
| Response note | MF-03 | UC-17 | FR-INC-03 (new) | | | US-063 |
| Unassigned SOS | MF-03 | UC-13 | FR-INC-05 (new) | | E03-4 | none, gap (C-003) |
| Manual incident | MF-03 | UC-39 Raise Manual Incident (new) | FR-INC-07 (new) | | | US-064 |
| Notification | MF-03 | UC-23 | FR-INC-08 (new) | | E03-7 | US-058 |
| Metrics | MF-03 | UC-20 | FR-INC-09 (new) | | | US-072 |

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL hold every Incident in exactly one of `DETECTED`, `ACKNOWLEDGED`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`, and SHALL change it only through the transition table in `design.md` §2.1. [BR-10, FR-INC-02]
- **REQ-UBI-02**: The system SHALL record every transition, confidence change, reopen, escalation and note as an append-only audit row carrying actor id (or `SYSTEM`), actor role, action, from and to state, note and UTC time, in the same transaction as the change. [BR-10, BR-11, FR-INC-04]
- **REQ-UBI-03**: The database SHALL reject `UPDATE` and `DELETE` on the incident audit table, and no cascade SHALL delete audit rows. [BR-11, NFR-SEC-04]
- **REQ-UBI-04**: The system SHALL carry a `confidence` of `CONFIRMED` or `SUSPECTED` on every device-raised Incident, and every read SHALL return it so no client can present a suspected episode as a confirmed SOS. [BR-09]
- **REQ-UBI-05**: The system SHALL serialise correlation per device with a transaction-scoped advisory lock, so concurrent packets of one episode never create two Incidents. [BR-08, NFR-PERF-02]
- **REQ-UBI-06**: The system SHALL NOT let Admin acknowledge or transition an Incident by virtue of the Admin role. [`06-requirements-foundation.md` §2]

### Event-Driven

- **REQ-EVT-01**: WHEN `gateway-sync` hands over an SOS or fall-SOS event, the system SHALL, under the device lock, find the device's most recent Incident that is not `CLOSED` and whose `lastEventAt` is within `incidents.episodeWindowSeconds`; IF found and open, append to it; IF found and `RESOLVED`, reopen it (REQ-EVT-06); IF found and `SUSPECTED`, upgrade it to `CONFIRMED` in place; OTHERWISE create exactly one Incident in `DETECTED` with confidence `CONFIRMED`. [BR-08, E03-2, E03-5]
- **REQ-EVT-02**: WHEN `gateway-sync` hands over a position event for a device, the system SHALL append it to the device's Incident under the same lookup IF one matches, reopening a `RESOLVED` one, and SHALL report back that no Incident matched otherwise, so `gateway-sync` can run cadence detection. [beacons keep the episode alive]
- **REQ-EVT-03**: WHEN `gateway-sync` reports a cadence anomaly for a device with no matching Incident and no dismissal inside `incidents.suspectedSuppressMinutes`, the system SHALL create one Incident in `DETECTED` with confidence `SUSPECTED`. [BR-09, E03-1, US-088]
- **REQ-EVT-04**: WHEN an Incident is created, the system SHALL attach the trip, rental and custodian Guide from `rentals` if the device is on an active rental, and SHALL otherwise mark it `unassigned`, create it anyway, and route it to all Operators for triage. [E03-4]
- **REQ-EVT-05**: WHEN an Incident is created, appended, upgraded, reopened, escalated or transitioned, the system SHALL emit the matching domain event after commit, so `monitoring` notifies the trip's Guides, every Operator and every Admin session within the ≤2 s WebSocket target. Emission SHALL never gate or roll back the write. [US-058, E03-7]
- **REQ-EVT-06**: WHEN a device event matches a `RESOLVED` Incident within the window, the system SHALL move it back to `DETECTED`, increment `reopenCount`, record a `REOPENED` audit row by `SYSTEM` naming the triggering event, and alert as for a new Incident. [BR-12, E03-6, UC-26] *(Proposal: reopen to `DETECTED` so someone must acknowledge again. C-002.)*
- **REQ-EVT-07**: WHEN an Operator, or a Guide assigned to the Incident's trip, acknowledges a `DETECTED` Incident, the system SHALL move it to `ACKNOWLEDGED` and record the actor, role, time and optional note, in a single request with at most two inputs (the action and an optional note). [UC-15, NFR-USE-02]
- **REQ-EVT-08**: WHEN an Operator moves an Incident `ACKNOWLEDGED` to `IN_PROGRESS`, `IN_PROGRESS` to `RESOLVED`, or `RESOLVED` to `CLOSED`, the system SHALL require a note and record it. [UC-16]
- **REQ-EVT-09**: WHEN an Operator dismisses a `SUSPECTED` Incident in `DETECTED` or `ACKNOWLEDGED`, the system SHALL move it straight to `CLOSED` with resolution `FALSE_ALARM` and a required reason, and SHALL suppress new suspected episodes for that device for `incidents.suspectedSuppressMinutes`. [US-088]
- **REQ-EVT-10**: WHEN an Operator raises a manual Incident for a device or a trip, the system SHALL create it in `DETECTED` with source `MANUAL`, confidence `CONFIRMED`, and the Operator as creator. [US-064]
- **REQ-EVT-11**: WHEN an Operator or an in-scope Guide adds a response note, the system SHALL append it to the audit trail without changing state. [UC-17]

### State-Driven

- **REQ-STA-01**: WHILE an Incident stays `DETECTED` longer than `incidents.ackEscalationSeconds`, the system SHALL mark it escalated once, record an `ESCALATED` audit row, and emit `incident.escalated` so every Operator and Admin session is alerted again. [MF-03 auto-escalation timeout]
- **REQ-STA-02**: WHILE an Incident is `CLOSED`, the system SHALL reject every transition and every append; a later event from the device creates a new Incident. [E03-5]
- **REQ-STA-03**: WHILE an Incident is `SUSPECTED`, every read and every emitted event SHALL carry `confidence: SUSPECTED`, and the dismissal action SHALL be offered; a `CONFIRMED` Incident SHALL NOT be dismissable.

### Unwanted Behaviour

- **REQ-ERR-01**: IF two actors acknowledge the same Incident concurrently, THEN the first commit SHALL win, and the second SHALL receive 409 `ALREADY_ACKNOWLEDGED` with the current state and the acknowledging actor in the response. No update is lost. [E03-3]
- **REQ-ERR-02**: IF a transition request carries an `expectedVersion` that no longer matches, THEN the system SHALL return 409 `STALE_VERSION` with the current state.
- **REQ-ERR-03**: IF a Guide acts on an Incident whose trip they are not assigned to, THEN the system SHALL return 404. [BR-13]
- **REQ-ERR-04**: IF a transition is not in the table, THEN the system SHALL return 409 `INVALID_STATE_TRANSITION`.
- **REQ-ERR-05**: IF a dismissal targets a `CONFIRMED` Incident, THEN the system SHALL return 409 `NOT_DISMISSABLE`.
- **REQ-ERR-06**: IF the WebSocket fan-out fails, THEN the Incident SHALL remain persisted and clients SHALL recover it through the list endpoint on reconnect. [E03-7]

### Optional Features

- **REQ-OPT-01**: WHERE `incidents.notifyAdminsOnCreate` is true, Admin sessions SHALL receive creation alerts in addition to escalation alerts.

---

## 3. Non-Functional Requirements

| Property | Target | Source |
|---|---|---|
| Duplicate prevention | 0 duplicate Incidents across a 10x replay, and across 20 concurrent packets of one episode | NFR-REL-03, NFR-PERF-02 |
| Alert latency | commit to WebSocket ≤2 s | US-058, `gateway-sync` NFR table |
| Acknowledgement UX | one step, at most two inputs | NFR-USE-02 |
| Audit | append-only, enforced by trigger | NFR-SEC-04 |

---

## 4. Configuration Matrix entries

| Parameter | Default | Location | Admin-editable | Source of default |
|---|---|---|---|---|
| `incidents.episodeWindowSeconds` | 300 | DB | yes | `gateway-sync` Q3 proposal |
| `incidents.ackEscalationSeconds` | 120 | DB | yes | proposal (MF-03 names the parameter, no value) |
| `incidents.suspectedSuppressMinutes` | 30 | DB | yes | proposal |
| `incidents.notifyAdminsOnCreate` | true | DB | yes | proposal |

---

## 5. Acceptance Criteria

- **AC-01**: One SOS text followed by 12 beacons at 5 s produces one Incident with 13 correlated events. [AC-04 of `gateway-sync`]
- **AC-02**: The same SOS frame delivered 10 times produces one Incident and one `incident.opened` event.
- **AC-03**: 20 concurrent SOS packets of one device (text and positions) produce one Incident.
- **AC-04**: Beacons with no text raise one `SUSPECTED` Incident; a late text upgrades it in place to `CONFIRMED` with a `CONFIDENCE_UPGRADED` audit row and no second Incident.
- **AC-05**: Two acknowledgements at once: one 200, one 409 `ALREADY_ACKNOWLEDGED` naming the first actor.
- **AC-06**: A beacon arriving within the window after `RESOLVED` reopens the Incident to `DETECTED` with a `REOPENED` row; one arriving after the window creates a new Incident.
- **AC-07**: An SOS from a device on no rental creates an `unassigned` Incident routed to all Operators.
- **AC-08**: An Incident left `DETECTED` past `incidents.ackEscalationSeconds` is escalated once; changing the parameter changes when (D-015 demo).
- **AC-09**: `UPDATE incident_audits` in SQL fails.
- **AC-10**: An Admin without the Operator role receives 403 on acknowledge.
- **AC-11**: The metrics endpoint returns MTTA and MTTR equal to the audit timestamps' differences for a seeded drill.

---

## 6. Open Questions

Carried into QUESTION entry C-002: reopen target state, escalation timeout, who may move `IN_PROGRESS` to `RESOLVED` (Operator only, or the trip's Lead Guide too), and whether MTTA starts at the first device event or at Incident creation.
