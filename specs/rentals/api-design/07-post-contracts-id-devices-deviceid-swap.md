# POST /api/contracts/:id/devices/:deviceId/swap: Swap a reserved device

> Module `rentals`. Generated from `scripts/specs/endpoints/rentals.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

A reserved device fails its check at handover: it goes to `MAINTENANCE` and another `AVAILABLE` device of the variant takes its place (E01-5). With no replacement available the handover is held.

## API Specification

| API | URL |
| --- | --- |
| POST | /api/contracts/:id/devices/:deviceId/swap |
| Permission | TrekLink Staff |
| Traces | UC-20, FR-CON-05, FR-DEV-08, E01-5, MSG17 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Contract id; members may use only their own organization's | uuid | `c0ffee00-1234-4abc-9def-001122334455` |
| deviceId | Device committed to the contract | uuid | `0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10` |

## Request sample

```json
{
  "reason": "No GPS fix at the counter"
}
```

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| reason | What failed | string | yes | `No GPS fix` |
| replacementDeviceId | Optional explicit replacement | uuid | no | `...` |

## Response sample

```json
{
  "result": {
    "released": {
      "deviceId": "0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10",
      "assetTag": "TL-0042",
      "status": "MAINTENANCE"
    },
    "reserved": {
      "deviceId": "8f9e...",
      "assetTag": "TL-0051",
      "status": "RESERVED"
    }
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "Device swapped"
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
  "message": "Contract not found."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>The device is not committed to this contract (<code>DEVICE_NOT_ON_CONTRACT</code>)</td>
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
            <td>No AVAILABLE replacement of the variant (<code>INSUFFICIENT_DEVICES</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "INSUFFICIENT_DEVICES"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "Only 0 treklink-v3 devices are available. Lower the quantity or choose another variant."
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
  "message": "This cannot be done while it is ACTIVE."
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
    D3{"The device is not committed to this contract?"}
    D2 -->|no| D3
    E3["Return 409 DEVICE_NOT_ON_CONTRACT"]
    D3 -->|yes| E3
    E3 --> X3((End))
    D4{"No AVAILABLE replacement of the variant?"}
    D3 -->|no| D4
    E4["Return 409 INSUFFICIENT_DEVICES"]
    D4 -->|yes| E4
    E4 --> X4((End))
    D5{"The contract is not in a state that allows this?"}
    D4 -->|no| D5
    E5["Return 409 INVALID_STATE_TRANSITION"]
    D5 -->|yes| E5
    E5 --> X5((End))
    P0["Require APPROVED"]
    D5 -->|no| P0
    P1["Release the row, open maintenance on the failed device"]
    P0 --> P1
    P2["Reserve a replacement in the same transaction"]
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
    participant Ctl as ContractsController
    participant Svc as ContractLifecycleService
    participant DB as Postgres
    participant Dev as DevicesService
    C->>Ctl: POST /api/contracts/:id/devices/:deviceId/swap
    Ctl->>Svc: swap(id, deviceId, dto, actor)
    Svc->>Dev: failHandoverCheck(deviceId, tx)
    Svc->>Dev: reserve(variantId, 1, contractId, tx)
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
