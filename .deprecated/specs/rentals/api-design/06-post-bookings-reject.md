# POST /api/bookings/:id/reject: Reject a booking

> Module `rentals`. Format: `02-templates/04-api-endpoint-template.md`, with Mermaid in place of PlantUML (D-017). Envelope: D-002.

[TOC]

---
## Overview

Rejects a `PENDING` booking with a reason, releases its allocations and seats, and asks `billing` to refund any escrow in full.

## API Specification

| API        | URL             |
| ---------- | --------------- |
| POST | /api/bookings/:id/reject |
| Permission | Operator |
| Traces | UC-04, US-027, REQ-EVT-07 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Booking id | uuid | `7f1e2d3c-4b5a-4968-8776-655443322110` |

## Request sample

```json
{
  "reason": "Group size cannot be verified; customer unreachable"
}
```

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| reason | Required, shown to the customer | string | yes | `Customer unreachable` |

## Response sample

```json
{
  "result": {
    "id": "7f1e2d3c-4b5a-4968-8776-655443322110",
    "code": "BK-2026-000123",
    "trip": {
      "id": "a1c3...",
      "code": "TRP-2026-1010-TNPD",
      "startAt": "2026-10-10T00:00:00Z"
    },
    "channel": "CUSTOMER",
    "customer": {
      "id": "5b7e...",
      "username": "name123"
    },
    "renterName": "Nguyen Van A",
    "groupSize": 2,
    "requestedDevices": 1,
    "status": "REJECTED",
    "allocations": [],
    "escrowPaidAt": null,
    "createdAt": "2026-10-01T02:10:00Z",
    "decisionReason": "Group size cannot be verified; customer unreachable",
    "refund": {
      "amount": 3450000,
      "status": "SUCCEEDED"
    }
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "Booking rejected"
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
            <td>Reason missing (<code>VALIDATION_FAILED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "VALIDATION_FAILED"
  },
  "isSuccess": false,
  "statusCode": 400,
  "message": "reason is required."
}
```
</td>
        </tr>
        <tr>
            <td>401</td>
            <td>Missing, malformed or expired access token (<code>UNAUTHENTICATED</code>)</td>
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
            <td>Authenticated, but the caller's role or policy does not allow this action (<code>FORBIDDEN</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "FORBIDDEN"
  },
  "isSuccess": false,
  "statusCode": 403,
  "message": "You do not have permission to perform this action."
}
```
</td>
        </tr>
        <tr>
            <td>404</td>
            <td>No such booking, or outside the caller's scope (<code>NOT_FOUND</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "NOT_FOUND"
  },
  "isSuccess": false,
  "statusCode": 404,
  "message": "Booking not found."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>Not PENDING (<code>INVALID_STATE_TRANSITION</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "INVALID_STATE_TRANSITION"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "Only a pending booking can be rejected."
}
```
</td>
        </tr>
        <tr>
            <td>502</td>
            <td>Refund failed in billing; booking unchanged (<code>PAYMENT_PROVIDER_ERROR</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "PAYMENT_PROVIDER_ERROR"
  },
  "isSuccess": false,
  "statusCode": 502,
  "message": "Refund failed. The booking was not changed."
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
    A1["Check JWT, reject policy"]
    S --> A1
    D2{"Invalid or not found?"}
    A1 --> D2
    E2["Return 400 or 404"]
    D2 -->|yes| E2
    E2 --> X2((End))
    D3{"Not PENDING?"}
    D2 -->|no| D3
    E3["Return 409"]
    D3 -->|yes| E3
    E3 --> X3((End))
    A4["Refund escrow through billing"]
    D3 -->|no| A4
    D5{"Refund failed?"}
    A4 --> D5
    E5["Return 502, no change"]
    D5 -->|yes| E5
    E5 --> X5((End))
    A6["Booking REJECTED, release allocations and seats"]
    D5 -->|no| A6
    OK["Return 200"]
    A6 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Controller as BookingsController
    participant Service as BookingsService
    participant DB as Postgres
    participant BL as BillingService
    Client->>Controller: POST /api/bookings/{id}/reject
    Controller->>Service: reject(id, reason, actor)
    Service->>BL: refundEscrow(bookingId, full)
    Service->>DB: BEGIN, booking REJECTED, allocations RELEASED, seats -n, COMMIT
    Controller-->>Client: 200 envelope
```
