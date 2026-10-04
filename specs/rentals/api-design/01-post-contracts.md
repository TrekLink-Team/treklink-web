# POST /api/contracts: Request a rental contract

> Module `rentals`. Generated from `scripts/specs/endpoints/rentals.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Requests a plan: monthly, or a day plan of a configured length; one hardware variant; a quantity at or above the minimum order quantity; a start date. Prices are snapshotted now, so a later price change does not affect this contract (FR-CFG-02). The organization must be `ACTIVE`.

## API Specification

| API | URL |
| --- | --- |
| POST | /api/contracts |
| Permission | Org Manager: own |
| Traces | UC-15, FR-CON-01, FR-CON-02, FR-CON-07, FR-BILL-01, FR-BILL-02, BR-01, BR-02, E01-2, E01-3, MSG13, MSG14 |

## Request sample

```json
{
  "planType": "MONTHLY",
  "hardwareVariantId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "quantity": 10,
  "requestedStartDate": "2026-10-25"
}
```

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| planType | `MONTHLY` or `DAY` | enum | yes | `MONTHLY` |
| dayPlanDays | One of rentals.dayPlanLengths; DAY only | int | cond. | `4` |
| hardwareVariantId | Active variant | uuid | yes | `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d` |
| quantity | At least rentals.minOrderQuantity | int | yes | `10` |
| requestedStartDate | Handover day, not in the past | date | yes | `2026-10-25` |

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
    "status": "REQUESTED",
    "statusChangedAt": "2026-10-20T03:15:00.000Z",
    "handedOverAt": null,
    "currentTerm": null,
    "endsAt": null,
    "noticeGivenAt": null,
    "returnDueAt": null,
    "version": 0,
    "quote": {
      "firstPaymentVnd": 2250000,
      "termFeeVnd": 4500000
    }
  },
  "isSuccess": true,
  "statusCode": 201,
  "message": "Request sent. TrekLink will confirm availability and your handover appointment."
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
            <td>400</td>
            <td>Quantity below rentals.minOrderQuantity (<code>BELOW_MOQ</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "BELOW_MOQ"
  },
  "isSuccess": false,
  "statusCode": 400,
  "message": "The minimum order is 5 devices."
}
```
</td>
        </tr>
        <tr>
            <td>400</td>
            <td>dayPlanDays is not a configured length (<code>DAY_PLAN_LENGTH</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "DAY_PLAN_LENGTH"
  },
  "isSuccess": false,
  "statusCode": 400,
  "message": "Choose a plan of 3, 4 or 7 days."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>The organization is PENDING, REJECTED, SUSPENDED or CLOSED (<code>ORGANIZATION_NOT_ACTIVE</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "ORGANIZATION_NOT_ACTIVE"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "Your organization cannot request devices while it is SUSPENDED."
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
    D2{"Quantity below rentals.minOrderQuantity?"}
    D1 -->|no| D2
    E2["Return 400 BELOW_MOQ"]
    D2 -->|yes| E2
    E2 --> X2((End))
    D3{"dayPlanDays is not a configured length?"}
    D2 -->|no| D3
    E3["Return 400 DAY_PLAN_LENGTH"]
    D3 -->|yes| E3
    E3 --> X3((End))
    D4{"The organization is PENDING, REJECTED, SUSPENDED or CLOSED?"}
    D3 -->|no| D4
    E4["Return 409 ORGANIZATION_NOT_ACTIVE"]
    D4 -->|yes| E4
    E4 --> X4((End))
    P0["Require the organization ACTIVE"]
    D4 -->|no| P0
    P1["Validate plan, variant, quantity and date"]
    P0 --> P1
    P2["Snapshot price, premium and holding ratio from billing"]
    P1 --> P2
    P3["Insert the contract REQUESTED"]
    P2 --> P3
    P4["Notify TrekLink Staff"]
    P3 --> P4
    OK["Return 201"]
    P4 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant Ctl as ContractsController
    participant Svc as ContractsService
    participant DB as Postgres
    participant Org as OrganizationsService
    participant Bill as BillingService
    C->>Ctl: POST /api/contracts
    Ctl->>Svc: request(dto, caller)
    Svc->>Org: assertActive(orgId)
    Svc->>Bill: priceSnapshot(variantId)
    Svc->>DB: INSERT rental_contracts, contract_transitions
    Svc-->>Ctl: result
    Ctl-->>C: 201 envelope
```
