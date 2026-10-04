# GET /api/parameters: List business parameters

> Module `platform`. Generated from `scripts/specs/endpoints/platform.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Lists every registered business parameter with its current value, type, bounds and owning module: the live view of the Configuration Matrix (UC-57).

## API Specification

| API | URL |
| --- | --- |
| GET | /api/parameters |
| Permission | TrekLink Admin |
| Traces | UC-57, FR-CFG-01, NFR-CFG-02, REQ-UBI-06 |

### Query parameters

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| ownerModule | Filter by owning module | string | no | `incidents` |
| pageNumber | 1-based page | int | no | `1` |
| pageSize | Items per page, at most MAX_PAGE_SIZE | int | no | `20` |

## Request sample

No body.

## Response sample

```json
{
  "result": {
    "items": [
      {
        "key": "incidents.primaryAckTimeoutSeconds",
        "value": 120,
        "valueType": "DURATION_SECONDS",
        "bounds": {
          "min": 30,
          "max": 900
        },
        "unit": "seconds",
        "ownerModule": "incidents",
        "description": "How long the primary on-duty member has to acknowledge before the backup is alerted",
        "version": 3,
        "updatedAt": "2026-10-20T03:15:00.000Z"
      }
    ],
    "pageNumber": 1,
    "pageSize": 20,
    "totalCount": 41,
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
    P0["Read parameters, filtered and paged"]
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
    participant Ctl as ParametersController
    participant Svc as ParametersService
    participant DB as Postgres
    C->>Ctl: GET /api/parameters
    Ctl->>Svc: list(query)
    Svc->>DB: SELECT business_parameters
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
