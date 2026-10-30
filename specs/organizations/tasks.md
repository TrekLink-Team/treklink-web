# Implementation Tasks: organizations

> Rewritten 2026-10-18 (D-051) in the full task format of `specs/README.md` §6; adds the NDA and licence
> at verification, compliance cases (D-046), channel key exposure and rotation (D-045) and the Field
> Station release (D-039). Fulfills `design.md`; endpoints are `api-design/01` to `32`.

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
  - **Note**: LongLP added `organizationsOf(userIds)` and `memberUserIds(organizationId)` to the provider for the authentication log (auth task 6.1, api-design 17, 2026-10-29), over `MembersRepository.organizationsOfUsers` and `membersOf(id, true)`; both count a deactivated member
  - **Status** (2026-10-30, KhoaDD, D-078 chain 2): `API_KEY_RESOLVER` is provided by `OrganizationApiKeyResolver` in `OrganizationsPortsModule` (resolve by hash, revoked keys ignored, `lastUsedAt` touched at most once a minute), tested in `api-key-resolver.provider.spec.ts` and `test/api-keys.db-spec.ts`. `ORGANIZATION_EXIT_CHECKS` is open, so the box stays open
  - _Requirements: design §5, REQ-EVT-09_

## Phase 2: Core Service Logic

- [ ] 2.1 Registration (owner TanNB)
  - **Files**: `backend/src/modules/organizations/organizations.service.ts`
  - **Do**: `register(dto)`: one transaction creating the organization `PENDING` with code `ORG-` plus a padded sequence, the Manager account through `AccountsService.createOrganizationAccount(..., tx)`, the membership and the first transition; notify Staff after commit; duplicate tax code or Manager email 409 `CONFLICT_UNIQUE` (MSG10)
  - **Test**: duplicate tax code; duplicate email in another organization; a failure after the account insert rolls everything back
  - **Partly done** (2026-10-27, by LongLP for Review 2 in this lane): `OrganizationOnboardingService.register` creates the organization `PENDING` with the next `ORG-` code, the Manager account through `createOrganizationAccount` (the invitation goes after commit), the `MANAGER` membership and the first transition in one transaction; a taken tax code or email is 409 `CONFLICT_UNIQUE`, and a race on the unique index answers the same. `auth.invitationTtlHours` is read before the transaction, because `ParameterService` reads on the shared client even inside one (treklink-web#87) and PGlite waited on it until the timeout. Served as `POST /api/organizations/register` (public, in the route-guard list) with MSG04. Walked on local PGlite. Unit-tested 2026-10-28 in `organization-onboarding.service.spec.ts` (one transaction, the taken tax code before it, a racing unique violation, another failure passed through). Open: the Staff notification after commit, and the rollback after the account insert on Postgres (`test:db`)
  - _Requirements: REQ-EVT-01, REQ-ERR-01, AC-01, FR-ORG-01, BR-01_
  - _Story: US-UC01_
- [ ] 2.2 Verification with contract terms (owner TanNB)
  - **Do**: `verify(id, dto, staff)` on a `PENDING` organization: method, documents seen, master contract reference, `ndaSigned` and `softwareLicenceSigned`; either false 400 `CONTRACT_TERMS_MISSING` and nothing stored; sets `verifiedAt` and notifies Admins
  - **Test**: AC-09; a second verification overwrites the first only while `PENDING`
  - **Partly done** (2026-10-27, LongLP): `verify` refuses an unsigned NDA or software licence with 400 `CONTRACT_TERMS_MISSING` before anything is read, locks the row, requires `PENDING` (409 `INVALID_STATE_TRANSITION`), compares the version (409 `STALE_VERSION`) and stores method, documents, contract number, both terms, `verifiedAt` and `verifiedById`, with an `organization.verified` audit record. `POST /api/organizations/:id/verification` (`organization.verify`). Unit-tested 2026-10-28 (both terms, 404, not `PENDING`, `STALE_VERSION` with no audit). Open: the Admin notification
  - _Requirements: REQ-EVT-02, REQ-ERR-07, AC-09, FR-ORG-02, BR-43_
  - _Story: US-UC02_
- [ ] 2.3 Approval and rejection (owner TanNB)
  - **Do**: `approve(id, admin)` requires `verifiedAt` (409 `NOT_VERIFIED`, MSG21), moves to `ACTIVE`, emails MSG05; `reject(id, reason, admin)` moves to `REJECTED` (MSG16)
  - **Test**: AC-02
  - **Partly done** (2026-10-27, LongLP): `approve` requires `PENDING` and `verifiedAt` (409 `NOT_VERIFIED`, MSG21) and moves to `ACTIVE`; `reject` moves to `REJECTED` with the reason; both compare the version, write `decidedAt`, `decidedById` and an `OrganizationTransition`, and an audit record. `POST /api/organizations/:id/approve` and `.../reject` (`organization.decide`, Admin). The list `GET /api/organizations` (api-design 02) filters by status and `q`, with `organization.verify` (Staff and Admin). Walked on local PGlite: every refusal of api-design 05 to 07 answers as specified. Unit-tested 2026-10-28 (approve held until verified, reject with the reason, not `PENDING`, `STALE_VERSION` with no transition, 404, the transitions and audit records). Open: the MSG05 and MSG16 emails, and the lifecycle table of 1.2 (transitions are inline for these two pairs)
  - _Requirements: REQ-EVT-03, REQ-ERR-02, AC-02, FR-ORG-03_
  - _Story: US-UC03_
- [ ] 2.4 Suspension, reactivation, closing (owner TanNB)
  - **Note** (2026-10-28): LongLP built the two calls rentals 3.2 needs: `suspendForDefault(orgId, contractCode, at, tx)` moves an `ACTIVE` organization to `SUSPENDED` by SYSTEM in the caller's transaction with a transition naming the contract (any other status is left as it is), and `emailContact(orgId, subject, text)` mails the contact address through `MAIL_PORT`, logging a failed send. Unit-tested. The rest of this task stays open: `suspend` and `reactivate` by an Admin, `close`, and the exit checks
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
  - **Partly done** (2026-10-30, TanNB): `MembersService`, `MembersController` and `dto/members.dto.ts` serve api-design 13 to 15 (`member.manage.own`, no new permission). Every change locks the organization row, then: an invitation creates the account through `createOrganizationAccount` (invitation after commit) and the `invitedById` membership; a role change goes through `setOrganizationRole`; a deactivation goes through `deactivateOrganizationAccount`, empties the member's slots in every shift that has not ended, a shift in progress included (`RosterRepository.clearMember`), and emits `member.deactivated` after commit. Rules decided with the owner: members can be managed while the organization is `ACTIVE` or `SUSPENDED` (any other status is 409 `INVALID_STATE_TRANSITION`, MSG28); only a Manager who has set a password counts as an active Manager for `LAST_MANAGER`; a Manager may demote or deactivate themselves while another active Manager remains; a deactivated member is 404 for a role change or a second deactivation and cannot be reinvited (no endpoint reactivates, the email stays registered). `invitationPending` is now false for a deactivated member. New error code `LAST_MANAGER`. Unit-tested to the D-053 bar; `test/members.db-spec.ts` covers AC-03 under concurrency, the invitation rollback and the cleared shifts, written 2026-10-30 and not yet run (`test:db` needs Postgres). Open: the e2e rows of 4.2, and `incidents` does not listen to `member.deactivated`, so an incident the member owned does not go back to `NOTIFY_BACKUP` (D-034) until it does. api-design 14 and 15 list no 409 `INVALID_STATE_TRANSITION` and 13 names only `CLOSED`, which the code answers for `PENDING`, `REJECTED` and `CLOSED`: raised to the leader
  - _Requirements: REQ-UBI-02, REQ-EVT-07, REQ-EVT-08, REQ-ERR-03, AC-03, FR-ORG-04, FR-AUTH-07_
  - _Story: US-UC04_
- [ ] 2.6 Roster (owner TanNB)
  - **Files**: `backend/src/modules/organizations/roster.service.ts`
  - **Do**: create, edit, delete shifts `[startsAt, endsAt)`; primary and backup different active members of the organization (400 `MEMBER_NOT_ELIGIBLE`); overlap rejected by `roster_shifts_no_overlap`, mapped to 409 `SHIFT_OVERLAP`; deleting a started shift 409 `SHIFT_STARTED`; on a started shift PATCH accepts only `endsAt` (any other field 409 `SHIFT_STARTED`, an `endsAt` before now 400 `VALIDATION_FAILED`, ruling 2026-10-30); list returns `NO_PRIMARY` warnings (MSG22); `tiersAt(orgId, instant)` returns primary, backup and active Managers
  - **Test**: AC-04 against Postgres; `tiersAt` with no shift, a shift without primary, and a deactivated backup
  - **Note**: `tiersAt` is built read only by HoangTK in the MF-03 PR (2026-10-29), because incidents routing needs it for D-066. It returns user ids, the ids alert rows and incident owners reference. Shift create, edit, delete, list and AC-04 stay with TanNB
  - **Partly done** (2026-10-30, TanNB): `ShiftsService` (`shifts.service.ts`, kept apart from `RosterService` so the `incidents` read keeps its constructor), `RosterController` and `dto/roster.dto.ts` serve api-design 16 to 19 (`roster.read.own` for Managers and Operators, `roster.manage.own` for Managers, no new permission). Every write locks the organization row and checks overlap with a query before the insert, so two creates racing for one window are told apart in line; the exclusion constraint stays behind as the last guard and its error (constraint name or Postgres code 23P01) is also answered as 409 `SHIFT_OVERLAP`. Rules decided with the owner: shifts can be written while the organization is `ACTIVE` or `SUSPENDED` (any other status is 409 `INVALID_STATE_TRANSITION`, MSG28); a shift that has already ended is 400 `VALIDATION_FAILED`, one in progress is accepted, and a shift lasts at most 31 days; primary and backup must be live members of the organization whose account has set its password (`passwordSet` from `auth`: an invited account is created active and has none until then) and is not deactivated, and different (400 `MEMBER_NOT_ELIGIBLE`); on edit, an absent field is unchanged, `null` empties a slot, and a field sent with its current value is not a change; on a started shift only `endsAt` may change (409 `SHIFT_STARTED`) and not to a time before now; a started shift cannot be deleted; the list warns `NO_PRIMARY` for every gap from now on that no shift with a primary covers, past gaps are not warned about; a saved shift answers `NO_PRIMARY` (with its window) and `NO_BACKUP` when a slot is empty; times need an explicit zone. New error codes `SHIFT_OVERLAP`, `SHIFT_STARTED`, `MEMBER_NOT_ELIGIBLE`. Unit-tested to the D-053 bar; `test/roster.db-spec.ts` covers AC-04 (overlap, touching shifts, two racing creates, the constraint's own error text, started-shift rules, eligibility, warnings), written 2026-10-30 and not yet run (`test:db` needs Postgres). Open: the e2e rows of 4.2, and the unconfirmed text of the database's exclusion error. api-design 17 to 19 list no 409 `INVALID_STATE_TRANSITION` and 17 gives 400 `VALIDATION_FAILED` only for the body, while the code also answers it for an ended shift, a shift over 31 days and a window over 31 days on 16, and 18 lists no `MEMBER_NOT_ELIGIBLE`: raised to the leader
  - _Requirements: REQ-UBI-04, REQ-EVT-10, REQ-STA-02, AC-04, FR-ORG-05, BR-16_
  - _Story: US-UC05_
- [ ] 2.7 API keys (owner TanNB)
  - **Files**: `backend/src/modules/organizations/api-keys.service.ts`
  - **Do**: create `tlk_` plus 43 base64url characters from 32 random bytes, store SHA-256 and the 8-character prefix, return the secret once; limit `organizations.maxApiKeys` (409 `KEY_LIMIT`); revoke emits `apiKey.revoked`
  - **Test**: AC-05; the secret never appears in a list response or the audit entry
  - **Status** (2026-10-30, KhoaDD, D-078 chain 2): `ApiKeysService` and `ApiKeysController` serve api-design 20 to 22 (list `{ items, limit }`, create with 409 `KEY_LIMIT` under an organization row lock, revoke emitting `apiKey.revoked`); `apiKey.read` for TrekLink Staff and Admin by migration `20261030120000_api_key_read`. AC-05 over HTTP end to end is not yet tested (task 4.2), so the box stays open
  - _Requirements: REQ-UBI-03, REQ-EVT-09, REQ-ERR-06, AC-05, FR-ORG-06, BR-20_
  - _Story: US-UC06_
- [ ] 2.8 Field Station credentials and release (owner TanNB)
  - **Files**: `backend/src/modules/organizations/field-stations.service.ts`, `field-station-release.service.ts`
  - **Do**: create `fs_` secret, bcrypt stored, `mqttUsername` `fs-<org code lower-case>-<n>`, returned once; limit `organizations.maxFieldStations` (409 `STATION_LIMIT`); revoke by Manager, Staff or Admin emits `fieldStation.revoked`; `byUsername(username)` and `recordStationHealth(id, health)` for `gateway-sync`; `FieldStationReleaseService.current()` reads `release.json` from `FIELD_STATION_RELEASE_DIR`, cached until the file changes; `outdated` computed on read by semantic-version order
  - **Test**: AC-06 is in gateway-sync 4.2; AC-08 with a fixture `release.json`
  - **Partly done** (2026-10-30, TanNB): `FieldStationsService`, `FieldStationsRepository`, `FieldStationsController`, `FieldStationReleaseService` and `dto/field-stations.dto.ts` serve api-design 23 to 26 (`fieldStation.read.own`, `manage.own`, `read`, `revoke` already in the seed, no migration). Create locks the organization row, counts the active stations against `organizations.maxFieldStations` (409 `STATION_LIMIT`), numbers the username one above the highest used by the organization (revoked ones included, so a username is never given twice), stores only the bcrypt hash (`BCRYPT_COST`) of an `fs_` secret and returns it once with the broker address; it needs an `ACTIVE` organization (any other status is 409 `INVALID_STATE_TRANSITION`, MSG28). Revoke is for the Manager of the organization and for Staff and Admin in any organization, Staff and Admin giving a reason (400 `VALIDATION_FAILED` without one); revoking a revoked station answers it as it is, and a real revoke emits `fieldStation.revoked` (`organizationId`, `fieldStationId`, `mqttUsername`) after commit. The list answers `{ items, limit }` with `queueDepth` as `{p0..p3}` or null before the first report, and `outdated` by semantic-version order against the release (false for a station that has not reported, a version that is not a version, or a release that cannot be read; the list never fails for the release). `FieldStationReleaseService.current()` reads `release.json` from `FIELD_STATION_RELEASE_DIR` and reads it again only when the file's modification time or size changes; a missing directory, file or shape is 503 `RELEASE_UNAVAILABLE`, only on api-design 26. For `gateway-sync` and `monitoring`: `byUsername` (with the secret hash and the revocation), `recordStationHealth` and `isOutdated`, exported from the module. New environment variables `FIELD_STATION_RELEASE_DIR` and `FIELD_STATION_BROKER_URL` (both optional, `.env.example`, platform requirements §4); new error codes `STATION_LIMIT` and `RELEASE_UNAVAILABLE`. Unit-tested to the D-053 bar; `test/field-stations.db-spec.ts` covers the limit under concurrent creates, the numbering, the hash behind a username, the revoke event and the health, written 2026-10-30 and read through CI (`test:db`). Open: the e2e rows of 4.2; the executables are served by the deployment from `/downloads/field-station/<version>/`, not by the backend; revoking the stations of a closed organization is task 2.4. api-design 24 gives a new station `version: "1.2.0"` and `queueDepth: []` in its sample, while the model holds the last reported version and the ruling makes `queueDepth` null before a report: the code answers null for both (raised to the leader)
  - _Requirements: REQ-UBI-03, REQ-EVT-09, REQ-EVT-11, REQ-ERR-06, AC-06, AC-08, FR-EVT-13, FR-EVT-14, FR-EVT-18_
  - _Story: US-UC06_
- [ ] 2.9 Channel key exposure and rotation (owner TanNB)
  - **Do**: `markKeyExposed(orgId)` sets `channelKeyExposedAt` and notifies the Managers; `rotateChannelKey(orgId, staff)` increments `channelKeyVersion` and clears the flag; `channelKeyVersion(orgId)` for rentals provisioning
  - **Test**: AC-11 (the devices side triggers `markKeyExposed` in devices 2.7)
  - **Partly done** (2026-10-30, KhoaDD under D-078): `ChannelKeyService.rotate` and `ChannelKeyController` serve api-design 27 (`organization.rotateKey`, migration `20261030160000_compliance_and_rotation`): an `ACTIVE` or `SUSPENDED` organization only, compare-and-set on `version` (409 `STALE_VERSION`), `channelKeyVersion` increments and `channelKeyExposedAt` clears, audit after commit. Unit-tested. Open: `markKeyExposed` with the Manager notification, and `channelKeyVersion(orgId)` for rentals
  - _Requirements: REQ-EVT-13, AC-11, FR-DEV-13_
  - _Depends on: 1.2_
- [ ] 2.10 Compliance cases (owner TanNB)
  - **Files**: `backend/src/modules/organizations/compliance-case.service.ts`
  - **Do**: open a case with type `SUSPECTED_FRAUD`, `SUSPECTED_THEFT`, `IP_VIOLATION`, `NDA_BREACH` or `OTHER_BREACH`, evidence, linked contracts and loss cases; `openOrLink(orgId, lossCaseId, actor, tx)` for devices; record an action (`SUSPEND_ORGANIZATION` through `suspend`, Admin only; `REVOKE_FIELD_STATION`, `REVOKE_API_KEY`, `OTHER`, the `ComplianceActionKind` values) appending a `ComplianceAction`; `get(id)` returns one case with its actions in recorded order, each with `kind`, `at` and `actor { id, fullName }` from the actor's user (api-design 32; the same action shape in 28, 30 and 31, ruling 2026-10-30); close with outcome and `authorityReference`, required for fraud and theft (409 `POLICE_REFERENCE_REQUIRED`, also the `compliance_cases_police_reference_to_close` CHECK)
  - **Test**: AC-10; `openOrLink` links to an open case of the same type instead of opening a second
  - **Partly done** (2026-10-30, KhoaDD under D-078): `ComplianceCasesService`, `ComplianceCasesRepository` and `ComplianceCasesController` serve api-design 28 to 32 (`complianceCase.manage`, migration `20261030160000_compliance_and_rotation`). `CMP-` codes under an advisory lock; a suspension goes through `OrganizationsService.suspendFromCompliance` in the case transaction (403 without `organization.suspend`); `FieldStationsService.revoke` and `ApiKeysService.revoke` own their transactions, so a revocation runs just before the case transaction, after a check that the case exists and is `OPEN`; close answers 409 `POLICE_REFERENCE_REQUIRED` ahead of the existing CHECK. Unit tests, and `test/compliance-cases.db-spec.ts` for the codes under concurrency, the lock, the action and the CHECK. Open: `openOrLink` for devices and linking loss cases (a non-empty `linkedLossCaseIds` is 400 and `linkedLossCases` is always empty until `devices` provides a port; the id contract is with the leader)
  - _Requirements: REQ-EVT-12, REQ-ERR-08, AC-10, FR-ORG-08, FR-ORG-09, BR-40_
  - _Story: US-UC63_

## Phase 3: Query / Retrieval

- [ ] 3.1 Lists and details (owner TanNB)
  - **Do**: organizations list for Staff with status and search filters, paged; detail for Staff or own members; transitions; members; roster for a date range; keys and stations with health, each list returned as `{ items, limit }` with `limit` from `organizations.maxApiKeys` or `organizations.maxFieldStations` (ruling 2026-10-30); API keys readable by Staff and Admin for any organization (api-design 20), through a new permission `apiKey.read` (`read` on `ApiKey`, no condition) granted to TrekLink Staff and Admin by a forward migration, because the seed migration is already applied on the shared database; compliance cases with type and status filters, and one case with its actions (api-design 32)
  - **Test**: paging and each filter; a member reading another organization gets 404
  - _Requirements: REQ-ERR-05, FR-AUTH-11_

## Phase 4: API Presentation Layer

- [ ] 4.1 Controllers (owner TanNB)
  - **Files**: `organizations.controller.ts`, `members.controller.ts`, `roster.controller.ts`, `credentials.controller.ts`, `compliance-cases.controller.ts`
  - **Do**: api-design 01 to 32 with each file's permission and `@ResponseMessage`; the registration endpoint is public; `/api/organizations/:id/field-stations/release` declared before `/:stationId` routes
  - **Note**: LongLP opened `organizations.controller.ts` for the counter handover (2026-10-27): 03 `GET /api/organizations/:id` answering only its head (`id`, `code`, `legalName`, `status`, `statusChangedAt`, `channelKeyVersion`, `version`; `organization.read`, `organization.read.own`), and 12 `GET /api/organizations/:id/members` (`member.read`, `member.read.own`). Another organization answers 404. The rest of 03 (the verification record and the counts) joins with 1.1 and 2.4
- [ ] 4.2 E2E (owner TanNB)
  - **Files**: `backend/test/organizations.e2e-spec.ts`, `backend/test/tenancy.e2e-spec.ts`
  - **Do**: every Validation row of api-design 01 to 32; AC-01 to AC-11 except AC-06 (gateway-sync 4.2); cross-organization 404 for every route with `:id`
  - _Requirements: AC-01 to AC-11_

## Phase 5: Frontend Integration

- [ ] 5.1 Registration page, Staff verification queue with the NDA and licence checkboxes, Admin approvals, Manager pages for members, roster, API keys, Field Stations and the release download, Staff compliance cases and key rotation (owner LongNN, tracked in `specs/frontend/tasks.md` 3.1 to 3.6; the registration page and the Staff and Admin review page, 3.1 and 3.2, are LongLP's from 2026-10-27, issue #98)

## Phase 6: Verification & DoD

- [ ] 6.1 Suite green; lint, boundary check, typecheck clean; `api-design/*.md` matching behaviour (owner TanNB)
