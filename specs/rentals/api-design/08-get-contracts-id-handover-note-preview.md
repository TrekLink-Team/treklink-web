# GET /api/contracts/:id/handover-note/preview: Preview the handover note

> Module `rentals`. Generated from `scripts/specs/endpoints/rentals.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Renders the handover note PDF without a signature, for the Manager to read at the counter before signing (FR-CON-06).

## API Specification

| API | URL |
| --- | --- |
| GET | /api/contracts/:id/handover-note/preview |
| Permission | TrekLink Staff |
| Traces | UC-21, FR-CON-06 |
| Notes | Returns `application/json` with the PDF as base64 so the envelope holds. |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Contract id; members may use only their own organization's | uuid | `c0ffee00-1234-4abc-9def-001122334455` |

## Request sample

No body.

## Response sample

```json
{
  "result": {
    "pdfBase64": "JVBERi0xLjcK...",
    "sha256": null
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
    D1{"No such record, or it belongs to another organization?"}
    A0 --> D1
    E1["Return 404 NOT_FOUND"]
    D1 -->|yes| E1
    E1 --> X1((End))
    D2{"The contract is not in a state that allows this?"}
    D1 -->|no| D2
    E2["Return 409 INVALID_STATE_TRANSITION"]
    D2 -->|yes| E2
    E2 --> X2((End))
    P0["Require APPROVED"]
    D2 -->|no| P0
    P1["Render organization, plan, term dates and every device by asset tag"]
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
    participant Svc as HandoverNoteService
    participant DB as Postgres
    C->>Ctl: GET /api/contracts/:id/handover-note/preview
    Ctl->>Svc: preview(id)
    Svc->>DB: SELECT contract, devices, organization
    Svc->>Svc: render PDF
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
