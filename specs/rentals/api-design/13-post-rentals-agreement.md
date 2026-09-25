# POST /api/rentals/:id/agreement: Generate the rental agreement

> Module `rentals`. Format: `02-templates/04-api-endpoint-template.md`, with Mermaid in place of PlantUML (D-017). Envelope: D-002.

[TOC]

---
## Overview

Renders the agreement PDF from the current rental (renter, custodian Guide, trip, devices by asset tag, deposit per device from `billing`, terms from `rentals.agreementTerms`). Each call creates a new version and voids the previous unsigned one. The PDF is stored with its SHA-256.

## API Specification

| API        | URL             |
| ---------- | --------------- |
| POST | /api/rentals/:id/agreement |
| Permission | Operator |
| Traces | UC-07, FR-RENT-02 (new), US-030, REQ-EVT-12, REQ-UBI-06, Q62 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Rental id | uuid | `c9b8a7f6-5e4d-4c3b-2a19-0817f6e5d4c3` |

## Request sample

No request body.

## Response sample

```json
{
  "result": {
    "rentalId": "c9b8a7f6-5e4d-4c3b-2a19-0817f6e5d4c3",
    "version": 2,
    "status": "GENERATED",
    "termsVersion": "2026-09",
    "generatedSha256": "3a7bd3...",
    "generatedAt": "2026-10-09T23:20:00Z"
  },
  "isSuccess": true,
  "statusCode": 201,
  "message": "Agreement generated"
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
            <td>No such rental, or outside the caller's scope (<code>NOT_FOUND</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "NOT_FOUND"
  },
  "isSuccess": false,
  "statusCode": 404,
  "message": "Rental not found."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>Rental not DRAFT or READY (<code>INVALID_STATE_TRANSITION</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "INVALID_STATE_TRANSITION"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "An agreement can be generated only before check-out."
}
```
</td>
        </tr>
        <tr>
            <td>409</td>
            <td>Items without a device (<code>RESERVATION_INCOMPLETE</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "RESERVATION_INCOMPLETE"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "Every item needs a device before the agreement is generated."
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
    A1["Check JWT, generate policy"]
    S --> A1
    D2{"Not found?"}
    A1 --> D2
    E2["Return 404"]
    D2 -->|yes| E2
    E2 --> X2((End))
    D3{"Wrong state or items incomplete?"}
    D2 -->|no| D3
    E3["Return 409"]
    D3 -->|yes| E3
    E3 --> X3((End))
    A4["Fetch deposits from billing"]
    D3 -->|no| A4
    A5["Render PDF, hash, insert version, void previous unsigned"]
    A4 --> A5
    OK["Return 201"]
    A5 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Controller as RentalsController
    participant Service as RentalsService
    participant DB as Postgres
    participant A as AgreementService
    participant BL as BillingService
    Client->>Controller: POST /api/rentals/{id}/agreement
    Controller->>Service: generateAgreement(id, actor)
    Service->>BL: depositsFor(rental)
    Service->>A: render(rental, terms)
    A-->>Service: pdf bytes, sha256
    Service->>DB: INSERT rental_agreements version n
    Controller-->>Client: 201 envelope
```
