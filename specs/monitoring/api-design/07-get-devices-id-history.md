# GET /api/devices/:id/history: Device history

> Module `monitoring`. Generated from `scripts/specs/endpoints/monitoring.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Read-only chronological history of a device: state changes, intake checks, provisioning, resets, inspections, maintenance, contracts and incidents, each with actor and UTC time (FR-DEV-11). Served by `monitoring`, the read model that may import every module, so `devices` imports neither `rentals` nor `incidents`. Newest first. Entries of one time read in lifecycle order: a reservation or a check-in before the unit's own rows of that time, a handover, a release or a loss after them, and state rows in the order of their moves.

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
        "summary": "From Returned to Available (Inspection pass)",
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
    actor S as TrekLink Staff
    participant P as DeviceDetailPage
    participant Ctl as DeviceHistoryController
    participant Svc as DeviceHistoryService
    participant Dev as DevicesService (devices)
    participant Rent as ContractsService (rentals)
    participant Inc as IncidentsQueryService (incidents)
    participant Org as OrganizationsService (organizations)
    participant Acc as AccountsService (auth)
    S->>P: open the device and read its history
    activate P
    P->>Ctl: GET /api/devices/:id/history
    activate Ctl
    Ctl->>Svc: history(id, skip, take)
    activate Svc
    Svc->>Dev: trail(id)
    activate Dev
    Dev-->>Svc: the device's own rows, or 404 for an unknown device
    deactivate Dev
    alt the device is unknown
        Svc-->>Ctl: 404 NOT_FOUND
        Ctl-->>P: 404 envelope
    else the device exists
        Svc->>Rent: contractsOfDevice(id)
        activate Rent
        Rent-->>Svc: one row per contract with its reservation, handover, release, check-in and loss times
        deactivate Rent
        Svc->>Org: labelsOf(organizationIds)
        activate Org
        Org-->>Svc: the organization codes
        deactivate Org
        Svc->>Inc: incidentsOfDevice(id)
        activate Inc
        Inc-->>Svc: the incidents of the device with their transitions
        deactivate Inc
        Note over Svc: merge the rows, order them by time and lifecycle rank, newest first, take the page
        Svc->>Acc: contactCard(actorIds of the page)
        activate Acc
        Acc-->>Svc: the names, SYSTEM when none
        deactivate Acc
        Svc-->>Ctl: items and total
        Ctl-->>P: 200 envelope, the history listed
    end
    deactivate Svc
    deactivate Ctl
    deactivate P
```
