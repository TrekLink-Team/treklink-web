# DELETE /api/groups/:id/devices/:deviceId: Take a device out of its group

> Module `rentals`. Generated from `scripts/specs/endpoints/rentals.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Ends the device's open assignment in this group with `UNASSIGNED`; the device stays rented and ungrouped. Audited as `group.deviceUnassigned`.

## API Specification

| API | URL |
| --- | --- |
| DELETE | /api/groups/:id/devices/:deviceId |
| Permission | Org Manager |
| Traces | UC-68, FR-CON-18 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Group id; members may use only their own organization's | uuid | `g-1` |
| deviceId | Device committed to the contract | uuid | `0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10` |

## Request sample

No body.

## Response sample

```json
{
  "result": {
    "groupId": "g-2",
    "deviceId": "0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10",
    "endedAt": "2026-10-20T03:15:00.000Z"
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "Device removed from the group"
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
  "message": "Group assignment not found."
}
```
</td>
        </tr>
        <tr>
            <td>404</td>
            <td>Not a live group of the organization, or the device is not in it (<code>NOT_FOUND</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "NOT_FOUND"
  },
  "isSuccess": false,
  "statusCode": 404,
  "message": "Not found."
}
```
</td>
        </tr>
    </tbody>
</table>

## Activity Diagram

```mermaid
flowchart TB
    S((Start)) --> A{"Authenticated?"}
    A -->|no| E401["Return 401 UNAUTHENTICATED"]
    A -->|yes| P{"Allowed to manage the group?"}
    P -->|no| E403["Return 403 FORBIDDEN"]
    P -->|yes| G["Lock the organization tree and target group"]
    G --> L{"Live group of this organization?"}
    L -->|no| E404["Return 404 NOT_FOUND"]
    L -->|yes| D["Lock the device and read its open assignment"]
    D --> H{"Device assigned to this group?"}
    H -->|no| E404
    H -->|yes| W["End the assignment and commit"]
    W --> V["Emit audit and group-change events"]
    V --> OK["Return 200"]
    E401 --> Z((End))
    E403 --> Z
    E404 --> Z
    OK --> Z
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant Ctl as GroupsController
    participant Svc as GroupsService
    participant DB as Postgres
    C->>Ctl: DELETE /api/groups/:id/devices/:deviceId
    Ctl->>Svc: unassign(id, deviceId, actor)
    Svc->>DB: Acquire organization tree, group row and device locks
    Svc->>DB: SELECT the device's open group assignment
    Svc->>DB: UPDATE group_assignments SET endedAt, endedReason = UNASSIGNED
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
