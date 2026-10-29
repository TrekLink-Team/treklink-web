# GET /api/compliance-cases/:id: Compliance case detail

> Module `organizations`. Generated from `scripts/specs/endpoints/organizations.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Returns one compliance case, the same fields as an item of the list, with every action taken from it and the actor and time of each (FR-ORG-08, FR-ORG-09, ruling 2026-10-30).

## API Specification

| API | URL |
| --- | --- |
| GET | /api/compliance-cases/:id |
| Permission | TrekLink Staff, TrekLink Admin |
| Traces | UC-63, FR-ORG-08, FR-ORG-09 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Compliance case id | uuid | `c4d3e2f1-a0b9-4c8d-9e7f-6a5b4c3d2e1f` |

## Request sample

No body.

## Response sample

```json
{
  "result": {
    "id": "c4d3e2f1-a0b9-4c8d-9e7f-6a5b4c3d2e1f",
    "code": "CMP-0002",
    "organization": {
      "id": "5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f",
      "code": "ORG-0007"
    },
    "type": "SUSPECTED_THEFT",
    "status": "OPEN",
    "evidence": "Three devices unreturned 40 days after default; phones unanswered",
    "linkedContractIds": [
      "c0ffee00-1234-4abc-9def-001122334455"
    ],
    "linkedLossCases": [
      "LOSS-0003"
    ],
    "authorityReference": null,
    "outcome": null,
    "openedAt": "2026-10-20T03:15:00.000Z",
    "actions": [
      {
        "kind": "SUSPEND_ORGANIZATION",
        "actor": {
          "id": "3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f",
          "fullName": "Tran Thi B"
        },
        "at": "2026-10-20T03:15:00.000Z"
      }
    ]
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "OK"
}
```

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| actions[] | Actions taken from the case, in the order they were recorded | object[] | see sample |
| actions[].kind | SUSPEND_ORGANIZATION, REVOKE_FIELD_STATION, REVOKE_API_KEY or OTHER | enum | `SUSPEND_ORGANIZATION` |
| actions[].actor.id | User who took the action (ComplianceAction.actorId) | uuid | `3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f` |
| actions[].actor.fullName | That user's name | string | `Tran Thi B` |
| actions[].at | When the action was recorded (createdAt), UTC | datetime | `2026-10-20T03:15:00.000Z` |

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
  "message": "Compliance case not found."
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
    P0["Read the compliance case"]
    D1 -->|no| P0
    P1["Read its compliance_actions with the actor's name, oldest first"]
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
    participant Ctl as ComplianceCasesController
    participant Svc as ComplianceCaseService
    participant DB as Postgres
    C->>Ctl: GET /api/compliance-cases/:id
    Ctl->>Svc: get(id, caller)
    Svc->>DB: SELECT compliance_cases WHERE id
    Svc->>DB: SELECT compliance_actions JOIN users ORDER BY createdAt
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
