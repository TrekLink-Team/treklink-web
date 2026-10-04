# POST /api/organizations/:id/approve: Approve an organization

> Module `organizations`. Generated from `scripts/specs/endpoints/organizations.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Moves a verified organization to `ACTIVE` and emails the Manager (MSG05). An unverified organization is refused (FR-ORG-03, MSG21).

## API Specification

| API | URL |
| --- | --- |
| POST | /api/organizations/:id/approve |
| Permission | TrekLink Admin |
| Traces | UC-03, FR-ORG-03, BR-01, MSG05, MSG21 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Organization id; members may use only their own | uuid | `5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f` |

## Request sample

```json
{
  "expectedVersion": 1
}
```

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| expectedVersion | Version the caller saw; mismatch returns 409 | int | yes | `3` |

## Response sample

```json
{
  "result": {
    "id": "5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f",
    "code": "ORG-0007",
    "legalName": "ACME Trek Co., Ltd.",
    "taxCode": "0312345678",
    "address": "12 Nguyen Hue, District 1, Ho Chi Minh City",
    "contactEmail": "ops@acme-trek.vn",
    "contactPhone": "0281234567",
    "status": "ACTIVE",
    "statusChangedAt": "2026-10-20T03:15:00.000Z",
    "verifiedAt": "2026-10-20T03:15:00.000Z",
    "decidedAt": "2026-10-20T03:15:00.000Z",
    "channelKeyVersion": 1,
    "version": 3
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "Organization approved"
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
  "message": "Organization not found."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>No verification is recorded (<code>NOT_VERIFIED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "NOT_VERIFIED"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "Verify this organization at the counter before approving it."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>The organization is not in a state that allows this (<code>INVALID_STATE_TRANSITION</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "INVALID_STATE_TRANSITION"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "This cannot be done while it is REJECTED."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>Another user changed the record first (expectedVersion differs) (<code>STALE_VERSION</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "STALE_VERSION"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "This was changed by someone else. Reload and try again."
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
    D3{"No verification is recorded?"}
    D2 -->|no| D3
    E3["Return 409 NOT_VERIFIED"]
    D3 -->|yes| E3
    E3 --> X3((End))
    D4{"The organization is not in a state that allows this?"}
    D3 -->|no| D4
    E4["Return 409 INVALID_STATE_TRANSITION"]
    D4 -->|yes| E4
    E4 --> X4((End))
    D5{"Another user changed the record first (expectedVersion differs)?"}
    D4 -->|no| D5
    E5["Return 409 STALE_VERSION"]
    D5 -->|yes| E5
    E5 --> X5((End))
    P0["Require PENDING and verified"]
    D5 -->|no| P0
    P1["Move to ACTIVE, write the transition"]
    P0 --> P1
    P2["Email the Manager"]
    P1 --> P2
    OK["Return 200"]
    P2 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant Ctl as OrganizationsController
    participant Svc as OrganizationsService
    participant DB as Postgres
    participant Mail as Email service
    C->>Ctl: POST /api/organizations/:id/approve
    Ctl->>Svc: approve(id, dto, actor)
    Svc->>DB: UPDATE organizations, INSERT organization_transitions
    Svc-)Mail: MSG05
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
