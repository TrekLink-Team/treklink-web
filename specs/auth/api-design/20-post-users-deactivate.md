# POST /api/users/:id/deactivate: Deactivate an account

> Module `auth`. Envelope: D-002. TK-22, US-009.

[TOC]

---

## Overview

Deactivates another active account and invalidates every current session atomically. The target may hold `ADMIN` when another active Admin remains. Self-deactivation is forbidden. Repeating the request for an inactive account is an idempotent 200 response with no additional write.

## API Specification

| API | URL |
|---|---|
| POST | `/api/users/:id/deactivate` |
| Permission | Authenticated Admin with `can('update', 'User', ['isActive'])` |
| Traces | REQ-EVT-18, REQ-EVT-20, REQ-ERR-08, REQ-ERR-10 |

## Request sample

No request body.

## Response sample

```json
{
  "result": {
    "id": "5b7e2f0a-3c41-4d8e-9a12-6f0c2b9d1e01",
    "username": "tranb",
    "email": "tranb@mail.com",
    "fullName": "Tran Thi B",
    "phoneNumber": "0987654321",
    "accountType": "STAFF",
    "roles": ["GUIDE"],
    "isActive": false,
    "lastLoginAt": "2026-09-29T07:30:00Z",
    "createdAt": "2026-09-01T08:00:00Z",
    "updatedAt": "2026-09-29T08:00:00Z"
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "Account deactivated"
}
```

For an already inactive account, the message is `Account is already inactive` and the current account DTO is returned.

## Validation

| Status | Error code | Condition |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `id` is not a UUID |
| 401 | `UNAUTHENTICATED` | Access token is missing, malformed or expired |
| 403 | `FORBIDDEN` | Caller lacks the Admin status policy or targets their own account |
| 404 | `ACCOUNT_NOT_FOUND` | Account id does not exist or is soft-deleted |
| 409 | `LAST_ADMIN` | Deactivation would leave zero active Admins |

```json
{
  "result": { "errorCode": "FORBIDDEN" },
  "isSuccess": false,
  "statusCode": 403,
  "message": "An Admin cannot deactivate their own account."
}
```

## Activity Diagram

```mermaid
flowchart TB
    S((Start)) --> T[BEGIN: acquire shared last-Admin advisory lock, then target-row lock]
    T --> F{Non-deleted account found?}
    F -->|no| E1[404 ACCOUNT_NOT_FOUND]
    F -->|yes| I{Already inactive?}
    I -->|yes| O1[COMMIT and return 200 current state]
    I -->|no| A{Active target is caller?}
    A -->|yes| E2[403 FORBIDDEN]
    A -->|no| L{Would zero active Admins remain?}
    L -->|yes| E3[409 LAST_ADMIN]
    L -->|no| W[Set inactive, increment tokenVersion, revoke refresh tokens, COMMIT]
    W --> U[Emit redacted user.deactivate audit]
    U --> O2[Return 200 account envelope]
```

## Sequence Diagram

```mermaid
sequenceDiagram
    actor Admin
    participant Controller as UsersController
    participant Service as UsersService
    participant DB as Postgres
    Admin->>Controller: POST /api/users/{id}/deactivate
    Controller->>Service: deactivate(id, actor)
    Service->>DB: BEGIN and acquire shared last-Admin advisory lock
    Service->>DB: tx.$queryRaw lock non-deleted target FOR UPDATE
    Service->>DB: check current state, active-target self rule and active Admin count
    Service->>DB: set inactive, tokenVersion + 1, revoke refresh tokens, COMMIT
    Controller-->>Admin: 200 or error envelope
```
