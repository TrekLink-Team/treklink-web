# POST /api/contracts/:id/handover: Complete the handover

> Module `rentals`. Generated from `scripts/specs/endpoints/rentals.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Completes the handover at the counter. Requires the first payment confirmed, the Manager's identity checked, every reserved device provisioned with the organization's current key and its handover check passed, and the drawn signature. Stamps the signature into the note, stores the PDF and its SHA-256, then moves the contract to `ACTIVE` and its devices to `RENTED` in one transaction (FR-CON-05, FR-CON-06, BR-09, D-037).

## API Specification

| API | URL |
| --- | --- |
| POST | /api/contracts/:id/handover |
| Permission | TrekLink Staff |
| Traces | UC-20, UC-21, FR-CON-05, FR-CON-06, FR-DEV-01, FR-DEV-05, BR-09, E01-4, MSG06, MSG19, MSG23, MSG24 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Contract id; members may use only their own organization's | uuid | `c0ffee00-1234-4abc-9def-001122334455` |

## Request sample

```json
{
  "signedByMemberId": "3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f",
  "identityChecked": "CCCD ...4821",
  "signaturePng": "iVBORw0KGgo...",
  "deviceChecks": [
    {
      "deviceId": "0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10",
      "batteryPct": 96,
      "gpsFixOk": true
    }
  ],
  "expectedVersion": 2
}
```

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| signedByMemberId | Org Manager signing | uuid | yes | `3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f` |
| identityChecked | Document type and last digits seen | string | yes | `CCCD ...4821` |
| signaturePng | Drawn signature, base64 PNG | string | yes | `iVBORw0KGgo...` |
| deviceChecks | Per device: batteryPct and gpsFixOk at the counter | object[] | yes | see sample |
| acknowledgeLowBattery | Proceed although a battery is below devices.handoverMinBatteryPct | bool | no | `false` |
| expectedVersion | Contract version the caller saw | int | yes | `4` |

## Response sample

```json
{
  "result": {
    "id": "c0ffee00-1234-4abc-9def-001122334455",
    "code": "RC-2026-0042",
    "organization": {
      "id": "5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f",
      "code": "ORG-0007",
      "legalName": "ACME Trek Co., Ltd."
    },
    "planType": "MONTHLY",
    "dayPlanDays": null,
    "hardwareVariant": {
      "id": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      "code": "treklink-v3"
    },
    "quantity": 10,
    "requestedStartDate": "2026-10-25",
    "monthlyUnitPriceVnd": 450000,
    "dayPremium": null,
    "holdingFeeRatio": 0.5,
    "status": "ACTIVE",
    "statusChangedAt": "2026-10-20T03:15:00.000Z",
    "handedOverAt": "2026-10-20T03:15:00.000Z",
    "currentTerm": {
      "seq": 1,
      "startsAt": "2026-10-25T02:00:00Z",
      "endsAt": "2026-11-25T02:00:00Z"
    },
    "endsAt": null,
    "noticeGivenAt": null,
    "returnDueAt": null,
    "version": 4,
    "handoverNoteSha256": "9f2c...e1",
    "devices": [
      {
        "deviceId": "0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10",
        "assetTag": "TL-0042",
        "handedOverAt": "2026-10-20T03:15:00.000Z",
        "checkedInAt": null,
        "lostAt": null,
        "holder": {
          "name": "Le Thi E",
          "phone": "0912345678",
          "emergencyContact": "Le Van F, 0987654321"
        }
      }
    ]
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "Handover complete. 10 devices issued under contract RC-2026-0042."
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
            <td>The holding fee or day-plan fee is not confirmed (<code>FIRST_PAYMENT_MISSING</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "FIRST_PAYMENT_MISSING"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "The first payment is not recorded yet."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>A device lacks provisioning at the current key version (<code>DEVICE_NOT_PROVISIONED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "DEVICE_NOT_PROVISIONED"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "Provision this device with the organization's key before handover."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>A device check failed; swap it first (<code>DEVICE_CHECK_FAILED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "DEVICE_CHECK_FAILED"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "This device cannot be allocated while it is MAINTENANCE."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>A battery is below the minimum and not acknowledged (<code>LOW_BATTERY</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "LOW_BATTERY"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "Battery 41 %. Charge before use."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>The requested start date has not come yet (<code>BEFORE_START_DATE</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "BEFORE_START_DATE"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "Handover is possible from 2026-10-25."
}
```
</td>
        </tr>
        <tr>
            <td>400</td>
            <td>The signer is not an active Manager of the organization (<code>SIGNER_NOT_MANAGER</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "SIGNER_NOT_MANAGER"
  },
  "isSuccess": false,
  "statusCode": 400,
  "message": "Only a Manager of the organization can sign."
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
        <tr>
            <td>409</td>
            <td>Another user changed the record first (expectedVersion differs) (<code>STALE_VERSION</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "STALE_VERSION"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "This was changed by someone else. Reload and try again."
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
    D3{"The holding fee or day-plan fee is not confirmed?"}
    D2 -->|no| D3
    E3["Return 409 FIRST_PAYMENT_MISSING"]
    D3 -->|yes| E3
    E3 --> X3((End))
    D4{"A device lacks provisioning at the current key version?"}
    D3 -->|no| D4
    E4["Return 409 DEVICE_NOT_PROVISIONED"]
    D4 -->|yes| E4
    E4 --> X4((End))
    D5{"A device check failed; swap it first?"}
    D4 -->|no| D5
    E5["Return 409 DEVICE_CHECK_FAILED"]
    D5 -->|yes| E5
    E5 --> X5((End))
    D6{"A battery is below the minimum and not acknowledged?"}
    D5 -->|no| D6
    E6["Return 409 LOW_BATTERY"]
    D6 -->|yes| E6
    E6 --> X6((End))
    D7{"The requested start date has not come yet?"}
    D6 -->|no| D7
    E7["Return 409 BEFORE_START_DATE"]
    D7 -->|yes| E7
    E7 --> X7((End))
    D8{"The signer is not an active Manager of the organization?"}
    D7 -->|no| D8
    E8["Return 400 SIGNER_NOT_MANAGER"]
    D8 -->|yes| E8
    E8 --> X8((End))
    D9{"The contract is not in a state that allows this?"}
    D8 -->|no| D9
    E9["Return 409 INVALID_STATE_TRANSITION"]
    D9 -->|yes| E9
    E9 --> X9((End))
    D10{"Another user changed the record first (expectedVersion differs)?"}
    D9 -->|no| D10
    E10["Return 409 STALE_VERSION"]
    D10 -->|yes| E10
    E10 --> X10((End))
    P0["Require APPROVED and the first payment confirmed"]
    D10 -->|no| P0
    P1["Check every device provisioned and passing"]
    P0 --> P1
    P2["Stamp the signature into the PDF, store it and its hash"]
    P1 --> P2
    P3["Move devices to RENTED and the contract to ACTIVE in one transaction"]
    P2 --> P3
    P4["Emit contract.activated"]
    P3 --> P4
    OK["Return 200"]
    P4 --> OK
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
    participant Bill as BillingService
    participant Dev as DevicesService
    participant Store as File storage
    C->>Ctl: POST /api/contracts/:id/handover
    Ctl->>Svc: complete(id, dto, actor)
    Svc->>Bill: firstPaymentConfirmed(id)
    Svc->>Dev: assertReadyForHandover(ids, keyVersion)
    Svc->>Store: put(note.pdf)
    Svc->>DB: BEGIN, UPDATE contract_devices
    Svc->>Dev: markRented(ids, tx)
    Svc->>DB: UPDATE contract, INSERT transition, COMMIT
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
