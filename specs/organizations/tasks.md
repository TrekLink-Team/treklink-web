# Implementation Tasks: organizations

> New module (D-036). Owner: KhoaDD (D-035). Jira keys assigned when the backlog is regenerated.
> Fulfills `design.md`. Starts after auth Phase 1 and 2.

## Phase 1: Foundation & Domain Modeling

- [ ] 1.1 `OrganizationsModule`; models are in the baseline; repositories for its six models only
- [ ] 1.2 Lifecycle table and guard (`OrganizationLifecycle.transition(org, to, actor, reason, tx)`) with compare-and-set and transition row
  - _Requirements: REQ-UBI-01, design §2_
- [ ] 1.3 Provide `ACCOUNT_CONTEXT_PROVIDER` and `API_KEY_RESOLVER`; declare `ORGANIZATION_EXIT_CHECKS`
  - _Requirements: design §5_

## Phase 2: Core Service Logic

- [ ] 2.1 Registration in one transaction through `AccountsService.createOrganizationAccount`; Staff notification
  - _Requirements: REQ-EVT-01, REQ-ERR-01, AC-01_
- [ ] 2.2 Verification, approval, rejection, suspension (Admin and `suspendForDefault`), reactivation, closing
  - _Requirements: REQ-EVT-02 to REQ-EVT-06, REQ-ERR-02, REQ-ERR-04, AC-02, AC-07_
- [ ] 2.3 Members: invite, change role, deactivate with the last-Manager guard under a row lock; clear future roster slots
  - _Requirements: REQ-UBI-02, REQ-EVT-07, REQ-EVT-08, REQ-ERR-03, AC-03_
- [ ] 2.4 Roster: CRUD, `tiersAt()`, gap and `NO_PRIMARY` warnings
  - _Requirements: REQ-UBI-04, REQ-EVT-10, REQ-STA-02, AC-04_
- [ ] 2.5 API keys and Field Station credentials: create, list, revoke, limits, health projection
  - _Requirements: REQ-UBI-03, REQ-EVT-09, REQ-ERR-06, AC-05, AC-06_

## Phase 3: API Presentation Layer

- [ ] 3.1 Controllers for api-design 01 to 25
- [ ] 3.2 E2E for every Validation row; tenancy cases added to `tenancy.e2e-spec.ts`

## Phase 4: Frontend Integration

- [ ] 4.1 Public registration page; Staff verification queue; Admin approvals; Manager pages for members, roster, API keys and Field Stations (tracked in `specs/frontend/tasks.md`)

## Phase 5: Verification & DoD

- [ ] 5.1 Suite green; lint, boundary check, typecheck clean; `api-design/*.md` matching behaviour
