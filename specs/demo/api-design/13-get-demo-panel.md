# GET /api/demo/panel: Read the demo panel

> Module `demo`. Generated from `scripts/specs/endpoints/demo.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Returns what the panel needs: the action catalogue, the options the actions need, the playback state and whether a reseed is possible now. A 200 also tells the page that the typed password is right. No account and no policy: the panel password guards every panel route (D-110 rule 1).

## API Specification

| API | URL |
| --- | --- |
| GET | /api/demo/panel |
| Permission | Public (demo panel password header `X-Demo-Panel-Password`) |
| Traces | D-110, REQ-PNL-01, REQ-PNL-02, REQ-PNL-06, REQ-PNL-10, REQ-PNL-11 |

## Request sample

No body.

## Response sample

```json
{
  "result": {
    "writable": true,
    "reset": {
      "available": false,
      "reason": "The demo reseed is off on this deployment.",
      "nextAllowedAt": null
    },
    "actions": [
      {
        "id": "incident-acknowledge",
        "group": "Incidents",
        "label": "Acknowledge",
        "needs": [
          "recordId",
          "expectedVersion"
        ]
      }
    ],
    "options": {
      "incidents": [],
      "contracts": [],
      "invoices": [],
      "devices": [],
      "organizations": [],
      "variants": [],
      "flows": [
        "MF-01a",
        "MF-01b",
        "MF-01c",
        "MF-02",
        "MF-03",
        "MF-04",
        "MF-05"
      ]
    },
    "playback": {
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
          "error": null,
          "records": []
        },
        {
          "title": "Operator acknowledges",
          "window": "C, Operator",
          "screen": "/o/incidents",
          "status": "PENDING",
          "error": null,
          "records": []
        }
      ],
      "error": null
    }
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "OK"
}
```

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| writable | The database accepts panel writes: local, `treklink_prod` or the `DEMO_DATABASE_HOST` branch (REQ-PNL-13) | boolean | `true` |
| reset.available | Every reseed check that needs no input passes now (REQ-PNL-12) | boolean | `false` |
| reset.reason | The first failing check, or null | string | see sample |
| actions[].needs | Body fields the action requires | array | see sample |
| options.incidents | Open, resolved and false-alarm incidents with code, state, version, device | array | `[]` |
| options.contracts | Contracts that an action can move, with code, status and version | array | `[]` |
| options.invoices | Invoices with an amount due; `dueVnd` is a decimal string | array | `[]` |
| playback | The playback run of REQ-PNL-08, `status` IDLE when none ran | object | see sample |

## Validation

<table>
    <th>Status code</th>
    <th>Description</th>
    <th>Examples</th>
    <tbody>
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
    T0["Read options through exported services"]
    G --> T0
    T1["Read the playback state"]
    T0 --> T1
    T2["Evaluate the reseed checks that need no input"]
    T1 --> T2
    OK["Return 200"]
    T2 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant Ctl as DemoPanelController
    participant Svc as DemoPanelService
    participant DB as Postgres
    C->>Ctl: GET /api/demo/panel
    Note over Ctl,Svc: Route guard calls DemoPanelGuard: failure limit, then the password in constant time before DTO validation
    Note over Ctl: Global ValidationPipe validates body before the controller handler
    Ctl->>Svc: overview()
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
