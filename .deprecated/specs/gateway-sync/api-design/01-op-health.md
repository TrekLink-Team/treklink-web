# POST /api/gateway-sync: op health

> Module `gateway-sync`. Format: `02-templates/04-api-endpoint-template.md`, with Mermaid in place of PlantUML (D-017). Envelope: D-002.

[TOC]

---
## Overview

Broker connectivity, ingress adapter status, per-gateway last-packet age and stale flag, and per-device queue depth and buffering state from the Stage B health reports. Feeds the gateway connectivity indicator (E04-2) and the buffering badge (E04-1).

## API Specification

| API        | URL             |
| ---------- | --------------- |
| POST | /api/gateway-sync |
| Permission | Operator, Admin |
| Operation | `op: "health"` |
| Dispatch | Single route per module; policy resolved per `op` inside dispatch (design §4) |
| Traces | US-049, REQ-ERR-10, REQ-EVT-12, REQ-EVT-13, REQ-EVT-14, E04-1, E04-2 |

## Request sample

```json
{
  "op": "health"
}
```

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| op | Literal `health` | string | yes | `health` |

## Response sample

```json
{
  "result": {
    "broker": {
      "connected": true,
      "since": "2026-10-10T00:01:12Z"
    },
    "adapters": [
      {
        "path": "MQTT_NODE",
        "running": true
      }
    ],
    "gateways": [
      {
        "gatewayKey": "!a4b1c2d3",
        "ingress": "MQTT_NODE",
        "lastPacketAt": "2026-10-10T05:12:40Z",
        "ageSeconds": 18,
        "stale": false
      }
    ],
    "devices": [
      {
        "deviceId": "0d3f...",
        "assetTag": "TL-0042",
        "buffering": true,
        "depth": [
          0,
          3,
          11,
          20
        ],
        "shed": [
          0,
          0,
          0,
          4
        ],
        "p0Refused": 0,
        "rebootDetected": false,
        "reportedAt": "2026-10-10T05:10:00Z"
      }
    ]
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "Gateway health retrieved"
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
            <td>`op` missing or not registered (<code>UNKNOWN_OPERATION</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "UNKNOWN_OPERATION"
  },
  "isSuccess": false,
  "statusCode": 400,
  "message": "Unknown operation: listEvent."
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
    </tbody>
</table>

## Activity Diagram

```mermaid
flowchart TB
    S((Start))
    A1["JwtAuthGuard"]
    S --> A1
    D2{"op unknown?"}
    A1 --> D2
    E2["Return 400 UNKNOWN_OPERATION"]
    D2 -->|yes| E2
    E2 --> X2((End))
    D3{"Op policy denies?"}
    D2 -->|no| D3
    E3["Return 403"]
    D3 -->|yes| E3
    E3 --> X3((End))
    A4["Read adapter state, gateways, latest queue reports"]
    D3 -->|no| A4
    OK["Return 200"]
    A4 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Controller as GatewaySyncController
    participant Reg as OperationRegistry
    participant Op as Operation
    participant DB as Postgres
    Client->>Controller: POST /api/gateway-sync {op, ...}
    Controller->>Controller: JwtAuthGuard
    Controller->>Reg: resolve(op)
    alt unknown op
      Reg-->>Controller: 400 UNKNOWN_OPERATION
    end
    Reg->>Reg: evaluate op policy before handle()
    alt denied
      Reg-->>Controller: 403 FORBIDDEN
    end
    Reg->>Op: handle(params, actor)
    Op->>DB: gateways, latest device_queue_reports
    Op-->>Controller: HealthDto
    Controller-->>Client: 200 envelope
```
