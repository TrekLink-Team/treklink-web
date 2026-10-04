# GET /api/organizations/:id/roster: On-duty roster

> Module `organizations`. Generated from `scripts/specs/endpoints/organizations.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Lists shift windows in a time range, with `warnings` for every window or gap without a primary (MSG22): alerts in such a window start at the backup tier (BR-16).

## API Specification

| API | URL |
| --- | --- |
| GET | /api/organizations/:id/roster |
| Permission | Org Manager, Org Operator: own |
| Traces | UC-05, FR-ORG-05, BR-16, MSG22 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Organization id; members may use only their own | uuid | `5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f` |

### Query parameters

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| from | Inclusive start | datetime | yes | `2026-10-20T00:00:00Z` |
| to | Exclusive end, at most 31 days after from | datetime | yes | `2026-10-27T00:00:00Z` |

## Request sample

No body.

## Response sample

```json
{
  "result": {
    "shifts": [
      {
        "id": "s-1",
        "startsAt": "2026-10-20T00:00:00Z",
        "endsAt": "2026-10-20T12:00:00Z",
        "primary": {
          "memberId": "6c5b4a39-2817-4f06-9e5d-4c3b2a190807",
          "fullName": "Pham Van D"
        },
        "backup": null
      }
    ],
    "warnings": [
      {
        "from": "2026-10-20T12:00:00Z",
        "to": "2026-10-21T00:00:00Z",
        "kind": "NO_PRIMARY"
      }
    ]
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
  "message": "Organization not found."
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
    P0["Read shifts in range"]
    D2 -->|no| P0
    P1["Compute gaps and windows without a primary"]
    P0 --> P1
    OK["Return 200"]
    P1 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant Ctl as RosterController
    participant Svc as RosterService
    participant DB as Postgres
    C->>Ctl: GET /api/organizations/:id/roster
    Ctl->>Svc: list(orgId, range, caller)
    Svc->>DB: SELECT roster_shifts WHERE range overlaps
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
