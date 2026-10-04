# GET /api/invoices: List invoices

> Module `billing`. Generated from `scripts/specs/endpoints/billing.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Lists invoices with their status and amounts; members see only their organization's (FR-AUTH-11).

## API Specification

| API | URL |
| --- | --- |
| GET | /api/invoices |
| Permission | Org Manager: own; TrekLink Staff, TrekLink Admin |
| Traces | UC-55, FR-AUTH-11, FR-BILL-06 |

### Query parameters

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| contractId | Contract | uuid | no | `c0ffee00-1234-4abc-9def-001122334455` |
| status | InvoiceStatus | enum | no | `ISSUED` |
| overdue | Only invoices with a line past due | bool | no | `true` |
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
        "id": "1e2d3c4b-5a69-4788-9a0b-c1d2e3f4a5b6",
        "number": "INV-2026-000123",
        "organizationId": "5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f",
        "contract": {
          "id": "c0ffee00-1234-4abc-9def-001122334455",
          "code": "RC-2026-0042"
        },
        "kind": "TERM",
        "term": {
          "seq": 1
        },
        "status": "PARTIALLY_PAID",
        "totalVnd": 4500000,
        "paidVnd": 2250000,
        "issuedAt": "2026-10-20T03:15:00.000Z"
      }
    ],
    "pageNumber": 1,
    "pageSize": 20,
    "totalCount": 2,
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
    P1["Read invoices"]
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
    participant Ctl as InvoicesController
    participant Svc as InvoicesService
    participant DB as Postgres
    C->>Ctl: GET /api/invoices
    Ctl->>Svc: list(query, caller)
    Svc->>DB: SELECT invoices WHERE scope
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
