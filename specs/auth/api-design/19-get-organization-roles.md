# GET /api/organization/roles: Roles of the own organization

> Module `auth`. Generated from `scripts/specs/endpoints/auth.py` by `scripts/specs/build_api_design.py`; edit the catalog, not this file. Format: `02-templates/04-api-endpoint-template.md` with Mermaid (D-017). Envelope: D-002.

[TOC]

---
## Overview

Proposal of D-095, specified in `design.md` section 9; not built until the leader rules on the decision text there. Returns `ORG_MANAGER` and `ORG_OPERATOR` of the caller's organization with, for each, the baseline the Admin set on screen 7.2, the effective keys after the organization's grants and revokes, and the `version` of its policy (0 until the first save). `catalog` describes every permission inside the ceiling, so the screen needs no call to `GET /api/permissions`. The organization comes from the token, never from the request (REQ-UBI-06).

## API Specification

| API | URL |
| --- | --- |
| GET | /api/organization/roles |
| Permission | Org Manager (`organizationRole.manage.own`) |
| Traces | FR-AUTH-06, FR-AUTH-10, FR-AUTH-11, D-095 |

## Request sample

No body.

## Response sample

```json
{
  "result": {
    "roles": [
      {
        "key": "ORG_MANAGER",
        "version": 0,
        "baselineKeys": [
          "incident.read.own",
          "organizationRole.manage.own"
        ],
        "effectiveKeys": [
          "incident.read.own",
          "organizationRole.manage.own"
        ]
      },
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
      },
      {
        "key": "organizationRole.manage.own",
        "action": "manage",
        "subject": "OrganizationRole",
        "scope": "own",
        "description": "Edit what the roles of the own organization may do",
        "protected": true
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
    </tbody>
</table>

## Activity Diagram

```mermaid
flowchart TB
    S((Start))
    A0["Check token, policy and organization scope"]
    S --> A0
    P0["Read the baseline of both roles and the ceiling"]
    A0 --> P0
    P1["Read the organization's policy rows"]
    P0 --> P1
    P2["Compute the effective keys (design section 9.3)"]
    P1 --> P2
    OK["Return 200"]
    P2 --> OK
    OK --> Z((End))
```

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor C as Client
    participant Ctl as OrganizationRolesController
    participant Svc as OrganizationRolePolicyService
    participant DB as Postgres
    C->>Ctl: GET /api/organization/roles
    Ctl->>Svc: view(caller)
    Svc->>DB: SELECT role_permissions, permissions
    Svc->>DB: SELECT organization_role_policies, organization_role_permissions WHERE organizationId
    Svc-->>Ctl: result
    Ctl-->>C: 200 envelope
```
