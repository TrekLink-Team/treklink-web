# GET /api/telemetry/devices: Organization API: devices and last state

> Module `monitoring`. Generated from `scripts/specs/endpoints/monitoring.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

For the organization's own system: every unit of its open contracts, from handover until check-in or a confirmed loss, reporting or not, with its state, last position, battery, holder label and open incident (UC-39, D-092 rule 2). `state` and the readings follow the organization's map snapshot ([02-get-map-snapshot.md](02-get-map-snapshot.md)) for the same unit at the same time: `LIVE` (heard since the handover and within `monitoring.deviceStaleSeconds`), `OFFLINE` (heard since the handover, silent longer) or `NOT_HEARD` (nothing heard since the handover); `stale` is true for `OFFLINE` only. `position`, `batteryPct` and `lastSeenAt` lie inside the organization's custody interval or are null, so a `NOT_HEARD` unit has all three null and nothing from before the handover is sent (D-040). `position.at` is the time of the reading that carried the position. `openIncident` is shown only when the incident is routed to the key's organization. Authenticated by `X-Api-Key`, read-only, rate limited (`monitoring.apiRateLimitPerMinute`, E04-5).

## API Specification

| API | URL |
| --- | --- |
| GET | /api/telemetry/devices |
| Permission | Organization API key |
| Traces | UC-39, FR-AUTH-11, FR-MON-06, FR-ORG-06, BR-20, D-040 |

### Query parameters

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| X-Api-Key | Organization API key (read-only) | string | yes | `tlk_7Hc2...` |

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
        "state": "LIVE"
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
        "state": "NOT_HEARD"
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
        <tr>
            <td>429</td>
            <td>More requests than the key's limit (<code>RATE_LIMITED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "RATE_LIMITED"
  },
  "isSuccess": false,
  "statusCode": 429,
  "message": "Too many requests. Retry after 12 seconds."
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
    D2{"More requests than the key's limit?"}
    D1 -->|no| D2
    E2["Return 429 RATE_LIMITED"]
    D2 -->|yes| E2
    E2 --> X2((End))
    P0["Hash and look up the key, record lastUsedAt"]
    D2 -->|no| P0
    P1["Apply the rate limit"]
    P0 --> P1
    P2["Read the units in custody with their handover times"]
    P1 --> P2
    P3["Read projections of those units"]
    P2 --> P3
    P4["Derive each state and clip the readings to the custody interval"]
    P3 --> P4
    OK["Return 200"]
    P4 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor C as Organization system
    participant Ctl as OrgApiController
    participant Svc as OrgApiService
    participant DB as Postgres
    participant Org as OrganizationsService
    participant Rent as RentalsService
    participant Dev as DevicesService
    participant Inc as IncidentsService
    C->>Ctl: GET /api/telemetry/devices
    Ctl->>Svc: devicesOf(organizationId)
    Svc->>Org: resolveApiKey(key)
    Svc->>DB: SELECT max(seq) FROM stream_events
    Svc->>Rent: visibleDevices(organizationId)
    Svc->>Dev: projections(ids)
    Svc->>Inc: openByDevices(ids)
    Svc->>DB: SELECT business_parameters (deviceStaleSeconds)
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
