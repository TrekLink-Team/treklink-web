# GET /api/contracts/:id/devices/:deviceId/release-preview: Preview a unit release

> Module `rentals`. Generated from `scripts/specs/endpoints/rentals.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

What releasing the unit now would do, for the confirmation dialog: the quantity after it, and either the release credit (unused and term days, the amount the Admin will decide) or that none applies (a day plan, no open term, the term's last day), or, before the handover, the first invoice's new total and what would be owed to the organization. Nothing is stored or locked (REQ-EVT-33). The same refusals as the release apply, except the version.

## API Specification

| API | URL |
| --- | --- |
| GET | /api/contracts/:id/devices/:deviceId/release-preview |
| Permission | TrekLink Staff |
| Traces | D-099, REQ-EVT-33 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Contract id; members may use only their own organization's | uuid | `c0ffee00-1234-4abc-9def-001122334455` |
| deviceId | Device committed to the contract | uuid | `0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10` |

## Request sample

No body.

## Response sample

```json
{
  "result": {
    "phase": "RUNNING",
    "quantityBefore": 5,
    "quantityAfter": 4,
    "lastUnit": false,
    "credit": {
      "applies": true,
      "unusedDays": 20,
      "termDays": 30,
      "computedVnd": 300000
    },
    "firstInvoice": null
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "OK"
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
  "message": "Unit release not found."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>The contract is not in a state that allows this (<code>INVALID_STATE_TRANSITION</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "INVALID_STATE_TRANSITION"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "This cannot be done while it is RETURN_DUE."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>The unit is not live on the contract (<code>DEVICE_NOT_ON_CONTRACT</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "DEVICE_NOT_ON_CONTRACT"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "TL-0042 does not belong to contract RC-2026-0042."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>The unit is the contract's last live unit (<code>LAST_UNIT</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "LAST_UNIT"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "This is the last unit. End the contract now instead."
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
    D2{"The contract is not in a state that allows this?"}
    D1 -->|no| D2
    E2["Return 409 INVALID_STATE_TRANSITION"]
    D2 -->|yes| E2
    E2 --> X2((End))
    D3{"The unit is not live on the contract?"}
    D2 -->|no| D3
    E3["Return 409 DEVICE_NOT_ON_CONTRACT"]
    D3 -->|yes| E3
    E3 --> X3((End))
    D4{"The unit is the contract's last live unit?"}
    D3 -->|no| D4
    E4["Return 409 LAST_UNIT"]
    D4 -->|yes| E4
    E4 --> X4((End))
    P0["Read the contract, the unit's row and the open term"]
    D4 -->|no| P0
    P1["Compute through billing without storing"]
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
    participant Ctl as ContractsController
    participant Svc as ReleaseService
    participant DB as Postgres
    C->>Ctl: GET /api/contracts/:id/devices/:deviceId/release-preview
    Ctl->>Svc: preview(id, deviceId, actor)
    Svc->>DB: SELECT contract, contract_devices, open term
    Svc->>Svc: releaseCreditOf or firstInvoiceAfter
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
