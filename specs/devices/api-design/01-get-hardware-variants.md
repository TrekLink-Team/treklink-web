# GET /api/hardware-variants: List hardware variants

> Module `devices`. Generated from `scripts/specs/endpoints/devices.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Lists the device models. Org Managers see active variants to choose one in a contract request.

## API Specification

| API | URL |
| --- | --- |
| GET | /api/hardware-variants |
| Permission | TrekLink Staff, TrekLink Admin; Org Manager (active variants, no counts) |
| Traces | UC-13, UC-15, FR-DEV-04 |

### Query parameters

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| includeInactive | Admin only | bool | no | `false` |

## Request sample

No body.

## Response sample

```json
{
  "result": [
    {
      "id": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      "code": "treklink-v3",
      "name": "TrekLink v3 (GPS, SOS button)",
      "hasGps": true,
      "hasMotionSensor": false,
      "mqttCapable": true,
      "firmwareBaseline": "2.7.19-treklink.3",
      "remainingValueSchedule": [
        {
          "fromMonths": 0,
          "valueVnd": 2500000
        },
        {
          "fromMonths": 12,
          "valueVnd": 1800000
        },
        {
          "fromMonths": 24,
          "valueVnd": 1200000
        }
      ],
      "isActive": true,
      "deviceCount": 18
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
    P0["Read variants, with device counts for TrekLink staff"]
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
    participant Ctl as VariantsController
    participant Svc as VariantsService
    participant DB as Postgres
    C->>Ctl: GET /api/hardware-variants
    Ctl->>Svc: list(query, caller)
    Svc->>DB: SELECT hardware_variants
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
