# POST /api/auth/password/change: Change own password

> Module `auth`. Generated from `scripts/specs/endpoints/auth.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Changes the caller's password after checking the current one; other sessions are revoked.

## API Specification

| API | URL |
| --- | --- |
| POST | /api/auth/password/change |
| Permission | Any signed-in user |
| Traces | UC-08, FR-AUTH-02 |

## Request sample

```json
{
  "currentPassword": "********",
  "newPassword": "********"
}
```

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| currentPassword | Current password | string | yes | `********` |
| newPassword | New password | string | yes | `********` |

## Response sample

```json
{
  "result": null,
  "isSuccess": true,
  "statusCode": 200,
  "message": "Password changed"
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
            <td>400</td>
            <td>The current password is wrong (<code>INVALID_CREDENTIALS</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "INVALID_CREDENTIALS"
  },
  "isSuccess": false,
  "statusCode": 400,
  "message": "The current password is incorrect."
}
```
</td>
        </tr>
        <tr>
            <td>400</td>
            <td>The new password breaks the policy (auth.passwordMinLength) (<code>PASSWORD_POLICY</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "PASSWORD_POLICY"
  },
  "isSuccess": false,
  "statusCode": 400,
  "message": "password must be at least 8 characters."
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
    D2{"The current password is wrong?"}
    D1 -->|no| D2
    E2["Return 400 INVALID_CREDENTIALS"]
    D2 -->|yes| E2
    E2 --> X2((End))
    D3{"The new password breaks the policy (auth.passwordMinLength)?"}
    D2 -->|no| D3
    E3["Return 400 PASSWORD_POLICY"]
    D3 -->|yes| E3
    E3 --> X3((End))
    P0["Verify the current password"]
    D3 -->|no| P0
    P1["Store the new hash"]
    P0 --> P1
    P2["Revoke other refresh-token families"]
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
    participant Ctl as PasswordController
    participant Svc as PasswordService
    participant DB as Postgres
    C->>Ctl: POST /api/auth/password/change
    Ctl->>Svc: change(dto, caller)
    Svc->>DB: UPDATE users, refresh_tokens
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
