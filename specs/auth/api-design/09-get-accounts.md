# GET /api/accounts: List TrekLink accounts

> Module `auth`. Generated from `scripts/specs/endpoints/auth.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Lists TrekLink Staff and Admin accounts (UC-10). Organization accounts are managed by their Manager through the organizations module.

## API Specification

| API | URL |
| --- | --- |
| GET | /api/accounts |
| Permission | TrekLink Admin |
| Traces | UC-10, FR-AUTH-06 |

### Query parameters

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| q | Name or email contains | string | no | `tran` |
| isActive | Filter by active flag | bool | no | `true` |
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
        "id": "3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f",
        "email": "staff1@treklink.vn",
        "fullName": "Tran Thi B",
        "accountType": "TREKLINK",
        "roles": [
          "STAFF"
        ],
        "isActive": true,
        "lastLoginAt": "2026-10-20T03:15:00.000Z",
        "createdAt": "2026-10-20T03:15:00.000Z"
      }
    ],
    "pageNumber": 1,
    "pageSize": 20,
    "totalCount": 4,
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
    P0["Read accounts of type TREKLINK"]
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
    participant Ctl as AccountsController
    participant Svc as AccountsService
    participant DB as Postgres
    C->>Ctl: GET /api/accounts
    Ctl->>Svc: list(query)
    Svc->>DB: SELECT users WHERE accountType = TREKLINK
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
