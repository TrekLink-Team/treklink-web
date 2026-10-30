# POST /api/incidents/:id/acknowledge: Acknowledge an incident

> Module `incidents`. Generated from `scripts/specs/endpoints/incidents.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

One step, no required field (NFR-USE-02). Moves a `NOTIFY_*`, `ESCALATED` or `REPORTED` incident to `ACKNOWLEDGED` with the caller as owner; that time is time-to-acknowledge. A concurrent second acknowledgement loses the compare-and-set and is shown the owner (FR-INC-06, E03-3, MSG27). The owner check comes first, so a second member always learns who took it; a version mismatch on an unowned incident is `STALE_VERSION` (MSG36, D-059 rule 7).

## API Specification

| API | URL |
| --- | --- |
| POST | /api/incidents/:id/acknowledge |
| Permission | Org Manager, Org Operator: own |
| Traces | UC-32, FR-INC-04, FR-INC-06, BR-15, E03-3, MSG27 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Incident id; members may use only their own organization's | uuid | `7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d` |

## Request sample

```json
{
  "expectedVersion": 1
}
```

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| note | Optional first note | string | no | `On my way to the ridge` |
| expectedVersion | Incident version the caller saw | int | yes | `1` |

## Response sample

```json
{
  "result": {
    "id": "7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d",
    "code": "INC-2026-000045",
    "device": {
      "id": "0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10",
      "assetTag": "TL-0042",
      "holder": {
        "name": "Le Thi E",
        "phone": "0912345678"
      }
    },
    "organizationId": "5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f",
    "contractId": "c0ffee00-1234-4abc-9def-001122334455",
    "state": "ACKNOWLEDGED",
    "stateChangedAt": "2026-10-20T03:15:00.000Z",
    "source": "DEVICE_FALL",
    "confidence": "CONFIRMED",
    "firstEventAt": "2026-10-20T03:14:52Z",
    "lastEventAt": "2026-10-20T03:15:00.000Z",
    "eventCount": 4,
    "lastPosition": {
      "lat": 11.5601,
      "lon": 108.5402
    },
    "stale": false,
    "owner": {
      "id": "3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f",
      "fullName": "Pham Van D"
    },
    "tierDeadlineAt": null,
    "statusDueAt": "2026-10-20T03:45:00Z",
    "reopenCount": 0,
    "version": 2
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "Incident acknowledged"
}
```

## Validation

<table>
    <th>Status code</th>
    <th>Description</th>
    <th>Examples</th>
    <tbody>
        <tr>
            <td>400</td>
            <td>The body or query fails validation (<code>VALIDATION_FAILED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "VALIDATION_FAILED"
  },
  "isSuccess": false,
  "statusCode": 400,
  "message": "{field} is required."
}
```
</td>
        </tr>
        <tr>
            <td>401</td>
            <td>Missing, malformed or expired access token or API key (<code>UNAUTHENTICATED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "UNAUTHENTICATED"
  },
  "isSuccess": false,
  "statusCode": 401,
  "message": "Authentication required."
}
```
</td>
        </tr>
        <tr>
            <td>403</td>
            <td>The caller's role, policy or organization does not allow this action (<code>FORBIDDEN</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "FORBIDDEN"
  },
  "isSuccess": false,
  "statusCode": 403,
  "message": "You do not have access to this."
}
```
</td>
        </tr>
        <tr>
            <td>404</td>
            <td>No such record, or it belongs to another organization (<code>NOT_FOUND</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "NOT_FOUND"
  },
  "isSuccess": false,
  "statusCode": 404,
  "message": "Incident not found."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>Another member acknowledged first (compare-and-set lost) (<code>ALREADY_OWNED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "ALREADY_OWNED"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "Pham Van D took this incident at 10:15."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>Another user changed the record first (expectedVersion differs) (<code>STALE_VERSION</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "STALE_VERSION"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "This was changed by someone else. Reload and try again."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>The incident is not in a state that allows this (<code>INVALID_STATE_TRANSITION</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "INVALID_STATE_TRANSITION"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "This cannot be done while it is RESOLVED."
}
```
</td>
        </tr>
    </tbody>
</table>

## Activity Diagram

```mermaid
flowchart TB
    S((Start))
    A0["Check token, policy and organization scope"]
    S --> A0
    D1{"The body or query fails validation?"}
    A0 --> D1
    E1["Return 400 VALIDATION_FAILED"]
    D1 -->|yes| E1
    E1 --> X1((End))
    D2{"No such record, or it belongs to another organization?"}
    D1 -->|no| D2
    E2["Return 404 NOT_FOUND"]
    D2 -->|yes| E2
    E2 --> X2((End))
    D3{"Another member acknowledged first (compare-and-set lost)?"}
    D2 -->|no| D3
    E3["Return 409 ALREADY_OWNED"]
    D3 -->|yes| E3
    E3 --> X3((End))
    D4{"Another user changed the record first (expectedVersion differs)?"}
    D3 -->|no| D4
    E4["Return 409 STALE_VERSION"]
    D4 -->|yes| E4
    E4 --> X4((End))
    D5{"The incident is not in a state that allows this?"}
    D4 -->|no| D5
    E5["Return 409 INVALID_STATE_TRANSITION"]
    D5 -->|yes| E5
    E5 --> X5((End))
    P0["Require NOTIFY_*, ESCALATED or REPORTED"]
    D5 -->|no| P0
    P1["If another member owns it: ALREADY_OWNED"]
    P0 --> P1
    P2["If the version differs: STALE_VERSION"]
    P1 --> P2
    P3["Compare-and-set to ACKNOWLEDGED, set owner"]
    P2 --> P3
    P4["Clear the tier deadline, set statusDueAt"]
    P3 --> P4
    P5["Write transition and outbox rows"]
    P4 --> P5
    OK["Return 200"]
    P5 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor U as Org Operator or Org Manager
    participant P as IncidentDetailPage
    participant Ctl as IncidentsController
    participant Svc as IncidentsService
    participant L as IncidentLifecycle
    participant R as IncidentsRepository
    participant Ob as AlertDeliveriesRepository
    U->>P: acknowledge
    P->>Ctl: POST /api/incidents/:id/acknowledge
    Ctl->>Svc: acknowledge(id, input, caller)
    Svc->>R: lockById(id, tx)
    R-->>Svc: incident
    Svc->>L: apply(id, current, ACKNOWLEDGED, member, ACKNOWLEDGED with expectedVersion, tx)
    L->>R: lockById(id, tx)
    R-->>L: incident
    alt refused: another member already owns it
        L-->>Svc: 409 ALREADY_OWNED
        Svc->>R: latestAcknowledgement(id), after rollback
        R-->>Svc: owner and time
        Svc-->>Ctl: 409 ALREADY_OWNED
        Ctl-->>P: 409 envelope
        P-->>U: MSG27, owner shown
    else accepted
        L->>R: compareAndSet(current, patch, tx)
        L->>R: insertTransition(row, tx)
        L->>Ob: enqueue(API event, tx)
        L-->>Svc: incident ACKNOWLEDGED
        Note over Svc,R: COMMIT, then incident.changed and audit.record
        Svc-->>Ctl: incident
        Ctl-->>P: 200 envelope
        P-->>U: ACKNOWLEDGED, owner is the caller
    end
```
