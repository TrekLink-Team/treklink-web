# Technical Design: incidents

> Fulfills `requirements.md` in this folder. Schema: the `// @module incidents` block of
> `backend/prisma/schema.prisma` is authoritative. The lifecycle is D-034 as amended by D-038.
>
> **Status**: Approved, written by KhoaDD and merged on `dev` (treklink-web PR #30 and #31, 2026-10-18). Changes go through a pull request reviewed by KhoaDD (D-052).

---

## 1. Data model

```mermaid
erDiagram
    DEVICE ||--o{ INCIDENT : "raises"
    RENTAL_CONTRACT |o--o{ INCIDENT : "routes"
    INCIDENT ||--|{ INCIDENT_TRANSITION : "history"
    INCIDENT ||--o{ INCIDENT_STATUS_UPDATE : "updates"
    INCIDENT ||--o{ ALERT_DELIVERY : "alerts"
    INCIDENT_TRANSITION ||--o{ ALERT_DELIVERY : "causes"
    INCIDENT |o--o{ AUTHORITY_REPORT : "reported"
    INCIDENT ||--o{ FIELD_EVENT : "episode"
    INCIDENT {
        uuid id PK
        enum state
        enum confidence
        datetime tierDeadlineAt
        datetime statusDueAt
        datetime reopenWindowEndsAt
        int version
    }
```

***Figure 1***: incidents slice. Routing (`contractId`, `organizationId`) is fixed at creation and redone
only on reopen.

---

## 2. Incident lifecycle (D-034, D-038)

```mermaid
stateDiagram-v2
    [*] --> DETECTED : SOS, fall or cadence
    DETECTED --> NOTIFY_PRIMARY : routed, primary on duty
    DETECTED --> UNROUTED : no contract or nobody to alert
    NOTIFY_PRIMARY --> NOTIFY_BACKUP : timeout or no primary
    NOTIFY_BACKUP --> NOTIFY_MANAGER : timeout or no backup
    NOTIFY_MANAGER --> ESCALATED : timeout
    NOTIFY_PRIMARY --> ACKNOWLEDGED : member acknowledges
    NOTIFY_BACKUP --> ACKNOWLEDGED : member acknowledges
    NOTIFY_MANAGER --> ACKNOWLEDGED : member acknowledges
    ESCALATED --> ACKNOWLEDGED : member acknowledges
    REPORTED --> ACKNOWLEDGED : member acknowledges
    ACKNOWLEDGED --> RESPONDING : response under way
    ACKNOWLEDGED --> ESCALATED : stale limit
    RESPONDING --> ESCALATED : stale limit
    ACKNOWLEDGED --> NOTIFY_BACKUP : owner deactivated
    RESPONDING --> NOTIFY_BACKUP : owner deactivated
    ACKNOWLEDGED --> RESOLVED : outcome reported
    RESPONDING --> RESOLVED : outcome reported
    NOTIFY_PRIMARY --> FALSE_ALARM : member declares
    ACKNOWLEDGED --> FALSE_ALARM : member declares
    RESPONDING --> FALSE_ALARM : member declares
    UNROUTED --> FALSE_ALARM : Staff declare
    UNROUTED --> REPORTED : Staff report
    ESCALATED --> REPORTED : Staff report
    REPORTED --> CLOSED : authority case closed
    RESOLVED --> NOTIFY_PRIMARY : device SOS in reopen window
    FALSE_ALARM --> NOTIFY_PRIMARY : device SOS in reopen window
    RESOLVED --> UNROUTED : unattributed device SOS in reopen window
    FALSE_ALARM --> UNROUTED : unattributed device SOS in reopen window
    RESOLVED --> CLOSED : system, reopen window ended
    FALSE_ALARM --> CLOSED : system, reopen window ended
    CLOSED --> [*]
```

***Figure 2***: Incident lifecycle; SRS Figures 26 and 27. `NOTIFY_BACKUP` and `NOTIFY_MANAGER` also go
to `FALSE_ALARM` (D-034 "`NOTIFY_*`"); those two arrows are omitted from the figure for legibility.
`DETECTED` is transient: routing happens in the creating transaction. The route is the contract and
organization the triggering field event is attributed to (D-040), never the device's current holder; an
`UNATTRIBUTED` event routes to `UNROUTED`. A reopen is re-routed the same way (REQ-EVT-10 with
REQ-EVT-03), so an unattributed SOS, or an organization with nobody to alert, reopens to `UNROUTED`. A
device packet only opens or reopens an incident; a person ends it, and only the system closes a
`RESOLVED` or `FALSE_ALARM` episode, once its reopen window has ended (REQ-UBI-05, D-038 rule 2).

| Timer column | Set when entering | Cleared when leaving |
|---|---|---|
| `tierDeadlineAt` | `NOTIFY_PRIMARY` (+ primary timeout), `NOTIFY_BACKUP`, `NOTIFY_MANAGER` | any `NOTIFY_*` |
| `statusDueAt` | `ACKNOWLEDGED`, `RESPONDING`, and on each status update (+ stale limit) | those two states |
| `reopenWindowEndsAt` | `RESOLVED`, `FALSE_ALARM` (+ reopen window) | those two states |

**Empty tiers.** Entering a `NOTIFY_*` state whose tier has nobody (no shift, no primary, no backup)
continues immediately to the next tier in the same transaction, one transition row each, so the audit
trail shows the skip (BR-16). A Manager tier is never empty while the organization has an active
Manager (`organizations` REQ-UBI-02); if it is, the incident goes to `ESCALATED`.

**Transition implementation.** `IncidentLifecycle.apply(incidentId, event, actor, expectedVersion?, tx)`:
`SELECT ... FOR UPDATE`, look up `(state, event)` in the table, check guards (owner, actor kind,
organization), `UPDATE ... SET state, version = version + 1 ... WHERE id AND version`, insert the
transition row with the next `seq`, insert outbox rows, all in one transaction. A loser of a race reads
the winner's row and answers 409 with the owner (MSG27).

---

## 3. Alert routing and delivery

| Transition into | Recipients | Channels |
|---|---|---|
| `NOTIFY_PRIMARY`, `NOTIFY_BACKUP` | that tier's member | WebSocket, web inbox, email |
| `NOTIFY_MANAGER` | every active Manager | WebSocket, web inbox, email |
| `ESCALATED`, `UNROUTED` | every active TrekLink Staff and Admin account, plus the organization's Managers for `ESCALATED` | WebSocket, web inbox, email (MSG34) |
| any change | the organization's stream | API event |
| stale flag | owner, or the current tier | WebSocket, web inbox |

The TrekLink recipients are the active, not deleted accounts holding the `STAFF` or `ADMIN` role, read
through `AccountsService.activeStaffAndAdminIds` on the `incidents --> auth` edge of platform design Figure 3
(D-079, REQ-EVT-04). An account whose invitation is not yet accepted is included. Each account gets one row
per channel; a recipient listed twice gets one set. Leader ruling of 2026-10-30, answering the confirmation
asked on PR #120: Admin stays a recipient, as this row always said, and D-079's "Staff" reads as Staff and
Admin. `ESCALATED` reads them since TK-144; `UNROUTED` waits for task 2.2.

The dispatcher job reads `alert_deliveries WHERE status = PENDING AND nextAttemptAt <= now()` with
`FOR UPDATE SKIP LOCKED`, sends, and sets `SENT`, or bumps `attempts` and `nextAttemptAt` with backoff
`base × 2^attempts`, or `FAILED` at the limit. WebSocket delivery emits the in-process event `incident.alert`,
whose synchronous listener in `monitoring` publishes to the recipient's room `user:<id>`
(`ws-live-contract.md`); `incidents` never imports `monitoring`. It counts as sent when the listener
returns, whether or not a socket is connected, because the web inbox holds the same alert.

On the wire, `incident.alert` is a `stream` event with `seq: 0`. It is not stored in the stream table,
whose entries are scoped by organization rather than by person, so it has no replay sequence. The
client delivers it without reading or moving its replay cursor; a missed alert stays visible in the
queue through its web inbox row.

---

## 4. Correlation

`IncidentIngress.onSos(event, tx)` is called by `gateway-sync` inside the ingestion transaction:

1. Lock the device's incident outside `CLOSED`, if any (`incidents_one_open_per_device`).
2. If none: create, route (§2), return.
3. If `RESOLVED` or `FALSE_ALARM`, a person has already ended the episode, and no packet ends it
   (REQ-UBI-05, D-038 rule 2). For an SOS that occurred after the episode ended:
   - **Past the window**: `reopenWindowEndsAt` is set and both the server time and the SOS occurrence
     time are at or after it. The window has genuinely ended, so the system closes the episode
     (`REOPEN_WINDOW_ENDED`, `SYSTEM` actor, under the same window guard as the
     `closeAfterReopenWindow` job) and the SOS opens a new incident through step 2, in the same
     transaction, so no SOS is swallowed.
   - **Otherwise**, the SOS occurred or arrives inside the window, or the window was never set (`null`
     counts as not ended): the device reopens the episode (`REOPENED`, `DEVICE` actor), re-routed as
     at creation. An attributed SOS whose organization has someone to alert reopens to
     `NOTIFY_PRIMARY`; an unattributed SOS, or one whose organization has nobody to alert, reopens to
     `UNROUTED`, exactly as a new incident would route (REQ-EVT-03). Nothing is closed.

   An earlier SOS uploaded late, which occurred before the episode ended, is appended to it.
4. Otherwise, if within the correlation window of `lastEventAt`: append (event count, last position,
   `CONFIRMED` upgrade for a suspected incident).
5. Otherwise (open, but older than the window): append too. One open incident per device means a new
   episode on an open incident is the same emergency still running.

`onPosition(event, tx)` appends positions of an open incident (`gatewaySync.retroTagGraceSeconds`
before the SOS included) and counts cadence for `SUSPECTED` creation. A position joins only an
episode still running (not `RESOLVED` or `FALSE_ALARM`). An SOS text carries no position on the wire
(FGT), so the incident's last position comes from these packets: it is set when none is known, and
moved unless its fix time is older than the stored fix time `lastPositionAt`, so an out-of-order
packet never overwrites a newer position (PR #114 review). Positions move neither `eventCount` nor
`lastEventAt`, the SOS correlation anchor.

---

## 5. Services and ports

| Export | Used by |
|---|---|
| `IncidentIngress.onSos(event, tx)`, `onPosition(event, tx)` | gateway-sync |
| `IncidentsService.markDeviceStale(deviceId, stale, lastPosition)` | monitoring |
| `IncidentsService.openByDevices(ids)`, `incidentsOfDevice(id)`, `responseTimes(range)`, `alertDeliveryStats()` | monitoring |
| provider of `CONTRACT_CLOSE_CHECKS` | rentals |

Listens to `member.deactivated` (REQ-EVT-11). Emits `incident.changed`, `audit.record`.

---

## 6. Scheduler jobs

`incidents.tierTimeouts`, `incidents.staleResponses`, `incidents.closeAfterReopenWindow`,
`incidents.deliverAlerts`: `platform` design §4.6. Each selects by its deadline column and state, then
calls `apply()` with the expected state, so a job racing a human action loses cleanly. The three timers
apply one transition per incident in its own transaction, up to 100 per run; a failure on one incident
is logged and that incident is due again on the next run. A `RESOLVED` or `FALSE_ALARM` row with no
reopen window is never selected, since a window never set has not ended.

---

## 7. Error catalogue

| Code | HTTP |
|---|---|
| `INVALID_STATE_TRANSITION` | 409 |
| `ALREADY_OWNED` | 409 |
| `NOT_OWNER` | 403 |
| `STALE_VERSION` | 409 |
| `CASE_ALREADY_CLOSED` | 409 |
| `CONTRACT_NOT_DEFAULTED` | 409 |

---

## 8. Sequence: SOS to escalation

```mermaid
sequenceDiagram
    autonumber
    participant G as gateway-sync
    participant I as IncidentIngress
    participant R as ContractsService
    participant O as RosterService
    participant DB as Postgres
    participant J as tierTimeouts job
    participant D as dispatcher
    G->>I: onSos(event, tx)
    Note over G,I: event carries its attributed contract and organization (D-040)
    I->>O: tiersAt(orgId, now)
    I->>DB: INSERT incident DETECTED, transition 1
    I->>DB: NOTIFY_PRIMARY, deadline, transition 2, outbox rows
    Note over G,DB: ingestion commits
    D->>DB: SKIP LOCKED pending rows, send WS and email
    J->>DB: deadline passed and still NOTIFY_PRIMARY
    J->>DB: NOTIFY_BACKUP, transition 3, outbox
    J->>DB: later NOTIFY_MANAGER, then ESCALATED, Staff alerted
```

***Figure 3***: MF-03 from the SOS to escalation, with nobody answering.

---

## 9. Testing strategy

Transition matrix over 12 states × events; race tests for acknowledge and for job versus human; restart
test with pending deadlines (fake clock); replay ×10; empty-tier skipping; reopen inside and outside the
window; outbox retry and `FAILED` without blocking escalation; cross-organization 404. Every routing test
runs with at least two organizations, including A's late SOS after the device passed to B (AC-09, D-042).

---

## 10. Detailed design for Report 4 (D-044)

Layering as in `organizations` design §9. Figure 4 is the class view; Figures 5 to 10 are the
MF-03 interactions.

<!-- sdd: MF-03 class incidents -->
```mermaid
classDiagram
    class IncidentsController {
        +acknowledge(id, dto, caller) IncidentDto
        +addStatus(id, dto, caller) IncidentDto
        +resolve(id, dto, caller) IncidentDto
        +falseAlarm(id, dto, caller) IncidentDto
        +reportToAuthority(id, dto, actor) IncidentDto
    }
    class IncidentIngress {
        +onSos(event, tx)
        +onPosition(event, tx)
    }
    class IncidentLifecycleService {
        +acknowledge(id, dto, caller) Incident
        +resolve(id, dto, caller) Incident
        +apply(id, expected, to, actor, reason, tx)
    }
    class RoutingService {
        +route(incident, attribution, tx)
    }
    class AuthorityReportService {
        +reportIncident(id, dto, actor) Incident
    }
    class TierTimeoutJob {
        +run()
    }
    class AlertDispatcher {
        +run()
    }
    class IncidentFsm {
        +assertTransition(from, to)
    }
    class IncidentsRepository {
        +lockOpenByDevice(deviceId, tx) Incident
        +insert(incident, tx) Incident
        +compareAndSet(id, state, version, patch, tx) bool
        +insertTransition(row, tx)
        +dueTiers(now) Incident[]
    }
    class OutboxRepository {
        +enqueue(alerts, tx)
        +lockPending(now, limit) AlertDelivery[]
    }
    class RosterService
    IncidentsController --> IncidentLifecycleService
    IncidentsController --> AuthorityReportService
    IncidentIngress --> RoutingService
    IncidentIngress --> IncidentsRepository
    RoutingService --> RosterService : tiersAt
    RoutingService --> IncidentLifecycleService
    TierTimeoutJob --> IncidentLifecycleService
    AuthorityReportService --> IncidentLifecycleService
    IncidentLifecycleService --> IncidentFsm
    IncidentLifecycleService --> IncidentsRepository
    IncidentLifecycleService --> OutboxRepository
    AlertDispatcher --> OutboxRepository
```

***Figure 4***: incidents classes. `RosterService` belongs to `organizations`.

<!-- sdd: MF-03 seq UC-29 part 1 of 2: correlation and routing -->
```mermaid
sequenceDiagram
    autonumber
    participant G as IngestionService
    participant In as IncidentIngress
    participant R as IncidentsRepository
    participant Ro as RoutingService
    participant Os as RosterService
    participant L as IncidentLifecycleService
    G->>In: onSos(event with attribution, tx)
    In->>R: lockOpenByDevice(deviceId, tx)
    alt open incident inside the correlation window
        In->>R: append event, bump count
    else no open incident in the window
        In->>R: insert(incident DETECTED, tx)
        In->>Ro: route(incident, attribution, tx)
        alt event UNATTRIBUTED
            Ro->>L: apply(id, DETECTED, UNROUTED, SYSTEM, tx)
        else attributed to a contract
            Ro->>Os: tiersAt(organizationId, now)
            Ro->>L: apply(id, DETECTED, first non-empty tier, SYSTEM, tx)
        end
    end
```

***Figure 5***: UC-29 Create Incident, part 1 of 2: one incident per episode, routed by attribution
(FR-INC-03, D-040).

<!-- sdd: MF-03 seq UC-29 part 2 of 2: alert outbox -->
```mermaid
sequenceDiagram
    autonumber
    participant L as IncidentLifecycleService
    participant R as IncidentsRepository
    participant Ob as OutboxRepository
    participant Dp as AlertDispatcher
    participant W as LiveGateway
    L->>R: compareAndSet(id, state, version, patch, tx)
    L->>R: insertTransition(row, tx)
    L->>Ob: enqueue(alerts for the tier, tx)
    Note over L,Ob: committed with the ingestion transaction
    Dp->>Ob: lockPending(now, limit)
    Dp-)W: emit incident.alert, monitoring publishes to user rooms
    Dp->>Dp: email, web inbox, API event
    Dp->>Ob: SENT, or retry with backoff
```

***Figure 6***: UC-29 Create Incident, part 2 of 2: UC-30 Send Alert through the outbox.

<!-- sdd: MF-03 seq UC-31 -->
```mermaid
sequenceDiagram
    autonumber
    participant J as TierTimeoutJob
    participant R as IncidentsRepository
    participant L as IncidentLifecycleService
    participant Os as RosterService
    participant Ob as OutboxRepository
    J->>R: dueTiers(now)
    R->>R: SELECT NOTIFY_* WHERE tierDueAt <= now
    loop each due incident
        J->>Os: tiersAt(organizationId, now)
        J->>L: apply(id, expected NOTIFY_PRIMARY, next tier, SYSTEM, tx)
        L->>R: compareAndSet(id, state, version, patch, tx)
        alt a member acknowledged first
            R-->>L: 0 rows
            L-->>J: skip, the human won
        else still unacknowledged
            L->>R: insertTransition(row, tx)
            L->>Ob: enqueue(alerts for the next tier, tx)
            R->>R: COMMIT
        end
    end
    Note over J: after NOTIFY_MANAGER times out the next tier is ESCALATED to TrekLink Staff
```

***Figure 7***: UC-31 Escalate Alert Tier. A job racing a human loses on the compare-and-set.

<!-- sdd: MF-03 seq UC-32 -->
```mermaid
sequenceDiagram
    autonumber
    actor Op as Org Operator
    participant P as IncidentDetailPage
    participant C as IncidentsController
    participant L as IncidentLifecycleService
    participant R as IncidentsRepository
    participant Ob as OutboxRepository
    Op->>P: acknowledge
    P->>C: POST /api/incidents/{id}/acknowledge
    C->>L: acknowledge(id, dto, caller)
    L->>R: compareAndSet(id, NOTIFY_* or ESCALATED or REPORTED, version, owner, tx)
    R->>R: BEGIN, UPDATE WHERE state AND version
    alt another member acknowledged first
        R-->>L: 0 rows
        L-->>C: 409 ALREADY_OWNED with the owner
        C-->>P: MSG27 owner shown
    else first acknowledgement
        L->>R: insertTransition(row, tx)
        L->>Ob: enqueue(stream update, tx)
        R->>R: COMMIT
        L-->>C: IncidentDto ACKNOWLEDGED
        C-->>P: 200 envelope, time to acknowledge recorded
    end
```

***Figure 8***: UC-32 Acknowledge Incident.

<!-- sdd: MF-03 seq UC-33 -->
```mermaid
sequenceDiagram
    autonumber
    actor Op as Org Operator
    participant P as IncidentDetailPage
    participant C as IncidentsController
    participant L as IncidentLifecycleService
    participant R as IncidentsRepository
    Op->>P: post a status update
    P->>C: POST /api/incidents/{id}/status-updates
    C->>L: addStatus(id, dto, caller)
    L->>R: insert update, reset statusDueAt
    R->>R: INSERT, UPDATE
    C-->>P: 200 envelope
    Op->>P: report the outcome
    P->>C: POST /api/incidents/{id}/resolve
    C->>L: resolve(id, dto, caller)
    alt refused: caller is not the owner
        L-->>C: 403 NOT_OWNER
    else accepted: caller is the owner
        L->>R: compareAndSet(id, ACKNOWLEDGED or RESPONDING, version, resolvedAt, tx)
        L->>R: insertTransition(row, tx), set reopen window
        R->>R: COMMIT
        L-->>C: IncidentDto RESOLVED
        C-->>P: 200 envelope, time to resolve recorded
    end
```

***Figure 9***: UC-33 Report Incident Status, ending in `RESOLVED`.

<!-- sdd: MF-03 seq UC-35 -->
```mermaid
sequenceDiagram
    autonumber
    actor St as TrekLink Staff
    participant P as StaffIncidentsPage
    participant C as IncidentsController
    participant A as AuthorityReportService
    participant L as IncidentLifecycleService
    participant R as IncidentsRepository
    St->>P: record agency, reference, time
    P->>C: POST /api/incidents/{id}/authority-reports
    C->>A: reportIncident(id, dto, actor)
    A->>R: lock(id, tx)
    alt refused: not ESCALATED or UNROUTED
        A-->>C: 409 INVALID_STATE_TRANSITION
    else accepted: ESCALATED or UNROUTED
        A->>R: insert authority_reports
        A->>L: apply(id, current, REPORTED, actor, tx)
        L->>R: compareAndSet, insertTransition
        R->>R: COMMIT
        A-->>C: IncidentDto REPORTED
        C-->>P: 200 envelope
    end
```

***Figure 10***: UC-35 Report to Authorities (BR-17).
