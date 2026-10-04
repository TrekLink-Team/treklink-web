# GET /api/contracts/:id/handover-note: Download the signed handover note

> Module `rentals`. Generated from `scripts/specs/endpoints/rentals.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Returns the signed PDF and its stored SHA-256; the hash is recomputed on read and a mismatch is reported, never repaired (FR-CON-06).

## API Specification

| API | URL |
| --- | --- |
| GET | /api/contracts/:id/handover-note |
| Permission | Org Manager: own; TrekLink Staff, TrekLink Admin |
| Traces | UC-21, FR-CON-06 |

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
    "sha256": "9f2c...e1",
    "integrity": "OK"
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
            <td>No signed note exists yet (<code>NOTE_NOT_SIGNED</code>)</td>
<td>

```json
{
  "result": {
    "errorCode": "NOTE_NOT_SIGNED"
  },
  "isSuccess": false,
  "statusCode": 409,
  "message": "The handover is not complete yet."
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
    D2{"No signed note exists yet?"}
    D1 -->|no| D2
    E2["Return 409 NOTE_NOT_SIGNED"]
    D2 -->|yes| E2
    E2 --> X2((End))
    P0["Load the PDF"]
    D2 -->|no| P0
    P1["Recompute and compare the hash"]
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
    participant Store as File storage
    C->>Ctl: GET /api/contracts/:id/handover-note
    Ctl->>Svc: download(id, caller)
    Svc->>Store: get(path)
    Svc->>Svc: sha256 compare
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
