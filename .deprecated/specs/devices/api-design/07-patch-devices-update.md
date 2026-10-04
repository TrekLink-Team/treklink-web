# PATCH /api/devices/:id: Edit device metadata

> Module `devices`. Format: `02-templates/04-api-endpoint-template.md`, with Mermaid in place of PlantUML (D-017). Envelope: D-002.

[TOC]

---
## Overview

Edits registration metadata: node number, MAC, firmware version, notes. Status is not editable here; see the transitions endpoint. Changing `nodeNum` is audited because it changes which field events attach to this unit.

## API Specification

| API        | URL             |
| ---------- | --------------- |
| PATCH | /api/devices/:id |
| Permission | Operator, Admin |
| Traces | US-012, US-016 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Device id | uuid | `0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10` |

## Request sample

```json
{
  "firmwareVersion": "2.7.19-treklink.4",
  "notes": "Reflashed with onboard queue build"
}
```

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| nodeNum | Decimal or `!hex` | string | no | `!a4b1c2d3` |
| macAddress | Colon-separated | string | no | `A4:CF:...` |
| firmwareVersion | Version string | string | no | `2.7.19-treklink.4` |
| notes | Free text | string | no | `Reflashed` |

## Response sample

```json
{
  "result": {
    "id": "0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10",
    "assetTag": "TL-0042",
    "hardwareVariant": {
      "id": "hv-03...",
      "code": "treklink-v3"
    },
    "nodeNum": 2763113171,
    "nodeId": "!a4b1c2d3",
    "macAddress": "A4:CF:12:A4:B1:C2",
    "firmwareVersion": "2.7.19-treklink.4",
    "status": "AVAILABLE",
    "statusChangedAt": "2026-10-02T02:00:00Z",
    "pskVersion": 1,
    "batteryPct": 68,
    "batteryAdvisory": "CHARGE_ADVISED",
    "lastSeenAt": "2026-10-02T03:58:10Z",
    "connectivity": "LIVE",
    "lastPosition": {
      "lat": 11.5544,
      "lon": 108.5381
    },
    "buffering": false
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "Device updated"
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
            <td>Node number invalid (<code>NODE_NUM_INVALID</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "NODE_NUM_INVALID"
  },
  "isSuccess": false,
  "statusCode": 400,
  "message": "nodeNum must be a decimal from 0 to 4294967295 or ! followed by 8 hex digits."
}
```
</td>
        </tr>
        <tr>
            <td>401</td>
            <td>Missing, malformed or expired access token (<code>UNAUTHENTICATED</code>)</td>
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
            <td>Authenticated, but the caller's role or policy does not allow this action (<code>FORBIDDEN</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "FORBIDDEN"
  },
  "isSuccess": false,
  "statusCode": 403,
  "message": "You do not have permission to perform this action."
}
```
</td>
        </tr>
        <tr>
            <td>404</td>
            <td>No such device (<code>NOT_FOUND</code>)</td>
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
        <tr>
            <td>409</td>
            <td>Node or MAC used by another device (<code>NODE_NUM_TAKEN</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "NODE_NUM_TAKEN"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "Node !a4b1c2d3 is already registered to TL-0017."
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
    A1["Check JWT, update policy on Device"]
    S --> A1
    D2{"Invalid?"}
    A1 --> D2
    E2["Return 400"]
    D2 -->|yes| E2
    E2 --> X2((End))
    D3{"Not found?"}
    D2 -->|no| D3
    E3["Return 404"]
    D3 -->|yes| E3
    E3 --> X3((End))
    D4{"Unique clash?"}
    D3 -->|no| D4
    E4["Return 409"]
    D4 -->|yes| E4
    E4 --> X4((End))
    A5["Update, audit before and after"]
    D4 -->|no| A5
    OK["Return 200"]
    A5 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Controller as DevicesController
    participant Service as DevicesService
    participant DB as Postgres
    Client->>Controller: PATCH /api/devices/{id}
    Controller->>Service: update(id, dto, actor)
    Service->>DB: UPDATE devices
    Controller-->>Client: 200 envelope
```
