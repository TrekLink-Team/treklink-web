# POST /api/organizations/:id/api-keys/:keyId/revoke: Revoke an API key

> Module `organizations`. Generated from `scripts/specs/endpoints/organizations.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Revokes a key; the next request with it gets 401 and an open stream with it is closed.

## API Specification

| API | URL |
| --- | --- |
| POST | /api/organizations/:id/api-keys/:keyId/revoke |
| Permission | Org Manager: own |
| Traces | UC-06, FR-ORG-06, E04-5 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Organization id; members may use only their own | uuid | `5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f` |
| keyId | Key id | uuid | `k-1` |

## Request sample

No body.

## Response sample

```json
{
  "result": {
    "id": "k-1",
    "name": "ERP integration",
    "prefix": "tlk_7Hc2",
    "createdAt": "2026-10-20T03:15:00.000Z",
    "lastUsedAt": null,
    "revokedAt": "2026-10-20T03:15:00.000Z"
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "API key revoked"
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
  "message": "API key not found."
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
    P0["Set revokedAt and revokedBy"]
    D1 -->|no| P0
    P1["Emit apiKey.revoked (monitoring closes its sockets)"]
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
    participant Ctl as ApiKeysController
    participant Svc as ApiKeysService
    participant DB as Postgres
    C->>Ctl: POST /api/organizations/:id/api-keys/:keyId/revoke
    Ctl->>Svc: revoke(orgId, keyId, actor)
    Svc->>DB: UPDATE api_keys
    Svc-)Svc: emit apiKey.revoked
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
