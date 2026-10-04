# Requirements Specification: incidents (SOS to tiered alert to escalation)

**User Story**: As an **Org Operator on duty**, I want every SOS from my organization's devices to reach me at once as one incident I can take ownership of, and to escalate on its own if I cannot answer; as **TrekLink Staff**, I want every unanswered or unroutable SOS to land with us, so that we can report it to the authorities with a full record.
**Story ID**: assigned when the backlog is regenerated | **Priority**: Highest | **Milestone**: MF-03

> **Authority**: Report 3 SRS (2026-10-04) UC-29 to UC-37, FR-INC-01 to FR-INC-13 (FR-INC-09 withdrawn by D-038), BR-13 to BR-18, BR-32, E03-1 to E03-7, E03-9, NFR-REL-03, NFR-REL-07, NFR-PERF-04, NFR-AVL-02, MSG27, MSG28, MSG31, MSG34; D-034 (lifecycle and rules) as amended by D-038; D-033 item 6 (TrekLink never coordinates a rescue). Rewritten 2026-10-04 (D-036).

---

## 1. Domain Context & Scope

- **In-Scope**: incident creation from an SOS, a fall SOS or a cadence anomaly, with episode correlation;
  routing to the contract holding the device; the D-034 lifecycle with its timers; acknowledgement,
  response, status updates, outcome and false alarm; authority reports; reopen and close; the alert
  outbox and its delivery; the stale flag; response-time metrics.
- **Out-of-Scope**: decoding packets (`gateway-sync`, which calls in); the roster itself (`organizations`);
  the map (`monitoring`); rescue coordination (no TrekLink role, D-033); any change made by the device
  itself (D-038).
- **Depends on**: `platform`, `auth` (contact cards), `organizations` (roster tiers), `devices`, `rentals`
  (routing). Provides `CONTRACT_CLOSE_CHECKS` to `rentals`. Called by `gateway-sync`, `monitoring`.

### Traceability

| This spec | SRS |
|---|---|
| Creation, correlation, cadence | UC-29, FR-INC-01, FR-INC-02, BR-13, BR-14, E03-1, E03-2 |
| Routing | FR-INC-03, E03-4, E03-9, BR-32 |
| Lifecycle | FR-INC-04, BR-15, BR-18, D-034 |
| Tiers and escalation | UC-31, FR-INC-05, BR-16 |
| Owner actions | UC-32 to UC-34, FR-INC-06 to FR-INC-08, E03-3, E03-5 |
| Authority reports | UC-35, FR-INC-10, BR-17 |
| Reopen and close | UC-36, UC-37, FR-INC-11, E03-6 |
| Alerts | UC-30, FR-INC-12, E03-7, NFR-PERF-04 |
| Stale device | FR-INC-13 |

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The system SHALL change incident state only through the D-034 transition table (design §2); each transition SHALL be one transaction with a compare-and-set on `state` and `version` and one append-only `IncidentTransition` row with sequence, from, to, actor or `SYSTEM`, reason and UTC time. [FR-INC-04, BR-15, BR-18]
- **REQ-UBI-02**: The system SHALL keep at most one incident per device outside `CLOSED`, enforced by the database. [FR-INC-01, BR-13]
- **REQ-UBI-03**: Every incident outside `CLOSED`, `REPORTED`, `UNROUTED` and `ESCALATED` SHALL have either a named owner with a status deadline or a pending tier deadline; `UNROUTED`, `ESCALATED` and `REPORTED` are owned by TrekLink Staff as a role. [NFR-REL-07]
- **REQ-UBI-04**: The system SHALL write each alert to the outbox in the same transaction as the transition that caused it and SHALL deliver it after commit; a delivery failure SHALL never block or roll back a transition. [FR-INC-12, D-034 rule 3]
- **REQ-UBI-05**: No packet from a device SHALL change an incident's state other than opening or reopening it; a false alarm is declared only by a person. [D-038]

### Event-Driven

- **REQ-EVT-01**: WHEN `gateway-sync` hands over an SOS or fall SOS for a device with an incident outside `CLOSED` whose last event is within `incidents.correlationWindowSeconds`, the system SHALL append the event to it and update its last event and position; WHEN the open incident is `RESOLVED` or `FALSE_ALARM` within its reopen window, the system SHALL reopen it (REQ-EVT-10); otherwise it SHALL create exactly one incident. [FR-INC-01]
- **REQ-EVT-02**: WHEN a device's position events reach `incidents.cadenceCount` within `incidents.cadenceWindowSeconds` with no open incident, the system SHALL create a `SUSPECTED` incident from `CADENCE_INFERRED`; WHEN a later SOS text of the same episode arrives, the system SHALL upgrade it to `CONFIRMED` in place. [FR-INC-02, E03-1]
- **REQ-EVT-03**: WHEN an incident is created, the system SHALL, in the same transaction, ask `rentals` for the contract holding the device (`ACTIVE`, `ENDING`, `RETURN_DUE`, `OVERDUE` or `DEFAULTED`) and `organizations` for the tiers at that instant, and SHALL move it from `DETECTED` to `NOTIFY_PRIMARY` (or the first non-empty tier) or to `UNROUTED` when there is no such contract or nobody to alert. [FR-INC-03, E03-4, E03-9]
- **REQ-EVT-04**: WHEN a tier deadline passes without acknowledgement, the system SHALL move the incident to the next non-empty tier and alert it, or to `ESCALATED` after the Manager tier, and alert TrekLink Staff (MSG34). A timeout job SHALL do nothing when the incident has already moved. [FR-INC-05, BR-16]
- **REQ-EVT-05**: WHEN a member of the routed organization acknowledges an incident in `NOTIFY_*`, `ESCALATED` or `REPORTED`, the system SHALL move it to `ACKNOWLEDGED`, set the owner, record the time-to-acknowledge, and set the status deadline; a concurrent second acknowledgement SHALL lose the compare-and-set and be shown the owner (MSG27). [FR-INC-06, E03-3]
- **REQ-EVT-06**: WHEN the owner reports a response under way, the system SHALL move `ACKNOWLEDGED` to `RESPONDING`; WHEN the owner adds a status update, the system SHALL reset the status deadline. [FR-INC-07]
- **REQ-EVT-07**: WHEN the status deadline of an `ACKNOWLEDGED` or `RESPONDING` incident passes, the system SHALL move it to `ESCALATED`, keep the owner, and alert the Manager and TrekLink Staff. [FR-INC-07, E03-5]
- **REQ-EVT-08**: WHEN the owner reports the outcome, the system SHALL move the incident to `RESOLVED`, record the time-to-resolve and start the reopen window; WHEN a member declares a false alarm with a reason from `NOTIFY_*`, `ACKNOWLEDGED` or `RESPONDING`, or TrekLink Staff from `UNROUTED`, the system SHALL move it to `FALSE_ALARM` and start the window. [FR-INC-08]
- **REQ-EVT-09**: WHEN TrekLink Staff record an authority report with agency, reference and time on an `ESCALATED` or `UNROUTED` incident, the system SHALL move it to `REPORTED`; WHEN they record the case closed, the system SHALL move it to `CLOSED`. [FR-INC-10, BR-17]
- **REQ-EVT-10**: WHEN a new SOS episode from the same device arrives within the reopen window of a `RESOLVED` or `FALSE_ALARM` incident, the system SHALL move it to `NOTIFY_PRIMARY` (re-routed as at creation), increase its reopen count and clear the owner; WHEN the window ends, the system SHALL move it to `CLOSED`. [FR-INC-11, E03-6]
- **REQ-EVT-11**: WHEN the owner of an `ACKNOWLEDGED` or `RESPONDING` incident is deactivated, the system SHALL move it to `NOTIFY_BACKUP` and alert that tier. [D-034]
- **REQ-EVT-12**: WHEN the staleness sweep reports a device silent past `monitoring.deviceStaleSeconds` during an incident outside `CLOSED`, the system SHALL flag the incident stale with the last position, keep its state, and notify the owner or current tier; WHEN the device is heard again, the flag SHALL clear. [FR-INC-13]
- **REQ-EVT-13**: WHEN an outbox row is due, the dispatcher SHALL deliver it by its channel (web inbox, WebSocket to the recipient, email, API stream event), retry failures with exponential backoff from `incidents.alertRetryBaseSeconds` up to `incidents.alertMaxAttempts`, then mark it `FAILED` and log it. [FR-INC-12, E03-7]

### State-Driven

- **REQ-STA-01**: WHILE an incident is routed to an organization, the incident and its alerts SHALL be visible only to that organization's members and to TrekLink staff. [FR-AUTH-11]
- **REQ-STA-02**: WHILE a contract has an incident outside `CLOSED` on one of its devices, `CONTRACT_CLOSE_CHECKS` SHALL report it, so the contract cannot close. [FR-CON-13, BR-27]

### Unwanted Behaviour

- **REQ-ERR-01**: IF an action is not allowed in the incident's state, THEN the system SHALL return 409 `INVALID_STATE_TRANSITION` (MSG28).
- **REQ-ERR-02**: IF someone other than the owner reports a response, status or outcome, THEN the system SHALL return 403 `NOT_OWNER`.
- **REQ-ERR-03**: IF a duplicate or replayed event arrives, THEN no second incident and no second alert per tier SHALL result. [NFR-REL-03]
- **REQ-ERR-04**: IF the backend restarts with deadlines pending, THEN every deadline SHALL fire once, from the stored time. [NFR-AVL-02]

---

## 3. Non-Functional Requirements

| Property | Target | Source |
|---|---|---|
| Alert latency | WebSocket alert to connected recipients ≤2 s after the transition commits, under normal load | NFR-PERF-04 |
| Replay | 10× replay of an SOS episode produces 1 incident and 1 alert per tier | NFR-REL-03, TC-11 |
| Timer precision | a tier escalates within 5 s of its deadline (job cadence) | FR-INC-05 |

---

## 4. Configuration

The `incidents` section of the [Configuration Matrix](../platform/configuration-matrix.md).

---

## 5. Acceptance Criteria

- **AC-01**: A fall SOS from a rented device creates one incident `NOTIFY_PRIMARY` and alerts the rostered primary within 2 s. (TC-13)
- **AC-02**: With nobody acknowledging, the incident walks primary, backup, Manager, then `ESCALATED`, each after its timeout. (TC-16)
- **AC-03**: Two members acknowledge at once; one owns it, the other gets 409 with the owner's name. (E03-3)
- **AC-04**: An SOS from a device on no contract is `UNROUTED`; Staff record an authority report, then the case closed; the incident ends `CLOSED`. (TC-17)
- **AC-05**: 6 positions in 60 s with no SOS text raise a `SUSPECTED` incident; the late SOS text upgrades it. (TC-14)
- **AC-06**: Every pair of the state matrix is either allowed or answered 409. (TC-15)
- **AC-07**: Email delivery fails three times; the incident still escalates on time and the alert log shows the retries. (E03-7)

---

## 6. Open Questions

None.
