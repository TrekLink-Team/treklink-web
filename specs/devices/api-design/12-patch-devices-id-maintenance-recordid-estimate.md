# PATCH /api/devices/:id/maintenance/:recordId/estimate: Record a maintenance estimate

> Module `devices`. Generated from `scripts/specs/endpoints/devices.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Sets or revises who does the work and its estimated cost on an `OPEN` record, for example one the weekly scan opened or one an Admin rejected. Above `devices.maintenanceApprovalThresholdVnd` the record becomes `PENDING_APPROVAL` (FR-DEV-20, BR-44).

## API Specification

| API | URL |
| --- | --- |
| PATCH | /api/devices/:id/maintenance/:recordId/estimate |
| Permission | TrekLink Staff |
| Traces | UC-52, UC-64, FR-DEV-20, BR-44 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Device id | uuid | `0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10` |
| recordId | Maintenance record id | uuid | `mr-1` |

## Request sample

```json
{
  "workBy": "VENDOR",
  "vendorName": "Hoang Long Electronics",
  "estimatedCostVnd": 1800000,
  "expectedVersion": 1
}
```

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| workBy | `IN_HOUSE` or `VENDOR` | enum | yes | `VENDOR` |
| vendorName | Required when workBy is VENDOR | string | no | `Hoang Long Electronics` |
| estimatedCostVnd | Estimated cost | int | yes | `1800000` |
| expectedVersion | Record version the caller saw | int | yes | `1` |

## Response sample

```json
{
  "result": {
    "id": "mr-1",
    "device": {
      "id": "0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10",
      "assetTag": "TL-0042"
    },
    "reason": "SCHEDULED",
    "status": "PENDING_APPROVAL",
    "description": "Six-month service",
    "expectedAt": "2026-10-20",
    "workBy": "VENDOR",
    "vendorName": "Hoang Long Electronics",
    "estimatedCostVnd": 1800000,
    "estimatedById": "3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f",
    "approvedCostVnd": null,
    "decision": null,
    "decisionReason": null,
    "actualCostVnd": null,
    "warrantyUntil": null,
    "checklist": [
      "Battery health",
      "Antenna and connector",
      "Enclosure seal",
      "Button and buzzer"
    ],
    "checklistResults": null,
    "firmwareVersion": null,
    "resolution": null,
    "openedAt": "2026-10-20T03:15:00.000Z",
    "closedAt": null,
    "version": 2
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "Estimate recorded; Admin approval required"
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
  "message": "Maintenance record not found."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>The maintenance record is not in a state that allows this (<code>INVALID_STATE_TRANSITION</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "INVALID_STATE_TRANSITION"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "This cannot be done while it is PENDING_APPROVAL."
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
            <td>400</td>
            <td>workBy is VENDOR without a vendor name (<code>VENDOR_REQUIRED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "VENDOR_REQUIRED"
  },
  "isSuccess": false,
  "statusCode": 400,
  "message": "Name the vendor."
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
    D3{"The maintenance record is not in a state that allows this?"}
    D2 -->|no| D3
    E3["Return 409 INVALID_STATE_TRANSITION"]
    D3 -->|yes| E3
    E3 --> X3((End))
    D4{"Another user changed the record first (expectedVersion differs)?"}
    D3 -->|no| D4
    E4["Return 409 STALE_VERSION"]
    D4 -->|yes| E4
    E4 --> X4((End))
    D5{"workBy is VENDOR without a vendor name?"}
    D4 -->|no| D5
    E5["Return 400 VENDOR_REQUIRED"]
    D5 -->|yes| E5
    E5 --> X5((End))
    P0["Require OPEN"]
    D5 -->|no| P0
    P1["Record the estimate and its author"]
    P0 --> P1
    P2["Set PENDING_APPROVAL and notify the Admins when above the threshold"]
    P1 --> P2
    OK["Return 200"]
    P2 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant Ctl as MaintenanceController
    participant Svc as MaintenanceService
    participant DB as Postgres
    C->>Ctl: PATCH /api/devices/:id/maintenance/:recordId/estimate
    Ctl->>Svc: estimate(recordId, dto, actor)
    Svc->>DB: UPDATE maintenance_records
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
