# DELETE /api/organizations/:id/roster/:shiftId: Delete a shift

> Module `organizations`. Generated from `scripts/specs/endpoints/organizations.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Deletes a shift that has not started. A started shift is shortened by editing its end instead, so the record of who was on duty stays.

## API Specification

| API | URL |
| --- | --- |
| DELETE | /api/organizations/:id/roster/:shiftId |
| Permission | Org Manager: own |
| Traces | UC-05, FR-ORG-05 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Organization id; members may use only their own | uuid | `5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f` |
| shiftId | Shift id | uuid | `s-1` |

## Request sample

No body.

## Response sample

```json
{
  "result": null,
  "isSuccess": true,
  "statusCode": 200,
  "message": "Shift deleted"
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
  "message": "Shift not found."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>The shift has already started (<code>SHIFT_STARTED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "SHIFT_STARTED"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "Shorten a started shift instead of deleting it."
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
    D2{"The shift has already started?"}
    D1 -->|no| D2
    E2["Return 409 SHIFT_STARTED"]
    D2 -->|yes| E2
    E2 --> X2((End))
    P0["Require startsAt in the future"]
    D2 -->|no| P0
    P1["Delete the row"]
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
    C->>Ctl: DELETE /api/organizations/:id/roster/:shiftId
    Ctl->>Svc: remove(orgId, shiftId, actor)
    Svc->>DB: DELETE roster_shifts WHERE startsAt > now()
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
