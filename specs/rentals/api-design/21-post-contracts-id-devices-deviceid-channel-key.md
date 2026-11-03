# POST /api/contracts/:id/devices/:deviceId/channel-key: Issue the device's channel key

> Module `rentals`. Generated from `scripts/specs/endpoints/rentals.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Derives and returns the organization's channel key once, for Staff to write to a docked unit (D-082 decision 1). Requires the contract APPROVED, the device reserved to it, and the docked nodeNum to match the device record; refuses otherwise. The response is never cached, stored or logged, and an audit row records the device, organization and key version, never the key (REQ-UBI-03).

## API Specification

| API | URL |
| --- | --- |
| POST | /api/contracts/:id/devices/:deviceId/channel-key |
| Permission | TrekLink Staff |
| Traces | UC-14, FR-DEV-05, BR-09, NFR-SEC-06, NFR-IF-03, D-082 |
| Notes | `Cache-Control: no-store` on the response; the key is never returned a second time for the same docking, so the counter must write it before asking again. |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Contract id; members may use only their own organization's | uuid | `c0ffee00-1234-4abc-9def-001122334455` |
| deviceId | Device committed to the contract | uuid | `0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10` |

## Request sample

```json
{
  "nodeNum": 275612
}
```

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| nodeNum | The nodeNum read from the docked unit | int | yes | `275612` |

## Response sample

```json
{
  "result": {
    "keyHex": "3f9c0e1a2b4d5e6f7081920a1b2c3d4e5f60718293a4b5c6d7e8f9001a2b3c4d",
    "keyVersion": 1
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "Channel key issued"
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
            <td>The docked unit's nodeNum differs from the device record (<code>NODE_MISMATCH</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "NODE_MISMATCH"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "The docked unit is !0004351c, not TL-0042. Nothing was written."
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
  "message": "This cannot be done while it is REQUESTED."
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
    D4{"The docked unit's nodeNum differs from the device record?"}
    D3 -->|no| D4
    E4["Return 409 NODE_MISMATCH"]
    D4 -->|yes| E4
    E4 --> X4((End))
    D5{"The contract is not in a state that allows this?"}
    D4 -->|no| D5
    E5["Return 409 INVALID_STATE_TRANSITION"]
    D5 -->|yes| E5
    E5 --> X5((End))
    P0["Require APPROVED and the device reserved to it"]
    D5 -->|no| P0
    P1["Compare the docked nodeNum with the device record"]
    P0 --> P1
    P2["Read the organization's key version"]
    P1 --> P2
    P3["Derive the key with crypto.hkdfSync(master, orgId, version)"]
    P2 --> P3
    P4["Write an audit row without the key"]
    P3 --> P4
    P5["Respond with Cache-Control: no-store"]
    P4 --> P5
    OK["Return 200"]
    P5 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant Ctl as ContractsController
    participant Svc as HandoverService
    participant DB as Postgres
    participant Org as OrganizationsService
    participant Dev as DevicesService
    C->>Ctl: POST /api/contracts/:id/devices/:deviceId/channel-key
    Ctl->>Svc: issueChannelKey(id, deviceId, dto, actor)
    Svc->>Dev: byNodeNum(nodeNum)
    Svc->>Org: channelKeyVersion(orgId)
    Svc->>Svc: hkdfSync(CHANNEL_KEY_MASTER, orgId, version)
    Svc->>DB: INSERT audit_log (no key)
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
