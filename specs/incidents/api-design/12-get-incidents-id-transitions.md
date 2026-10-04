# GET /api/incidents/:id/transitions: Incident audit trail

> Module `incidents`. Generated from `scripts/specs/endpoints/incidents.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

The append-only transition trail: sequence, from, to, actor or SYSTEM, reason and UTC time (FR-INC-04, BR-18).

## API Specification

| API | URL |
| --- | --- |
| GET | /api/incidents/:id/transitions |
| Permission | Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin |
| Traces | UC-58, FR-INC-04, BR-18 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Incident id; members may use only their own organization's | uuid | `7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d` |

## Request sample

No body.

## Response sample

```json
{
  "result": [
    {
      "seq": 1,
      "fromState": null,
      "toState": "DETECTED",
      "actor": "SYSTEM",
      "reason": "CREATED",
      "createdAt": "2026-10-20T03:15:00.000Z"
    },
    {
      "seq": 2,
      "fromState": "DETECTED",
      "toState": "NOTIFY_PRIMARY",
      "actor": "SYSTEM",
      "reason": "ROUTED",
      "createdAt": "2026-10-20T03:15:00.000Z"
    }
  ],
  "isSuccess": true,
  "statusCode": 200,
  "message": "OK"
}
```

## Validation

<table>
    <th>Status code</th>
    <th>Description</th>
    <th>Examples</th>
    <tbody>
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
    </tbody>
</table>

## Activity Diagram

```mermaid
flowchart TB
    S((Start))
    A0["Check token, policy and organization scope"]
    S --> A0
    D1{"No such record, or it belongs to another organization?"}
    A0 --> D1
    E1["Return 404 NOT_FOUND"]
    D1 -->|yes| E1
    E1 --> X1((End))
    P0["Read incident_transitions by seq"]
    D1 -->|no| P0
    OK["Return 200"]
    P0 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant Ctl as IncidentsController
    participant Svc as IncidentsQueryService
    participant DB as Postgres
    C->>Ctl: GET /api/incidents/:id/transitions
    Ctl->>Svc: transitions(id, caller)
    Svc->>DB: SELECT incident_transitions
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
