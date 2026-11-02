# GET /api/contracts/:id/service-credits: Service credits of a contract

> Module `billing`. Generated from `scripts/specs/endpoints/billing.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Lists the contract's credits, newest first. An organization member sees only its own organization's.

## API Specification

| API | URL |
| --- | --- |
| GET | /api/contracts/:id/service-credits |
| Permission | TrekLink Staff, TrekLink Admin; the organization's Managers for their own |
| Traces | D-092 rule 5, REQ-EVT-12 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Contract id | uuid | `c0ffee00-1234-4abc-9def-001122334455` |

### Query parameters

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| status | ServiceCreditStatus | enum | no | `REQUESTED` |
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
        "id": "sc-1",
        "contractId": "c0ffee00-1234-4abc-9def-001122334455",
        "contractDeviceId": "cd-1",
        "deviceId": "0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10",
        "assetTag": "TL-0042",
        "cause": "BATTERY_FAULT",
        "faultInspectionId": "in-7",
        "outageFrom": "2026-10-10T01:30:00.000Z",
        "outageSourceIncidentId": "7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d",
        "outageSourceNote": null,
        "outageTo": "2026-10-13T03:00:00.000Z",
        "outageDays": 3,
        "computedVnd": 45000,
        "decidedVnd": null,
        "appliedVnd": 0,
        "status": "REQUESTED",
        "decisionReason": null,
        "decidedAt": null,
        "refundReference": null,
        "refundedAt": null,
        "version": 1,
        "createdAt": "2026-10-20T03:15:00.000Z"
      }
    ],
    "pageNumber": 1,
    "pageSize": 20,
    "totalCount": 1,
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
  "message": "Service credit not found."
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
    P0["Read service_credits within scope"]
    D2 -->|no| P0
    P1["Asset tags from devices"]
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
    participant Ctl as ServiceCreditsController
    participant Svc as ServiceCreditService
    participant DB as Postgres
    C->>Ctl: GET /api/contracts/:id/service-credits
    Ctl->>Svc: list(filter, query)
    Svc->>DB: SELECT service_credits
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
