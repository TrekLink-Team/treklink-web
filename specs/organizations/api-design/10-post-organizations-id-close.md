# POST /api/organizations/:id/close: Close an organization

> Module `organizations`. Generated from `scripts/specs/endpoints/organizations.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Closes an `ACTIVE` organization that has no open contract; its members are deactivated and its API keys and Field Station credentials revoked, in the same transaction. Rentals answers through the `ORGANIZATION_EXIT_CHECKS` port; the row is held `FOR UPDATE`, so a contract request that holds it `FOR SHARE` either commits first and is counted, or waits and then sees `CLOSED`.

## API Specification

| API | URL |
| --- | --- |
| POST | /api/organizations/:id/close |
| Permission | TrekLink Admin |
| Traces | UC-07, D-035 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Organization id; members may use only their own | uuid | `5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f` |

## Request sample

```json
{
  "reason": "Customer request",
  "expectedVersion": 3
}
```

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| reason | Reason | string | yes | `Stopped trading` |
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
    "status": "CLOSED",
    "statusChangedAt": "2026-10-20T03:15:00.000Z",
    "verifiedAt": "2026-10-20T03:15:00.000Z",
    "decidedAt": "2026-10-20T03:15:00.000Z",
    "channelKeyVersion": 1,
    "channelKeyExposedAt": null,
    "version": 3
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "Organization closed"
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
            <td>The organization is not in a state that allows this (<code>INVALID_STATE_TRANSITION</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "INVALID_STATE_TRANSITION"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "This cannot be done while it is SUSPENDED."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>A contract is not CLOSED, REJECTED or CANCELLED (<code>OPEN_CONTRACTS</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "OPEN_CONTRACTS"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "This cannot be done while it has open contracts."
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
    D3{"The organization is not in a state that allows this?"}
    D2 -->|no| D3
    E3["Return 409 INVALID_STATE_TRANSITION"]
    D3 -->|yes| E3
    E3 --> X3((End))
    D4{"A contract is not CLOSED, REJECTED or CANCELLED?"}
    D3 -->|no| D4
    E4["Return 409 OPEN_CONTRACTS"]
    D4 -->|yes| E4
    E4 --> X4((End))
    D5{"Another user changed the record first (expectedVersion differs)?"}
    D4 -->|no| D5
    E5["Return 409 STALE_VERSION"]
    D5 -->|yes| E5
    E5 --> X5((End))
    P0["Lock the organization row"]
    D5 -->|no| P0
    P1["Require ACTIVE"]
    P0 --> P1
    P2["Ask each ORGANIZATION_EXIT_CHECKS provider canClose"]
    P1 --> P2
    P3["Move to CLOSED, write the transition"]
    P2 --> P3
    P4["Deactivate members, revoke API keys and Field Stations"]
    P3 --> P4
    OK["Return 200"]
    P4 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor U as TrekLink Admin
    participant Ctl as OrganizationStatusController
    participant Svc as OrganizationStatusService
    participant L as OrganizationLifecycle
    participant R as OrganizationsRepository
    participant X as ORGANIZATION_EXIT_CHECKS (rentals provider)
    participant A as AccountsService
    U->>Ctl: POST /api/organizations/:id/close
    Ctl->>Svc: close(id, reason, expectedVersion, caller)
    Svc->>L: transition(id, CLOSED, input with guard, tx)
    L->>R: lockById(id, tx) FOR UPDATE
    R-->>L: organization ACTIVE
    L->>Svc: guard(current, tx)
    Svc->>X: canClose(id, tx)
    X-->>Svc: blocking reason or null
    alt refused: a contract is not finished
        Svc-->>Ctl: 409 OPEN_CONTRACTS, rollback
        Ctl-->>U: 409 envelope
    else accepted: no open contract
        L->>R: update(id, expectedVersion, CLOSED, tx)
        L->>R: addTransition(ACTIVE to CLOSED, actorId, reason, tx)
        L-->>Svc: organization CLOSED
        Svc->>A: deactivateOrganizationAccount(userId, reason, caller, tx) per member
        Svc->>R: markDeactivated, revokeAllActive API keys and Field Stations (tx)
        Svc->>R: COMMIT, then member.deactivated, apiKey.revoked, fieldStation.revoked, audit.record
        Svc-->>Ctl: organization CLOSED
        Ctl-->>U: 200 envelope
    end
```

Not drawn in the sequence: 400 VALIDATION_FAILED, 403 FORBIDDEN, 404 NOT_FOUND, 409 INVALID_STATE_TRANSITION and 409 STALE_VERSION, which the Validation table and the activity diagram carry. The billing provider answers null to canClose.
