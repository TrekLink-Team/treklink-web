# POST /api/demo/panel/playback: Control the main flow playback

> Module `demo`. Generated from `scripts/specs/endpoints/demo.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Starts, pauses, resumes, steps or stops the scripted playback of one main flow. Steps come from `docs/demo/2026-11-22-scenario-playbook.md`; each executed step is one panel action (route 14) or a narration line. One playback runs at a time, held in the backend's memory. The panel never acts as an Admin (D-110 rule 8, 2026-11-25): at the MF-01a approval the run pauses with a waiting step and the prompt "Approve ORG-.... on the Admin screen", and runs on once the organization is Active or the operator presses RESUME or STEP, which records the step `SKIPPED` while the organization is still pending.

## API Specification

| API | URL |
| --- | --- |
| POST | /api/demo/panel/playback |
| Permission | Public (demo panel password header `X-Demo-Panel-Password`) |
| Traces | D-110 rule 3, REQ-PNL-08 |

## Request sample

```json
{
  "command": "START",
  "flow": "MF-03",
  "intervalSeconds": 10
}
```

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| command | `START`, `PAUSE`, `RESUME`, `STEP` or `STOP` | string | yes | `START` |
| flow | `MF-01a`, `MF-01b`, `MF-01c`, `MF-02`, `MF-03`, `MF-04` or `MF-05`; with `START` only | string | conditional | `MF-03` |
| intervalSeconds | Seconds between steps, 3 to 60; default 10; with `START` only | int | no | `10` |

## Response sample

```json
{
  "result": {
    "flow": "MF-03",
    "status": "PAUSED",
    "index": 1,
    "intervalSeconds": 10,
    "nextAt": null,
    "steps": [
      {
        "title": "SOS from TL-0010",
        "window": "Physical unit",
        "screen": "Gateway log",
        "status": "DONE",
        "prompt": null,
        "error": null,
        "records": []
      },
      {
        "title": "Operator acknowledges",
        "window": "C, Operator",
        "screen": "/o/incidents",
        "status": "PENDING",
        "prompt": null,
        "error": null,
        "records": []
      }
    ],
    "error": null
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "Playback updated"
}
```

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| steps[].status | `PENDING`, `RUNNING`, `WAITING` (a person does the step on a real screen), `DONE`, `SKIPPED` (the operator moved past a waiting step before its record was ready) or `FAILED` | string | `PENDING` |
| steps[].prompt | What to do on the real screen while the step is `WAITING`, otherwise null | string | `Approve ORG-0002 on the Admin screen ...` |

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
            <td>The database is neither allowed for the simulation nor the `DEMO_DATABASE_HOST` endpoint (<code>DEMO_DATABASE_NOT_ALLOWED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "DEMO_DATABASE_NOT_ALLOWED"
  },
  "isSuccess": false,
  "statusCode": 403,
  "message": "The demo panel writes only to a local, staging or demo database."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>`START` while a playback runs or a reseed is running (<code>DEMO_BUSY</code>)</td>
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
            <td>`PAUSE`, `RESUME`, `STEP` or `STOP` in a state that does not allow it (<code>INVALID_STATE_TRANSITION</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "INVALID_STATE_TRANSITION"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "This cannot be done while it is DONE."
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
    C1{"START while a reseed or a playback runs?"}
    C0 -->|no| C1
    CE1["Return 409 DEMO_BUSY"]
    C1 -->|yes| CE1
    CE1 --> CX1((End))
    C2{"START with an unknown flow or an interval outside 3 to 60?"}
    C1 -->|no| C2
    CE2["Return 400 VALIDATION_FAILED"]
    C2 -->|yes| CE2
    CE2 --> CX2((End))
    C3{"PAUSE, RESUME, STEP or STOP in a state that does not allow it?"}
    C2 -->|no| C3
    CE3["Return 409 INVALID_STATE_TRANSITION"]
    C3 -->|yes| CE3
    CE3 --> CX3((End))
    C4{"RESUME or STEP while a step is executing?"}
    C3 -->|no| C4
    CE4["Return 409 DEMO_BUSY"]
    C4 -->|yes| CE4
    CE4 --> CX4((End))
    T0["Apply the command to the in-memory run; RESUME or STEP at a waiting step confirms it"]
    C4 -->|no| T0
    T1["Schedule, run or clear the next step; a waiting step pauses and polls until its record is ready"]
    T0 --> T1
    OK["Return 200"]
    T1 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant Ctl as DemoPanelController
    participant Svc as DemoPanelPlayback
    participant DB as Postgres
    C->>Ctl: POST /api/demo/panel/playback
    Note over Ctl,Svc: Route guard calls DemoPanelGuard: failure limit, then the password in constant time before DTO validation
    Note over Ctl: Global ValidationPipe validates body before the controller handler
    Ctl->>Svc: command(dto, client)
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
