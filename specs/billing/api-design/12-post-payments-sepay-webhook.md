# POST /api/payments/sepay/webhook: SePay confirmation webhook

> Module `billing`. Generated from `scripts/specs/endpoints/billing.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). D-038 raw success acknowledgement; D-002 errors.

[TOC]

---
## Overview

Receives SePay's transaction notification. Authenticated by the `Authorization: Apikey ...` header before DTO body validation and matched to a reference the system issued (NFR-SEC-07). A repeated gateway transaction id records nothing (FR-BILL-08, BR-31, E01-6). A different transaction id for an already confirmed reference records a separate CONFIRMED payment, even for the same amount. The amount is applied to unpaid invoice lines oldest due first, up to what remains due; any excess is retained on the payment and logged for Staff, in one transaction. Outgoing transfers and unknown references record nothing and return the same success acknowledgement.

## API Specification

| API | URL |
| --- | --- |
| POST | /api/payments/sepay/webhook |
| Permission | Public (SePay API key header) |
| Traces | UC-19, FR-BILL-07, FR-BILL-08, BR-31, NFR-SEC-07, E01-6 |
| Notes | Verified against https://docs.sepay.vn/tich-hop-webhooks.html (2026-10-04): SePay sends `Authorization: Apikey <key>`, posts id, gateway, transactionDate, accountNumber, subAccount, code, content, transferType, description, transferAmount, accumulated, referenceCode; it expects HTTP 200 or 201 with the body `{"success": true}` within 30 s and otherwise retries up to 7 times over 5 hours. D-038 makes the success acknowledgement a bare body through @RawResponse(). The route guard verifies the key before the global validation pipe: an invalid key gives 401 WEBHOOK_UNAUTHENTICATED even when the DTO fields are missing or invalid. |

## Request sample

```json
{
  "id": 92704,
  "gateway": "Sandbox",
  "transactionDate": "2026-10-20 10:20:31",
  "accountNumber": "SANDBOX-0001",
  "subAccount": null,
  "code": null,
  "content": "TL7K2Q9M4D",
  "transferType": "in",
  "description": "TL7K2Q9M4D",
  "transferAmount": 2250000,
  "accumulated": 2250000,
  "referenceCode": "FT26293...."
}
```

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| id | SePay transaction id | int | yes | `92704` |
| transferAmount | Amount received | int | yes | `2250000` |
| content | Transfer content; holds the reference | string | yes | `TL7K2Q9M4D` |
| transferType | `in` | string | yes | `in` |
| transactionDate | SePay time | string | yes | `2026-10-20 10:20:31` |

## Response sample

```json
{
  "success": true
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
            <td>Missing or wrong SePay API key (<code>WEBHOOK_UNAUTHENTICATED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "WEBHOOK_UNAUTHENTICATED"
  },
  "isSuccess": false,
  "statusCode": 401,
  "message": "Authentication required."
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
    A0["Accept request"]
    S --> A0
    Auth["assertWebhookKey(authorization)"]
    A0 --> Auth
    AuthCheck{"API key missing or wrong?"}
    Auth --> AuthCheck
    AuthError["Return 401 WEBHOOK_UNAUTHENTICATED"]
    AuthCheck -->|yes| AuthError
    AuthError --> AuthEnd((End))
    D1{"The body or query fails validation?"}
    AuthCheck -->|no| D1
    E1["Return 400 VALIDATION_FAILED"]
    D1 -->|yes| E1
    E1 --> X1((End))
    P0["Extract the reference; outgoing transfers and unknown references return success without recording"]
    D1 -->|no| P0
    P1["Lock the payment by reference"]
    P0 --> P1
    P2["If the gateway transaction id is known: return 200 without recording it again"]
    P1 --> P2
    P3["Confirm the matching request or record a separate received payment, apply to lines, update invoice status"]
    P2 --> P3
    P4["Emit payment.confirmed"]
    P3 --> P4
    OK["Return 200"]
    P4 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor C as SePay
    participant Ctl as SepayController
    participant Svc as SepayService
    participant DB as Postgres
    C->>Ctl: POST /api/payments/sepay/webhook
    Note over Ctl,Svc: SepayWebhookGuard calls assertWebhookKey(authorization) before DTO validation
    Note over Ctl: Global ValidationPipe validates body before the controller handler
    Ctl->>Svc: handleWebhook(authorization, body)
    Svc->>DB: BEGIN, SELECT payment WHERE reference FOR UPDATE
    Svc->>DB: UPDATE payment CONFIRMED, invoice_lines.paidVnd, invoices, COMMIT
    Svc-)Svc: emit payment.confirmed
    Svc-->>Ctl: result
    Ctl-->>C: 200 raw acknowledgement
```
