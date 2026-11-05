# DELETE /api/devices/:id/dock: End a dock session

> Module `devices`. Generated from `scripts/specs/endpoints/devices.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Ends the open dock session of the unit when the connector releases its port, the unit is unplugged or the tab closes (sent with `keepalive`), so the Staff map drops the pin (design §12.8). Any TrekLink Staff or Admin caller may end the open session, whoever opened it: counters change hands, and a stale session must be clearable (leader ruling on treklink-web#351). Ending a session that is already over, or that does not exist, answers success with `result` null. A session never ended this way expires through the `devices.dockSweep` job. Permission `device.operate`.

## API Specification

| API | URL |
| --- | --- |
| DELETE | /api/devices/:id/dock |
| Permission | TrekLink Staff, TrekLink Admin |
| Traces | UC-14, FR-MON-02 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Device id | uuid | `0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10` |

## Request sample

No body.

## Response sample

```json
{
  "result": null,
  "isSuccess": true,
  "statusCode": 200,
  "message": "Undocked"
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
    D1{"No such record, or it belongs to another organization?"}
    A0 --> D1
    E1["Return 404 NOT_FOUND"]
    D1 -->|yes| E1
    E1 --> X1((End))
    P0["End the open session as RELEASED"]
    D1 -->|no| P0
    P1["Emit device.undocked after commit when one was open"]
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
    participant Ctl as DevicesController
    participant Svc as DockSessionService
    participant DB as Postgres
    C->>Ctl: DELETE /api/devices/:id/dock
    Ctl->>Svc: undock(id, actor)
    Svc->>DB: UPDATE device_dock_sessions SET endedAt, endReason RELEASED WHERE endedAt IS NULL
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
