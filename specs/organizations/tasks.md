# Implementation Tasks: organizations

> Rewritten 2026-10-18 (D-051) in the full task format of `specs/README.md` §6; adds the NDA and licence
> at verification, compliance cases (D-046), channel key exposure and rotation (D-045) and the Field
> Station release (D-039). Fulfills `design.md`; endpoints are `api-design/01` to `31`.

| | |
|---|---|
| Lane owner | TanNB (roadmap §5.1, remapped 2026-10-18) |
| Reviewer | KhoaDD |
| Sprint | 3 (W7 to W8) for Phases 1 to 3 and onboarding; 4 for roster and keys; 5 for compliance cases |
| Stories | US-UC01, US-UC02, US-UC03, US-UC04, US-UC05, US-UC06, US-UC07, US-UC63 |
| Depends on | platform 2.5 to 2.8; auth 1.2, 4.2 and 5.2 |
| Unblocks | auth 2.2 (membership port), rentals 2.1 (`assertActive`), incidents 2.2 (`tiersAt`), gateway-sync 2.1 (`byUsername`) |

## Phase 1: Foundation & Domain Modeling

- [ ] 1.1 `OrganizationsModule` and repositories (owner TanNB)
  - **Files**: `backend/src/modules/organizations/organizations.module.ts`, `organizations.repository.ts`, `members.repository.ts`, `roster.repository.ts`, `credentials.repository.ts`, `compliance.repository.ts`
  - **Do**: repositories only over the `// @module organizations` models of `schema.prisma`; every query that serves a member takes `scopeWhere(ctx)`
  - _Requirements: REQ-ERR-05, NFR-SEC-04_
- [ ] 1.2 `OrganizationLifecycle.transition(org, to, actor, reason, tx)` (owner TanNB)
  - **Files**: `backend/src/modules/organizations/organization-lifecycle.ts`
  - **Do**: the transition table of design §2; compare-and-set on `version` (409 `STALE_VERSION`), one `OrganizationTransition` row, `organization.statusChanged` and `audit.record` after commit; any other pair 409 `INVALID_STATE_TRANSITION`
  - **Test**: `organization-lifecycle.spec.ts`: every pair of the five states, allowed or 409
  - _Requirements: REQ-UBI-01, FR-ORG-07_
- [ ] 1.3 Ports (owner TanNB; the `ACCOUNT_CONTEXT_PROVIDER` half KhoaDD, D-060 rule 1)
  - **Files**: `backend/src/modules/organizations/ports/exit-checks.port.ts`, `providers/account-context.provider.ts`, `providers/api-key-resolver.provider.ts`
  - **Do**: provide `ACCOUNT_CONTEXT_PROVIDER` (`forUser` returns organization id, code and legal name, member role and status; null for TrekLink accounts and deactivated members, D-060 rule 5) and `API_KEY_RESOLVER` (`resolve(keyHash)`, `lastUsedAt` touched at most once a minute); declare the multi-provider `ORGANIZATION_EXIT_CHECKS`
  - **Test**: resolver ignores revoked keys; `lastUsedAt` not rewritten within a minute; `forUser` returns null for a TrekLink account and a deactivated member
  - **Note**: KhoaDD lands the `ACCOUNT_CONTEXT_PROVIDER` half first, in the smallest `OrganizationsModule` that can host it, so organization accounts sign in for Iteration 1; task 1.1 completes the module
  - _Requirements: design §5, REQ-EVT-09_

## Phase 2: Core Service Logic

- [ ] 2.1 Registration (owner TanNB)
  - **Files**: `backend/src/modules/organizations/organizations.service.ts`
  - **Do**: `register(dto)`: one transaction creating the organization `PENDING` with code `ORG-` plus a padded sequence, the Manager account through `AccountsService.createOrganizationAccount(..., tx)`, the membership and the first transition; notify Staff after commit; duplicate tax code or Manager email 409 `CONFLICT_UNIQUE` (MSG10)
  - **Test**: duplicate tax code; duplicate email in another organization; a failure after the account insert rolls everything back
  - _Requirements: REQ-EVT-01, REQ-ERR-01, AC-01, FR-ORG-01, BR-01_
  - _Story: US-UC01_
- [ ] 2.2 Verification with contract terms (owner TanNB)
  - **Do**: `verify(id, dto, staff)` on a `PENDING` organization: method, documents seen, master contract reference, `ndaSigned` and `softwareLicenceSigned`; either false 400 `CONTRACT_TERMS_MISSING` and nothing stored; sets `verifiedAt` and notifies Admins
  - **Test**: AC-09; a second verification overwrites the first only while `PENDING`
  - _Requirements: REQ-EVT-02, REQ-ERR-07, AC-09, FR-ORG-02, BR-43_
  - _Story: US-UC02_
- [ ] 2.3 Approval and rejection (owner TanNB)
  - **Do**: `approve(id, admin)` requires `verifiedAt` (409 `NOT_VERIFIED`, MSG21), moves to `ACTIVE`, emails MSG05; `reject(id, reason, admin)` moves to `REJECTED` (MSG16)
  - **Test**: AC-02
  - _Requirements: REQ-EVT-03, REQ-ERR-02, AC-02, FR-ORG-03_
  - _Story: US-UC03_
- [ ] 2.4 Suspension, reactivation, closing (owner TanNB)
  - **Do**: `suspend(id, reason, admin)`; `suspendForDefault(orgId, contractCode, tx)` with actor `SYSTEM`; `reactivate(id, admin)` asks every `ORGANIZATION_EXIT_CHECKS.canReactivate` (409 `BALANCE_OUTSTANDING`); `close(id, admin)` asks `canClose` (409 `OPEN_CONTRACTS`), then deactivates members, revokes keys and stations, moves to `CLOSED`; `assertActive(orgId)` throws 409 `ORGANIZATION_NOT_ACTIVE`; a `SUSPENDED` organization's roster and keys still resolve
  - **Test**: AC-07 (contract request refused while the SOS route still resolves); close with an open contract refused
  - _Requirements: REQ-EVT-04, REQ-EVT-05, REQ-EVT-06, REQ-STA-01, REQ-ERR-04, AC-07, FR-ORG-07, BR-26, BR-32_
  - _Story: US-UC07_
  - **Note**: `labelsOf(ids)` (code and legal name) was added by LongLP for the contract and invoice reads of rentals and billing. `assertActive(orgId, tx?)` exists already, built by LongLP with rentals 2.1 (a minimal `OrganizationsRepository.findStatus` and `OrganizationsService`; 404 for an unknown id); the rest of 2.4 builds around it
- [ ] 2.5 Members (owner TanNB)
  - **Files**: `backend/src/modules/organizations/members.service.ts`
  - **Do**: invite through `AccountsService.createOrganizationAccount` with role `ORG_MANAGER` or `ORG_OPERATOR`; change role through `setOrganizationRole`; deactivate through `AccountsService.deactivate`, clear the member from every shift not yet ended, emit `member.deactivated`; the last active Manager can neither be deactivated nor demoted (409 `LAST_MANAGER`), checked under `SELECT ... FOR UPDATE` on the organization row
  - **Test**: AC-03; two concurrent demotions of the last two Managers leave one Manager
  - **Note**: LongLP built the read-only part for the counter handover (rentals 2.4, 2026-10-27): `MembersRepository.membersOf` and `findLiveMember`, `OrganizationsService.membersOf` (names and email from `AccountsService.contactCard`, `invitationPending` while the account is inactive), `isActiveManager` and `channelKeyVersion`. Invite, role change and deactivation stay with this task
  - _Requirements: REQ-UBI-02, REQ-EVT-07, REQ-EVT-08, REQ-ERR-03, AC-03, FR-ORG-04, FR-AUTH-07_
  - _Story: US-UC04_
- [ ] 2.6 Roster (owner TanNB)
  - **Files**: `backend/src/modules/organizations/roster.service.ts`
  - **Do**: create, edit, delete shifts `[startsAt, endsAt)`; primary and backup different active members of the organization (400 `MEMBER_NOT_ELIGIBLE`); overlap rejected by `roster_shifts_no_overlap`, mapped to 409 `SHIFT_OVERLAP`; editing a started shift 409 `SHIFT_STARTED`; list returns `NO_PRIMARY` warnings (MSG22); `tiersAt(orgId, instant)` returns primary, backup and active Managers
  - **Test**: AC-04 against Postgres; `tiersAt` with no shift, a shift without primary, and a deactivated backup
  - _Requirements: REQ-UBI-04, REQ-EVT-10, REQ-STA-02, AC-04, FR-ORG-05, BR-16_
  - _Story: US-UC05_
- [ ] 2.7 API keys (owner TanNB)
  - **Files**: `backend/src/modules/organizations/api-keys.service.ts`
  - **Do**: create `tlk_` plus 43 base64url characters from 32 random bytes, store SHA-256 and the 8-character prefix, return the secret once; limit `organizations.maxApiKeys` (409 `KEY_LIMIT`); revoke emits `apiKey.revoked`
  - **Test**: AC-05; the secret never appears in a list response or the audit entry
  - _Requirements: REQ-UBI-03, REQ-EVT-09, REQ-ERR-06, AC-05, FR-ORG-06, BR-20_
  - _Story: US-UC06_
- [ ] 2.8 Field Station credentials and release (owner TanNB)
  - **Files**: `backend/src/modules/organizations/field-stations.service.ts`, `field-station-release.service.ts`
  - **Do**: create `fs_` secret, bcrypt stored, `mqttUsername` `fs-<org code lower-case>-<n>`, returned once; limit `organizations.maxFieldStations` (409 `STATION_LIMIT`); revoke by Manager, Staff or Admin emits `fieldStation.revoked`; `byUsername(username)` and `recordStationHealth(id, health)` for `gateway-sync`; `FieldStationReleaseService.current()` reads `release.json` from `FIELD_STATION_RELEASE_DIR`, cached until the file changes; `outdated` computed on read by semantic-version order
  - **Test**: AC-06 is in gateway-sync 4.2; AC-08 with a fixture `release.json`
  - _Requirements: REQ-UBI-03, REQ-EVT-09, REQ-EVT-11, REQ-ERR-06, AC-06, AC-08, FR-EVT-13, FR-EVT-14, FR-EVT-18_
  - _Story: US-UC06_
- [ ] 2.9 Channel key exposure and rotation (owner TanNB)
  - **Do**: `markKeyExposed(orgId)` sets `channelKeyExposedAt` and notifies the Managers; `rotateChannelKey(orgId, staff)` increments `channelKeyVersion` and clears the flag; `channelKeyVersion(orgId)` for rentals provisioning
  - **Test**: AC-11 (the devices side triggers `markKeyExposed` in devices 2.7)
  - _Requirements: REQ-EVT-13, AC-11, FR-DEV-13_
  - _Depends on: 1.2_
- [ ] 2.10 Compliance cases (owner TanNB)
  - **Files**: `backend/src/modules/organizations/compliance-case.service.ts`
  - **Do**: open a case with type `SUSPECTED_FRAUD`, `SUSPECTED_THEFT`, `IP_VIOLATION`, `NDA_BREACH` or `OTHER_BREACH`, evidence, linked contracts and loss cases; `openOrLink(orgId, lossCaseId, actor, tx)` for devices; record an action (`SUSPEND` through `suspend`, Admin only; `REVOKE_STATIONS`, `REVOKE_API_KEYS`) appending a `ComplianceAction`; close with outcome and `authorityReference`, required for fraud and theft (409 `POLICE_REFERENCE_REQUIRED`, also the `compliance_cases_police_reference_to_close` CHECK)
  - **Test**: AC-10; `openOrLink` links to an open case of the same type instead of opening a second
  - _Requirements: REQ-EVT-12, REQ-ERR-08, AC-10, FR-ORG-08, FR-ORG-09, BR-40_
  - _Story: US-UC63_

## Phase 3: Query / Retrieval

- [ ] 3.1 Lists and details (owner TanNB)
  - **Do**: organizations list for Staff with status and search filters, paged; detail for Staff or own members; transitions; members; roster for a date range; keys and stations with health; compliance cases with type and status filters
  - **Test**: paging and each filter; a member reading another organization gets 404
  - _Requirements: REQ-ERR-05, FR-AUTH-11_

## Phase 4: API Presentation Layer

- [ ] 4.1 Controllers (owner TanNB)
  - **Files**: `organizations.controller.ts`, `members.controller.ts`, `roster.controller.ts`, `credentials.controller.ts`, `compliance-cases.controller.ts`
  - **Do**: api-design 01 to 31 with each file's permission and `@ResponseMessage`; the registration endpoint is public; `/api/organizations/:id/field-stations/release` declared before `/:stationId` routes
  - **Note**: LongLP opened `organizations.controller.ts` for the counter handover (2026-10-27): 03 `GET /api/organizations/:id` answering only its head (`id`, `code`, `legalName`, `status`, `statusChangedAt`, `channelKeyVersion`, `version`; `organization.read`, `organization.read.own`), and 12 `GET /api/organizations/:id/members` (`member.read`, `member.read.own`). Another organization answers 404. The rest of 03 (the verification record and the counts) joins with 1.1 and 2.4
- [ ] 4.2 E2E (owner TanNB)
  - **Files**: `backend/test/organizations.e2e-spec.ts`, `backend/test/tenancy.e2e-spec.ts`
  - **Do**: every Validation row of api-design 01 to 31; AC-01 to AC-11 except AC-06 (gateway-sync 4.2); cross-organization 404 for every route with `:id`
  - _Requirements: AC-01 to AC-11_

## Phase 5: Frontend Integration

- [ ] 5.1 Registration page, Staff verification queue with the NDA and licence checkboxes, Admin approvals, Manager pages for members, roster, API keys, Field Stations and the release download, Staff compliance cases and key rotation (owner LongNN, tracked in `specs/frontend/tasks.md` 3.1 to 3.6)

## Phase 6: Verification & DoD

- [ ] 6.1 Suite green; lint, boundary check, typecheck clean; `api-design/*.md` matching behaviour (owner TanNB)
