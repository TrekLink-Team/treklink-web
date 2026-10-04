# GET /api/incidents/:id: Incident detail

> Module `incidents`. Generated from `scripts/specs/endpoints/incidents.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Returns the incident with its device and holder label, owner, pending deadline, latest status updates and authority reports.

## API Specification

| API | URL |
| --- | --- |
| GET | /api/incidents/:id |
| Permission | Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin |
| Traces | UC-32, UC-33, FR-AUTH-11 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Incident id; members may use only their own organization's | uuid | `7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d` |

## Request sample

No body.

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
    "state": "NOTIFY_PRIMARY",
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
    "owner": null,
    "tierDeadlineAt": "2026-10-20T03:17:00Z",
    "statusDueAt": null,
    "reopenCount": 0,
    "version": 1,
    "statusUpdates": [],
    "authorityReports": []
  },
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
    P0["Read within scope"]
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
    C->>Ctl: GET /api/incidents/:id
    Ctl->>Svc: get(id, caller)
    Svc->>DB: SELECT incident, updates, reports
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
