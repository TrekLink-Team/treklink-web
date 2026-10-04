# POST /api/auth/password/set: Accept an invitation

> Module `auth`. Generated from `scripts/specs/endpoints/auth.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Sets the first password of an invited account (organization member, or TrekLink Staff created by an Admin) with the invitation code, and signs the user in.

## API Specification

| API | URL |
| --- | --- |
| POST | /api/auth/password/set |
| Permission | Public |
| Traces | UC-04, UC-10, FR-ORG-04, MSG08 |

## Request sample

```json
{
  "email": "operator@acme-trek.vn",
  "code": "739104",
  "password": "********"
}
```

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| email | Invited email | string | yes | `operator@acme-trek.vn` |
| code | Invitation code from the email | string | yes | `739104` |
| password | New password | string | yes | `********` |

## Response sample

```json
{
  "result": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "accessTokenExpiresIn": 900,
    "refreshToken": "rt_7Zq...opaque",
    "refreshTokenExpiresIn": 1209600,
    "user": {
      "id": "3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f",
      "email": "manager@acme-trek.vn",
      "fullName": "Nguyen Van A",
      "accountType": "ORGANIZATION",
      "roles": [
        "ORG_OPERATOR"
      ],
      "organization": {
        "id": "5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f",
        "code": "ORG-0007",
        "legalName": "ACME Trek Co., Ltd.",
        "status": "ACTIVE",
        "memberRole": "MANAGER"
      }
    }
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "Welcome to TrekLink"
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
            <td>400</td>
            <td>The code is wrong, expired, used or out of attempts (<code>CODE_INVALID</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "CODE_INVALID"
  },
  "isSuccess": false,
  "statusCode": 400,
  "message": "This code is invalid or has expired. Request a new one."
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
    A0["Accept request"]
    S --> A0
    D1{"The body or query fails validation?"}
    A0 --> D1
    E1["Return 400 VALIDATION_FAILED"]
    D1 -->|yes| E1
    E1 --> X1((End))
    D2{"The code is wrong, expired, used or out of attempts?"}
    D1 -->|no| D2
    E2["Return 400 CODE_INVALID"]
    D2 -->|yes| E2
    E2 --> X2((End))
    D3{"The new password breaks the policy (auth.passwordMinLength)?"}
    D2 -->|no| D3
    E3["Return 400 PASSWORD_POLICY"]
    D3 -->|yes| E3
    E3 --> X3((End))
    P0["Verify the SET_PASSWORD code"]
    D3 -->|no| P0
    P1["Store the bcrypt hash"]
    P0 --> P1
    P2["Record AuthEvent PASSWORD_SET"]
    P1 --> P2
    P3["Issue tokens"]
    P2 --> P3
    OK["Return 200"]
    P3 --> OK
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
    C->>Ctl: POST /api/auth/password/set
    Ctl->>Svc: setFirst(dto)
    Svc->>DB: UPDATE users, one_time_codes
    Svc->>DB: INSERT refresh_tokens
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
