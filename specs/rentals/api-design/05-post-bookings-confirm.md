# POST /api/bookings/:id/confirm: Confirm a booking

> Module `rentals`. Format: `02-templates/04-api-endpoint-template.md`, with Mermaid in place of PlantUML (D-017). Envelope: D-002.

[TOC]

---
## Overview

Confirms a `PENDING` booking once its allocations cover the requested devices (paid holds on the Customer channel, or holds with the hold disabled on Staff and Guide channels) and the trip has its required Guides. Creates the rental in `DRAFT` with one item per allocation, and notifies the Customer. Every guard is checked before any write.

## API Specification

| API        | URL             |
| ---------- | --------------- |
| POST | /api/bookings/:id/confirm |
| Permission | Operator |
| Traces | UC-04, FR-BOOK-04, BR-02, E01-4, US-027, REQ-EVT-06, REQ-ERR-04, REQ-ERR-05 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Booking id | uuid | `7f1e2d3c-4b5a-4968-8776-655443322110` |

## Request sample

```json
{
  "custodianGuideId": "g-1...",
  "note": "Checked ID by phone"
}
```

| Field | Description | Data Type | Required | Examples |
| --- | --- | --- | --- | --- |
| custodianGuideId | Guide of this trip who receives the devices; defaults to the Lead | uuid | no | `g-1...` |
| note | Stored in history | string | no | `Checked ID` |

## Response sample

```json
{
  "result": {
    "booking": {
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
      "status": "CONFIRMED",
      "allocations": [],
      "escrowPaidAt": null,
      "createdAt": "2026-10-01T02:10:00Z",
      "confirmedAt": "2026-10-01T03:00:00Z"
    },
    "rental": {
      "id": "c9b8a7f6-5e4d-4c3b-2a19-0817f6e5d4c3",
      "code": "RN-2026-000077",
      "status": "DRAFT"
    }
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "Booking confirmed"
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
            <td>Booking not PENDING (<code>INVALID_STATE_TRANSITION</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "INVALID_STATE_TRANSITION"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "Only a pending booking can be confirmed."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>Trip lacks required Guides (<code>GUIDES_NOT_SATISFIED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "GUIDES_NOT_SATISFIED"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "This trip needs 2 Guides and has 1. Assign a Guide before confirming."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>Allocations incomplete or unpaid (<code>RESERVATION_INCOMPLETE</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "RESERVATION_INCOMPLETE"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "1 of 1 device reserved, escrow not paid."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>Custodian not a Guide on this trip (<code>VALIDATION_FAILED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "VALIDATION_FAILED"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "custodianGuideId must be a Guide assigned to this trip."
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
    A1["Check JWT, confirm policy on Booking"]
    S --> A1
    D2{"Not found?"}
    A1 --> D2
    E2["Return 404"]
    D2 -->|yes| E2
    E2 --> X2((End))
    A3["BEGIN, lock booking"]
    D2 -->|no| A3
    D4{"Not PENDING?"}
    A3 --> D4
    E4["Return 409"]
    D4 -->|yes| E4
    E4 --> X4((End))
    D5{"Guides not satisfied?"}
    D4 -->|no| D5
    E5["Return 409 GUIDES_NOT_SATISFIED"]
    D5 -->|yes| E5
    E5 --> X5((End))
    D6{"Allocations incomplete or unpaid?"}
    D5 -->|no| D6
    E6["Return 409 RESERVATION_INCOMPLETE"]
    D6 -->|yes| E6
    E6 --> X6((End))
    A7["Booking CONFIRMED; allocations CONFIRMED; rental DRAFT with items; COMMIT"]
    D6 -->|no| A7
    A8["Notify Customer, audit"]
    A7 --> A8
    OK["Return 200 with booking and rental"]
    A8 --> OK
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
    participant T as TripsService
    Client->>Controller: POST /api/bookings/{id}/confirm
    Controller->>Service: confirm(id, dto, actor)
    Service->>DB: BEGIN, SELECT booking FOR UPDATE
    Service->>T: guidesSatisfied(tripId)
    alt blocked
      Service->>DB: ROLLBACK
      Service-->>Controller: 409 with blocker code
    end
    Service->>DB: UPDATE booking, allocations, INSERT rental, rental_items, COMMIT
    Controller-->>Client: 200 envelope
```
