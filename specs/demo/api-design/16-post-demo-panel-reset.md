# POST /api/demo/panel/reset: Reseed the demo database

> Module `demo`. Generated from `scripts/specs/endpoints/demo.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Wipes the demo data and loads the standard demo seed, only on the dedicated Neon demo branch named by `DEMO_DATABASE_HOST` with `DEMO_RESET_ENABLED` on, the typed confirmation `RESET DEMO DATA`, and no reseed in the last five minutes. Data only: no migration and no schema statement. The audit entry `demo.panel.reset` is written after the seed, so it is kept after the wipe. Every window must sign in again.

## API Specification

| API | URL |
| --- | --- |
| POST | /api/demo/panel/reset |
| Permission | Public (demo panel password header `X-Demo-Panel-Password`) |
| Traces | D-110 rule 4, REQ-PNL-09, REQ-PNL-12 |

## Request sample

```json
{
  "confirmation": "RESET DEMO DATA"
}
```

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| confirmation | Exactly `RESET DEMO DATA` | string | yes | `RESET DEMO DATA` |

## Response sample

```json
{
  "result": {
    "resetAt": "2026-10-20T03:15:00.000Z",
    "tables": 61,
    "seedGroups": 24
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "Demo data reseeded"
}
```

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| tables | Tables whose rows were deleted | int | `61` |
| seedGroups | Row groups the demo seed created | int | `24` |

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
            <td>The panel password header is missing or wrong (<code>DEMO_PANEL_PASSWORD_INVALID</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "DEMO_PANEL_PASSWORD_INVALID"
  },
  "isSuccess": false,
  "statusCode": 401,
  "message": "Enter the panel password."
}
```
</td>
        </tr>
        <tr>
            <td>404</td>
            <td>`DEMO_PANEL_PASSWORD_HASH` is unset or does not parse: the route does not exist (<code>NOT_FOUND</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "NOT_FOUND"
  },
  "isSuccess": false,
  "statusCode": 404,
  "message": "Cannot GET /api/demo/panel"
}
```
</td>
        </tr>
        <tr>
            <td>429</td>
            <td>Five wrong or missing passwords from this address within ten minutes (<code>RATE_LIMITED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "RATE_LIMITED"
  },
  "isSuccess": false,
  "statusCode": 429,
  "message": "Too many wrong panel passwords. Try again after 10:25."
}
```
</td>
        </tr>
        <tr>
            <td>403</td>
            <td>`DEMO_RESET_ENABLED` is not `true` (<code>DEMO_DISABLED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "DEMO_DISABLED"
  },
  "isSuccess": false,
  "statusCode": 403,
  "message": "The demo reseed is off on this deployment."
}
```
</td>
        </tr>
        <tr>
            <td>403</td>
            <td>The database host is not exactly `DEMO_DATABASE_HOST`, or a URL carries a target override (<code>DEMO_DATABASE_NOT_ALLOWED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "DEMO_DATABASE_NOT_ALLOWED"
  },
  "isSuccess": false,
  "statusCode": 403,
  "message": "The reseed runs only on the dedicated demo database."
}
```
</td>
        </tr>
        <tr>
            <td>400</td>
            <td>The confirmation is not `RESET DEMO DATA` (<code>VALIDATION_FAILED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "VALIDATION_FAILED"
  },
  "isSuccess": false,
  "statusCode": 400,
  "message": "Type RESET DEMO DATA to confirm."
}
```
</td>
        </tr>
        <tr>
            <td>429</td>
            <td>A reseed ran less than five minutes ago (<code>RATE_LIMITED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "RATE_LIMITED"
  },
  "isSuccess": false,
  "statusCode": 429,
  "message": "A reseed ran at 10:20. Try again after 10:25."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>Another reseed or a playback is running (<code>DEMO_BUSY</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "DEMO_BUSY"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "A demo action is already running. Try again in a moment."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>A `SEED_*_PASSWORD` is missing or the seed is not in this build (<code>DEMO_SEED_NOT_CONFIGURED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "DEMO_SEED_NOT_CONFIGURED"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "The demo seed is not in this build."
}
```
</td>
        </tr>
        <tr>
            <td>500</td>
            <td>The wipe or the seed failed after the lock was taken; the audit entry names the error (<code>INTERNAL_ERROR</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "INTERNAL_ERROR"
  },
  "isSuccess": false,
  "statusCode": 500,
  "message": "Internal server error"
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
    A0["Accept request: no account, no token"]
    S --> A0
    H{"Panel password hash unset or malformed?"}
    A0 --> H
    HE["Return 404 NOT_FOUND: the route does not exist"]
    H -->|yes| HE
    HE --> HX((End))
    L{"Five attempts from this address in ten minutes already?"}
    H -->|no| L
    LE["Return 429 RATE_LIMITED, no compare"]
    L -->|yes| LE
    LE --> LX((End))
    R["Reserve this attempt before the compare"]
    L -->|no| R
    P{"Panel password missing or wrong?"}
    R --> P
    PE["Return 401 DEMO_PANEL_PASSWORD_INVALID, the attempt stays counted"]
    P -->|yes| PE
    PE --> PX((End))
    G["Give this attempt back"]
    P -->|no| G
    C0{"Body fails validation?"}
    G --> C0
    CE0["Return 400 VALIDATION_FAILED"]
    C0 -->|yes| CE0
    CE0 --> CX0((End))
    C1{"DEMO_RESET_ENABLED is not true?"}
    C0 -->|no| C1
    CE1["Return 403 DEMO_DISABLED"]
    C1 -->|yes| CE1
    CE1 --> CX1((End))
    C2{"Database host is not exactly DEMO_DATABASE_HOST, or a URL carries a target override?"}
    C1 -->|no| C2
    CE2["Return 403 DEMO_DATABASE_NOT_ALLOWED"]
    C2 -->|yes| CE2
    CE2 --> CX2((End))
    C3{"Confirmation is not RESET DEMO DATA?"}
    C2 -->|no| C3
    CE3["Return 400 VALIDATION_FAILED"]
    C3 -->|yes| CE3
    CE3 --> CX3((End))
    C4{"A reseed ran less than five minutes ago?"}
    C3 -->|no| C4
    CE4["Return 429 RATE_LIMITED"]
    C4 -->|yes| CE4
    CE4 --> CX4((End))
    C5{"A reseed, a playback or a panel action is running?"}
    C4 -->|no| C5
    CE5["Return 409 DEMO_BUSY"]
    C5 -->|yes| CE5
    CE5 --> CX5((End))
    C6{"Seed not in this build or a SEED password unset?"}
    C5 -->|no| C6
    CE6["Return 409 DEMO_SEED_NOT_CONFIGURED"]
    C6 -->|yes| CE6
    CE6 --> CX6((End))
    T0["Take the panel lock: panel actions now answer 409"]
    C6 -->|no| T0
    T1["Check the URL Prisma reads and current_database()"]
    T0 --> T1
    T2["Wipe the data in one transaction, no DDL, then run the demo seed"]
    T1 --> T2
    F2{"The live database check, the wipe or the seed failed?"}
    T2 --> F2
    FF2["finally: emit audit demo.panel.reset with the error, release the lock"]
    F2 -->|yes| FF2
    FR2["Return 403 DEMO_DATABASE_NOT_ALLOWED for the database check, otherwise 500"]
    FF2 --> FR2
    FR2 --> FX2((End))
    T3["finally: emit audit demo.panel.reset, release the lock"]
    F2 -->|no| T3
    OK["Return 200"]
    T3 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant Ctl as DemoPanelController
    participant Svc as DemoPanelResetService
    participant DB as Postgres
    C->>Ctl: POST /api/demo/panel/reset
    Note over Ctl,Svc: Route guard calls DemoPanelGuard: failure limit, then the password in constant time before DTO validation
    Note over Ctl: Global ValidationPipe validates body before the controller handler
    Ctl->>Svc: reset(dto, client)
    Svc->>DB: BEGIN, UPDATE business_parameters, TRUNCATE ... RESTART IDENTITY, DELETE FROM users, COMMIT
    Svc->>DB: seedDemo (own transaction)
    Svc-)Svc: emit audit.record
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
