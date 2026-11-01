# GET /api/map/snapshot: Live map snapshot

> Module `monitoring`. Generated from `scripts/specs/endpoints/monitoring.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

The initial state the live map draws before it subscribes: every unit of the scope's open contracts with its state, last plotted position, battery, holder label and open incident, plus the organization's Field Stations, and the stream cursor to subscribe from (FR-MON-02, FR-MON-03, FR-AUTH-11, D-092 rule 2). A unit is listed from handover until check-in or a confirmed loss, reporting or not. `state` is `LIVE` (heard since `handedOverAt` and within `monitoring.deviceStaleSeconds`), `OFFLINE` (heard since `handedOverAt`, silent longer) or `NOT_HEARD` (nothing heard since `handedOverAt`); `stale` is true for `OFFLINE` only. For an organization, `position` and `lastSeenAt` lie inside its custody interval or are null, so nothing from before the handover is sent (D-040), and a `NOT_HEARD` unit has no `batteryPct` either; TrekLink staff get the device's last position and last-seen time whatever the interval. `position.at` is the time of the reading that carried the position. `counterLocation` is `{ name, lat, lon }` of `monitoring.counterLocation` for a `NOT_HEARD` unit, where the map pins it, and null otherwise. `openIncident` is `{ id, code, state }` of the incident not yet CLOSED, shown to a member only when it is routed to the member's organization. `organizationId` lets the fleet map filter stream entries by organization in the client.

## API Specification

| API | URL |
| --- | --- |
| GET | /api/map/snapshot |
| Permission | Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin |
| Traces | UC-38, UC-41, FR-AUTH-11, FR-MON-02, FR-MON-03, BR-19, BR-21 |

### Query parameters

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| organizationId | TrekLink staff: one organization; omit for the fleet | uuid | no | `5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f` |

## Request sample

No body.

## Response sample

```json
{
  "result": {
    "cursor": 88213,
    "devices": [
      {
        "id": "0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10",
        "assetTag": "TL-0042",
        "hardwareVariant": "treklink-v3",
        "holder": {
          "name": "Le Thi E"
        },
        "position": {
          "lat": 11.5601,
          "lon": 108.5402,
          "at": "2026-10-20T03:15:00.000Z"
        },
        "batteryPct": 81,
        "lastSeenAt": "2026-10-20T03:15:00.000Z",
        "stale": false,
        "openIncident": null,
        "contractCode": "RC-2026-0042",
        "state": "LIVE",
        "handedOverAt": "2026-10-19T01:30:00.000Z",
        "counterLocation": null,
        "organizationId": "5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f"
      },
      {
        "id": "6a0e4c1f-2b8d-4e37-9a51-7c3f0d2e8b14",
        "assetTag": "TL-0043",
        "hardwareVariant": "treklink-v3",
        "holder": null,
        "position": null,
        "batteryPct": null,
        "lastSeenAt": null,
        "stale": false,
        "openIncident": null,
        "contractCode": "RC-2026-0042",
        "state": "NOT_HEARD",
        "handedOverAt": "2026-10-19T01:30:00.000Z",
        "counterLocation": {
          "name": "TrekLink counter",
          "lat": 11.56,
          "lon": 108.54
        },
        "organizationId": "5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f"
      }
    ],
    "fieldStations": [
      {
        "id": "f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a5b",
        "name": "Ta Nang basecamp laptop",
        "lastSyncAt": "2026-10-20T03:15:00.000Z",
        "stale": false
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
    P0["Resolve the caller's scope"]
    D1 -->|no| P0
    P1["Read the units in custody with their handover times"]
    P0 --> P1
    P2["Read projections of those units"]
    P1 --> P2
    P3["Derive each state and clip positions to the custody interval"]
    P2 --> P3
    P4["Read the current stream cursor"]
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
    participant Ctl as MapController
    participant Svc as LiveMapService
    participant DB as Postgres
    participant Rent as RentalsService
    participant Dev as DevicesService
    participant Inc as IncidentsService
    C->>Ctl: GET /api/map/snapshot
    Ctl->>Svc: snapshot(query, caller)
    Svc->>DB: SELECT max(seq) FROM stream_events
    Svc->>Rent: visibleDevices(caller)
    Svc->>DB: SELECT business_parameters (deviceStaleSeconds, counterLocation)
    Svc->>Dev: projections(ids)
    Svc->>Inc: openByDevices(ids)
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
