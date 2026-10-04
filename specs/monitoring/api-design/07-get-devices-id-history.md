# GET /api/devices/:id/history: Device history

> Module `monitoring`. Generated from `scripts/specs/endpoints/monitoring.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Read-only chronological history of a device: state changes, intake checks, provisioning, resets, inspections, maintenance, contracts and incidents, each with actor and UTC time (FR-DEV-11). Served by `monitoring`, the read model that may import every module, so `devices` imports neither `rentals` nor `incidents`.

## API Specification

| API | URL |
| --- | --- |
| GET | /api/devices/:id/history |
| Permission | TrekLink Staff, TrekLink Admin |
| Traces | UC-53, UC-58, FR-DEV-11 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Device id | uuid | `0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10` |

### Query parameters

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| pageNumber | 1-based page | int | no | `1` |
| pageSize | Items per page | int | no | `20` |

## Request sample

No body.

## Response sample

```json
{
  "result": {
    "items": [
      {
        "at": "2026-10-20T03:15:00.000Z",
        "kind": "STATE",
        "summary": "RETURNED to AVAILABLE",
        "actor": "Tran Thi B",
        "refType": "INSPECTION",
        "refId": "in-1"
      }
    ],
    "pageNumber": 1,
    "pageSize": 20,
    "totalCount": 37,
    "totalPages": 1
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
  "message": "Device not found."
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
    P0["Merge the device's own trail with contracts and incidents"]
    D2 -->|no| P0
    OK["Return 200"]
    P0 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant Ctl as DeviceHistoryController
    participant Svc as DeviceHistoryService
    participant DB as Postgres
    participant Dev as DevicesService
    participant Rent as RentalsService
    participant Inc as IncidentsService
    C->>Ctl: GET /api/devices/:id/history
    Ctl->>Svc: history(id, query)
    Svc->>Dev: trail(id)
    Svc->>Rent: contractsOfDevice(id)
    Svc->>Inc: incidentsOfDevice(id)
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
