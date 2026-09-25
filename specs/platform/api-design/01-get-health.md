# GET /api/health: Liveness and readiness

> Module `platform`. Format: `02-templates/04-api-endpoint-template.md`, with Mermaid in place of PlantUML (D-017). Envelope: D-002.

[TOC]

---
## Overview

Reports process liveness plus database and MQTT broker reachability. Used by Docker health checks, the CD smoke test and the Admin system-health view. Public so an orchestrator can probe it without a token; it exposes no data beyond component state.

## API Specification

| API        | URL             |
| ---------- | --------------- |
| GET | /api/health |
| Permission | Public |
| Traces | US-077, FR-ADM-03, platform REQ-EVT-04 |

## Request sample

No request body.

## Response sample

```json
{
  "result": {
    "status": "ok",
    "uptimeSeconds": 5234,
    "components": {
      "database": "up",
      "mqtt": "up"
    },
    "version": "0.1.0"
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "Healthy"
}
```

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| status | `ok` when every component is up, `degraded` when MQTT is down, `down` when the database is down | string | `ok` |
| components.database | Result of `SELECT 1` within 2 s | string | `up` |
| components.mqtt | Broker connection state of the ingress adapter | string | `up` |
| version | Backend package version | string | `0.1.0` |

## Validation

<table>
    <th>Status code</th>
    <th>Description</th>
    <th>Examples</th>
    <tbody>
        <tr>
            <td>503</td>
            <td>Database unreachable (<code>SERVICE_UNAVAILABLE</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "SERVICE_UNAVAILABLE"
  },
  "isSuccess": false,
  "statusCode": 503,
  "message": "Database unreachable."
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
    A1["Probe database with SELECT 1"]
    S --> A1
    D2{"Database down?"}
    A1 --> D2
    E2["Return 503 SERVICE_UNAVAILABLE"]
    D2 -->|yes| E2
    E2 --> X2((End))
    A3["Read MQTT adapter state"]
    D2 -->|no| A3
    OK["Return 200 with component states"]
    A3 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Probe
    participant Controller as HealthController
    participant DB as Postgres
    participant MQ as MqttIngressAdapter
    Probe->>Controller: GET /api/health
    Controller->>DB: SELECT 1
    alt timeout or error
      Controller-->>Probe: 503 SERVICE_UNAVAILABLE
    end
    Controller->>MQ: isConnected()
    MQ-->>Controller: true or false
    Controller-->>Probe: 200 status ok or degraded
```
