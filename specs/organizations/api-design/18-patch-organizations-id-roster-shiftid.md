# PATCH /api/organizations/:id/roster/:shiftId: Edit a shift

> Module `organizations`. Generated from `scripts/specs/endpoints/organizations.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Changes a shift's window or members. A change takes effect for the next alert; an incident already in a tier keeps its recipient. On a shift that has started only `endsAt` may change, and not to a time before now, so the record of who was on duty stays (ruling 2026-10-30).

## API Specification

| API | URL |
| --- | --- |
| PATCH | /api/organizations/:id/roster/:shiftId |
| Permission | Org Manager: own |
| Traces | UC-05, FR-ORG-05 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Organization id; members may use only their own | uuid | `5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f` |
| shiftId | Shift id | uuid | `s-1` |

## Request sample

```json
{
  "backupMemberId": "8d7c6b5a-..."
}
```

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| startsAt | Start; not accepted once the shift has started | datetime | no | `...` |
| endsAt | End; the only field accepted once the shift has started, then not before now | datetime | no | `...` |
| primaryMemberId | Member or null; not accepted once the shift has started | uuid | no | `...` |
| backupMemberId | Member or null; not accepted once the shift has started | uuid | no | `...` |

## Response sample

```json
{
  "result": {
    "shift": {
      "id": "s-1",
      "startsAt": "2026-10-20T00:00:00Z",
      "endsAt": "2026-10-20T12:00:00Z",
      "primary": {
        "memberId": "6c5b4a39-2817-4f06-9e5d-4c3b2a190807",
        "fullName": "Pham Van D"
      },
      "backup": null
    },
    "warnings": []
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "Saved."
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
  "message": "Shift not found."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>The shift has started and the body changes a field other than endsAt (<code>SHIFT_STARTED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "SHIFT_STARTED"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "Only the end of a started shift can change."
}
```
</td>
        </tr>
        <tr>
            <td>400</td>
            <td>endsAt is not after startsAt, endsAt is in the past, or the shift lasts more than 31 days (<code>VALIDATION_FAILED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "VALIDATION_FAILED"
  },
  "isSuccess": false,
  "statusCode": 400,
  "message": "endsAt must not be in the past."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>The window overlaps another shift (<code>SHIFT_OVERLAP</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "SHIFT_OVERLAP"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "This shift overlaps another one."
}
```
</td>
        </tr>
        <tr>
            <td>400</td>
            <td>A member is deactivated, has not set a password yet, is of another organization, or both slots are the same (<code>MEMBER_NOT_ELIGIBLE</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "MEMBER_NOT_ELIGIBLE"
  },
  "isSuccess": false,
  "statusCode": 400,
  "message": "Choose two different active members of your organization."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>The organization is PENDING, REJECTED or CLOSED; the roster is managed while ACTIVE or SUSPENDED (<code>INVALID_STATE_TRANSITION</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "INVALID_STATE_TRANSITION"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "This cannot be done while it is CLOSED."
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
    D3{"The shift has started and the body changes a field other than endsAt?"}
    D2 -->|no| D3
    E3["Return 409 SHIFT_STARTED"]
    D3 -->|yes| E3
    E3 --> X3((End))
    D4{"endsAt is not after startsAt, endsAt is in the past, or the shift lasts more than 31 days?"}
    D3 -->|no| D4
    E4["Return 400 VALIDATION_FAILED"]
    D4 -->|yes| E4
    E4 --> X4((End))
    D5{"The window overlaps another shift?"}
    D4 -->|no| D5
    E5["Return 409 SHIFT_OVERLAP"]
    D5 -->|yes| E5
    E5 --> X5((End))
    D6{"A member is deactivated, has not set a password yet, is of another organization, or both slots are the same?"}
    D5 -->|no| D6
    E6["Return 400 MEMBER_NOT_ELIGIBLE"]
    D6 -->|yes| E6
    E6 --> X6((End))
    D7{"The organization is PENDING, REJECTED or CLOSED; the roster is managed while ACTIVE or SUSPENDED?"}
    D6 -->|no| D7
    E7["Return 409 INVALID_STATE_TRANSITION"]
    D7 -->|yes| E7
    E7 --> X7((End))
    P0["Require the organization ACTIVE or SUSPENDED"]
    D7 -->|no| P0
    P1["Validate members"]
    P0 --> P1
    P2["Update the shift"]
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
    participant Ctl as RosterController
    participant Svc as RosterService
    participant DB as Postgres
    C->>Ctl: PATCH /api/organizations/:id/roster/:shiftId
    Ctl->>Svc: update(orgId, shiftId, dto, actor)
    Svc->>DB: UPDATE roster_shifts
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
