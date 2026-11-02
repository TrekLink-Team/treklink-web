# GET /api/organizations/:id/roles: Role permissions of an organization

> Module `organizations`. Generated from `scripts/specs/endpoints/organizations.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Proposal of D-095, specified in `auth` design section 9; not built until the leader rules on the decision text there. The read-only view of the roles of one organization for TrekLink: the same body as `GET /api/organization/roles` (auth api-design 19), for the organization in the path. It calls the read service of `auth`.

## API Specification

| API | URL |
| --- | --- |
| GET | /api/organizations/:id/roles |
| Permission | TrekLink Staff, TrekLink Admin (`organizationRole.read`) |
| Traces | FR-AUTH-06, FR-AUTH-10, D-095 |

### Path parameters

| Field | Description | Data Type | Examples |
| --- | --- | --- | --- |
| id | Organization id; members may use only their own | uuid | `5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f` |

## Request sample

No body.

## Response sample

```json
{
  "result": {
    "roles": [
      {
        "key": "ORG_OPERATOR",
        "version": 2,
        "baselineKeys": [
          "incident.read.own"
        ],
        "effectiveKeys": [
          "incident.read.own"
        ]
      }
    ],
    "catalog": [
      {
        "key": "incident.read.own",
        "action": "read",
        "subject": "Incident",
        "scope": "own",
        "description": "Read the incidents of the own organization",
        "protected": false
      }
    ]
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
  "message": "Organization not found."
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
    P0["Require that the organization exists"]
    D1 -->|no| P0
    P1["Ask auth for the role view of that organization"]
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
    participant Ctl as OrganizationsController
    participant Svc as OrganizationProfileService
    participant DB as Postgres
    C->>Ctl: GET /api/organizations/:id/roles
    Ctl->>Svc: roles(id)
    Svc->>DB: SELECT organizations WHERE id
    Svc->>Svc: OrganizationRolePolicyService.view(organizationId)
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
