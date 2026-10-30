# GET /api/telemetry/devices/:id/history: Device position and telemetry history

> Module `monitoring`. Generated from `scripts/specs/endpoints/monitoring.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Positions and telemetry of one device over a period, clipped to the periods the caller's organization rented it (from handover to check-in). Unplotted implausible positions are excluded (FR-MON-07, FR-MON-04). An organization gets the events attributed to it; TrekLink Staff and Admin get the whole history, `UNATTRIBUTED` events included (REQ-EVT-06). `clippedTo` lists the periods the organization held the device that overlap the range, whole and not cut to the range, and is empty for Staff and Admin. A reversed range or one longer than `monitoring.historyMaxRangeDays` days answers 400 `to must be after from and at most {n} days later.`. `format=csv` returns the points as CSV text in `result`, with the header `at,kind,lat,lon,altitude,batteryPct`. At most `HISTORY_MAX_POINTS` (50,000, `field-event-query.service.ts`) points are answered, oldest first; a range holding more sets `truncated` and the caller narrows the range (the CSV carries the same first 50,000 points and ends with the comment row `# truncated`). The read trusts the attribution ingestion wrote on each event and does not re-check the custody intervals.

## API Specification

| API | URL |
| --- | --- |
| GET | /api/telemetry/devices/:id/history |
| Permission | Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin |
| Traces | UC-40, FR-AUTH-11, FR-MON-07, BR-19 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Device id | uuid | `0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10` |

### Query parameters

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| from | Inclusive start | datetime | yes | `2026-10-20T00:00:00Z` |
| to | Exclusive end, after from and at most `monitoring.historyMaxRangeDays` (7) days later | datetime | yes | `2026-10-21T00:00:00Z` |
| kind | `POSITION`, `TELEMETRY` or both | enum[] | no | `["POSITION"]` |
| format | `json` or `csv` | enum | no | `json` |

## Request sample

No body.

## Response sample

```json
{
  "result": {
    "deviceId": "0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10",
    "clippedTo": [
      {
        "from": "2026-10-20T02:00:00Z",
        "to": "2026-10-21T00:00:00Z"
      }
    ],
    "points": [
      {
        "at": "2026-10-20T03:15:00.000Z",
        "kind": "POSITION",
        "lat": 11.5601,
        "lon": 108.5402,
        "altitude": 1320,
        "batteryPct": 81
      }
    ],
    "truncated": false
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "OK"
}
```

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| clippedTo[] | Periods the caller's organization held the device that overlap the range; empty for Staff and Admin | object[] | see sample |
| points[] | Positions and telemetry by occurrence time, oldest first, at most 50,000 | object[] | see sample |
| truncated | True when the range holds more than 50,000 points and only the oldest 50,000 are answered | bool | `false` |

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
    P0["Resolve the scope: the caller's organization, or the whole fleet for TrekLink Staff and Admin"]
    D2 -->|no| P0
    P1["Check the range against monitoring.historyMaxRangeDays"]
    P0 --> P1
    P2["Organization: ask rentals for its rental periods of the device, none answers 404. Staff and Admin: require the device to exist"]
    P1 --> P2
    P3["Read the plotted points of the range from gateway-sync, at most 50,000"]
    P2 --> P3
    P4["Answer the points, or CSV text for format=csv"]
    P3 --> P4
    OK["Return 200"]
    P4 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant Ctl as TelemetryHistoryController
    participant Svc as HistoryService
    participant Prm as ParameterService
    participant Rent as ContractsService (rentals)
    participant Dev as DevicesService (devices)
    participant Ev as FieldEventQueryService (gateway-sync)
    participant DB as Postgres
    C->>Ctl: GET /api/telemetry/devices/:id/history
    Ctl->>Svc: history(id, query, caller, ability)
    Note over Svc: scopeOf(caller, ability) gives the caller's organization, or null for Staff and Admin
    Svc->>Prm: get('monitoring.historyMaxRangeDays')
    Prm-->>Svc: maxDays, a longer range answers 400
    alt an organization caller
        Svc->>Rent: rentalPeriods(deviceId, organizationId)
        Rent->>DB: SELECT contract_devices of the organization's contracts
        Rent-->>Svc: periods, none answers 404, the overlapping ones are clippedTo
    else TrekLink Staff or Admin
        Svc->>Dev: assetTags([deviceId])
        Dev-->>Svc: tag, an unknown device answers 404
    end
    Svc->>Ev: historyPoints(deviceId, organizationId, from, to, kinds)
    Ev->>DB: SELECT field_events in [from, to) without unplotted positions, oldest first, at most 50,001 rows
    Ev-->>Svc: points, truncated
    Svc-->>Ctl: HistoryDto
    Ctl->>Svc: csv(history), only for format=csv
    Svc-->>Ctl: CSV text
    Ctl-->>C: 200 envelope
```
