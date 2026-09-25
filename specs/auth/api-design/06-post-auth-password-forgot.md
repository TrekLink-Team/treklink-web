# POST /api/auth/password/forgot: Request a password reset code

> Module `auth`. Format: `02-templates/04-api-endpoint-template.md`, with Mermaid in place of PlantUML (D-017). Envelope: D-002.

[TOC]

---
## Overview

Sends a PASSWORD_RESET OTP to the registered email of the account named by `identifier`. The response is identical whether or not the account exists or has an email.

## API Specification

| API        | URL             |
| ---------- | --------------- |
| POST | /api/auth/password/forgot |
| Permission | Public |
| Rate limit | 5 requests per IP per 10 minutes |
| Traces | UC-28 (new), FR-AUTH-05 (new), US-007, REQ-EVT-07, REQ-ERR-09, Q35 |

## Request sample

```json
{
  "identifier": "name123"
}
```

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| identifier | Username or email | string | yes | `name123` |

## Response sample

```json
{
  "result": null,
  "isSuccess": true,
  "statusCode": 200,
  "message": "If the account exists, a reset code has been sent to its registered email."
}
```

## Validation

<table>
    <th>Status code</th>
    <th>Description</th>
    <th>Examples</th>
    <tbody>
        <tr>
            <td>429</td>
            <td>Requested again inside the cooldown (<code>OTP_COOLDOWN</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "OTP_COOLDOWN"
  },
  "isSuccess": false,
  "statusCode": 429,
  "message": "Please wait before requesting another code."
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
    A1["Find account by identifier"]
    S --> A1
    D2{"Inside cooldown?"}
    A1 --> D2
    E2["Return 429 OTP_COOLDOWN"]
    D2 -->|yes| E2
    E2 --> X2((End))
    A3["If account has email, insert code and send"]
    D2 -->|no| A3
    A4["Audit auth.password.forgot"]
    A3 --> A4
    OK["Return 200 with the neutral message"]
    A4 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Controller as AuthController
    participant Service as AuthService
    participant DB as Postgres
    participant M as MailPort
    Client->>Controller: POST /api/auth/password/forgot
    Controller->>Service: forgot(identifier)
    Service->>DB: SELECT user
    opt user exists with email
      Service->>DB: INSERT one_time_code PASSWORD_RESET
      Service->>M: send code
    end
    Controller-->>Client: 200 neutral envelope
```
