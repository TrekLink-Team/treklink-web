# GET /api/telemetry/stream: Organization API: replay the stream

> Module `monitoring`. Generated from `scripts/specs/endpoints/monitoring.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Returns the organization's stream entries after a cursor (positions, telemetry, staleness and incident changes), oldest first, at most `limit`. A client polls with its last cursor, or uses the WebSocket for push ([ws-live-contract.md](ws-live-contract.md)). A cursor older than the retention window answers 410 and the client re-reads the snapshot (FR-MON-05, FR-MON-06).

## API Specification

| API | URL |
| --- | --- |
| GET | /api/telemetry/stream |
| Permission | Organization API key |
| Traces | UC-39, FR-MON-05, FR-MON-06, E04-3 |

### Query parameters

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| X-Api-Key | Organization API key (read-only) | string | yes | `tlk_7Hc2...` |
| after | Last cursor seen | int | yes | `88213` |
| limit | At most 500 | int | no | `200` |

## Request sample

No body.

## Response sample

```json
{
  "result": {
    "entries": [
      {
        "seq": 88214,
        "type": "device.position",
        "deviceId": "0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10",
        "payload": {
          "lat": 11.5603,
          "lon": 108.5405,
          "at": "2026-10-20T03:15:00.000Z"
        },
        "createdAt": "2026-10-20T03:15:00.000Z"
      },
      {
        "seq": 88215,
        "type": "incident.changed",
        "deviceId": "0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10",
        "payload": {
          "incidentId": "7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d",
          "state": "NOTIFY_PRIMARY"
        },
        "createdAt": "2026-10-20T03:15:00.000Z"
      }
    ],
    "nextCursor": 88215,
    "hasMore": false
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
            <td>410</td>
            <td>The cursor is older than monitoring.streamRetentionHours (<code>CURSOR_EXPIRED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "CURSOR_EXPIRED"
  },
  "isSuccess": false,
  "statusCode": 410,
  "message": "The cursor has expired. Reload the snapshot."
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
    D2{"The cursor is older than monitoring.streamRetentionHours?"}
    D1 -->|no| D2
    E2["Return 410 CURSOR_EXPIRED"]
    D2 -->|yes| E2
    E2 --> X2((End))
    D3{"More requests than the key's limit?"}
    D2 -->|no| D3
    E3["Return 429 RATE_LIMITED"]
    D3 -->|yes| E3
    E3 --> X3((End))
    P0["Resolve the key"]
    D3 -->|no| P0
    P1["Check retention"]
    P0 --> P1
    P2["Read stream_events WHERE organizationId AND seq > after"]
    P1 --> P2
    OK["Return 200"]
    P2 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor C as Organization system
    participant Ctl as OrgApiController
    participant Svc as StreamService
    participant DB as Postgres
    C->>Ctl: GET /api/telemetry/stream
    Ctl->>Svc: replay(apiKey, after, limit)
    Svc->>DB: SELECT stream_events ORDER BY seq LIMIT n
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
