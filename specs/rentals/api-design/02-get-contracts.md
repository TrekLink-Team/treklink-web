# GET /api/contracts: List contracts

> Module `rentals`. Generated from `scripts/specs/endpoints/rentals.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Lists contracts. The Staff approval queue is `status=REQUESTED`; the handover queue is `APPROVED`.

## API Specification

| API | URL |
| --- | --- |
| GET | /api/contracts |
| Permission | Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin |
| Traces | UC-55, FR-AUTH-11 |

### Query parameters

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| status | ContractStatus, repeatable | enum | no | `REQUESTED` |
| organizationId | TrekLink staff only | uuid | no | `5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f` |
| planType | Plan | enum | no | `DAY` |
| pageNumber | 1-based page | int | no | `1` |
| pageSize | Items per page, at most MAX_PAGE_SIZE | int | no | `20` |

## Request sample

No body.

## Response sample

```json
{
  "result": {
    "items": [
      {
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
        "version": 4
      }
    ],
    "pageNumber": 1,
    "pageSize": 20,
    "totalCount": 3,
    "totalPages": 1
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
    P0["Apply scope"]
    D1 -->|no| P0
    P1["Read contracts"]
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
    participant Svc as ContractsService
    participant DB as Postgres
    C->>Ctl: GET /api/contracts
    Ctl->>Svc: list(query, caller)
    Svc->>DB: SELECT rental_contracts WHERE scope
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
