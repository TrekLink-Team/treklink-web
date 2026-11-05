# Organizations verification, 2026-11-04

Audit base: `dev` ac99628af1831e2aa7558e0bad317fe5e4eb04ad. Its CI run
[41771163720](https://github.com/TrekLink-Team/treklink-web/actions/runs/41771163720) finished with
success for Backend (NestJS), Frontend (React) and Gateway Bridge. The backend job runs `test:db`
(`.github/workflows/ci.yml`, "Backend database integration tests"), so the `*.db-spec.ts` evidence below
is the result of that run on this exact commit. I did not run it on the audit machine (no Postgres
here); the reviewer ran the db-specs locally on 2026-11-04 and reports 48 suites and 266 tests passing. This record changes no production code. It maps the 41 criteria of
`specs/organizations/requirements.md` (29 REQ and 12 AC) to code and tests, and it follows the format of
`specs/incidents/verification-2026-11-02.md`.

Method and limit: I read the cited code paths and the titles and bodies of the cited tests. I did not
re-read every assertion of every test. A criterion is "Verified" when a code path and a test that
exercises its stated behaviour are both named. "Partly" says what is missing, "Gap" means no code or no
test was found, "Verified elsewhere" points to the module that owns the proof.

## Checklist evidence

| Criterion | Result | Evidence and limit |
| --- | --- | --- |
| Whole local backend suite green | Verified | On ac99628a: unit 257 suites, 2984 tests; e2e 22 suites, 461 tests; all pass. |
| Latest dev Linux CI green | Verified | CI 41771163720 on ac99628a, three jobs success, `test:db` included. |
| Backend lint and typecheck | Verified, zero errors | `tsc --noEmit` exit 0; eslint exit 0 with one old warning (`backend/test/incidents.e2e-spec.ts:313`, unused `_omitted`). Not a zero-warning claim. |
| Module boundaries | Verified | `check-module-boundaries.js`: 581 files, 57 owned models, 10 modules in an acyclic graph. |
| Frontend gates | Verified | `tsc --noEmit` exit 0; eslint exit 0 with one old warning (`CounterPaymentDialog.tsx:15`); vitest 119 files, 1348 tests pass; `npm run build` exit 0. |
| api-design 01 to 32 against the catalog | Verified | `build_api_design.py organizations` regenerates all files with no content difference (line endings only). This proves the catalog equals the files. It does not prove the files equal the code. On 2026-11-05 I compared the error rows of api-design 08 to 11 and 13 to 19 with the code (gap 7); the other 21 files were not compared. 33 is a proposal and is not built (see the gaps). |
| Playwright journeys | Unchecked | `frontend/e2e/mf-01a-onboarding.spec.ts` (steps 1 to 8) and `mf-01-request-to-handover.spec.ts` exist. No Playwright job is in `ci.yml` at this base and Playwright is not installed on the audit machine, so no run exists. |

## Requirements

| ID | Result | Code | Tests and limit |
| --- | --- | --- | --- |
| REQ-UBI-01 | Verified | `organization-lifecycle.ts` (`TRANSITIONS`, `transition`) | `organization-lifecycle.spec.ts` (the table, locks, version, SYSTEM actor, stale version); `organization-lifecycle.db-spec.ts` "suspends and reactivates, writing a transition each". |
| REQ-UBI-02 | Verified | `members.service.ts` (`LAST_MANAGER`, organization row lock); `OrganizationMember.userId @unique` (`schema.prisma:462`) | `members.service.spec.ts` (AC-03 rows); `members.db-spec.ts` "lets only one of two concurrent demotions ...", "... a concurrent demotion and deactivation". |
| REQ-UBI-03 | Verified | `api-keys.service.ts` (`generateApiKey`, SHA-256); `field-stations.service.ts` (bcrypt) | `api-keys.service.spec.ts` "stores the prefix and the SHA-256 hash, returns the key once and audits no secret"; `api-keys.db-spec.ts` "lists the keys ... never the hash or the secret"; `field-stations.service.spec.ts` "stores only the bcrypt hash ..."; `field-stations.db-spec.ts` "stores only the hash of the secret ...". |
| REQ-UBI-04 | Verified | `shifts.service.ts` (overlap and eligibility); exclusion constraint `roster_shifts_no_overlap` in `20261004120000_initial_schema` | `roster.db-spec.ts` "refuses an overlapping shift ...", "is guarded by the database too", "refuses a member who is deactivated, has no password yet, or is in both slots". |
| REQ-EVT-01 | Verified | `organization-onboarding.service.ts` `register` | `organization-onboarding.service.spec.ts` "creates the PENDING organization, the Manager account, the membership and the first transition in one transaction"; `organization-registration.db-spec.ts` (writes together, rolls back); `onboarding.notifier.spec.ts` "tells Staff of a registration". |
| REQ-EVT-02 | Verified | `organization-onboarding.service.ts` `verify` | `organization-onboarding.service.spec.ts` verify rows; `onboarding.notifier.spec.ts` "tells Staff and Admin that a verified organization awaits approval". |
| REQ-EVT-03 | Verified | `organization-onboarding.service.ts` approve and reject | spec "approves a verified PENDING organization to ACTIVE ...", "rejects a PENDING organization with the reason ..."; `onboarding.notifier.spec.ts` MSG05 and MSG16 rows. |
| REQ-EVT-04 | Verified | `organization-status.service.ts` `suspend`; `OrganizationsService.suspendForDefault` | `organization-status.service.spec.ts` "suspends an ACTIVE organization ..."; `organization-lifecycle.db-spec.ts` "suspends for a defaulted contract as SYSTEM, inside the caller transaction". |
| REQ-EVT-05 | Verified | `organization-status.service.ts` `reactivate` over `ORGANIZATION_EXIT_CHECKS` | spec "returns a SUSPENDED organization to ACTIVE ...", "answers 409 BALANCE_OUTSTANDING ..."; db-spec "reactivates a suspended organization whose only unpaid line is a future installment", "refuses with 409 BALANCE_OUTSTANDING while a line due before now is unpaid". |
| REQ-EVT-06 | Verified | `organization-status.service.ts` `close` (members, keys, stations) | spec "closes an ACTIVE organization, deactivating its members and revoking its keys and stations ..."; db-spec "closes an organization: members deactivated, keys and stations revoked ...", "rolls the whole closing back". |
| REQ-EVT-07 | Verified | `members.service.ts` invite, `changeRole`, `deactivate` through `auth` | `members.service.spec.ts` invite, changeRole and deactivate groups; `members.db-spec.ts` "invites a member inactive with a set-password code ..."; the backup-tier move of a deactivated owner is `incidents-owner-deactivation.db-spec.ts` "returns an acknowledged incident of a deactivated owner to NOTIFY_BACKUP and alerts the backup" through `OwnerDeactivationListener`. |
| REQ-EVT-08 | Verified | `members.service.ts` calls `roster.clearMember` | `members.service.spec.ts` "ends the account, marks the member, clears the shifts and emits member.deactivated"; `members.db-spec.ts` "deactivates a member, clears the shifts that have not ended ...". |
| REQ-EVT-09 | Verified | `api-keys.service.ts` (32 random bytes), `field-stations.service.ts`; `apiKey.revoked`, `fieldStation.revoked` events | `api-keys.service.spec.ts` "is tlk_ and 43 base64url characters, different every time", revoke rows; `field-stations.service.spec.ts` "generates a secret of fs_ and 43 base64url characters each time", "lets TrekLink Staff revoke in any organization with a reason ..."; `api-keys.db-spec.ts` "stops resolving a revoked key, emits apiKey.revoked and frees a slot". |
| REQ-EVT-10 | Verified | `roster.service.ts:23` `tiersAt` | `roster.service.spec.ts` "gives empty tiers for no shift, or a shift without a primary or with a deactivated backup", "keeps only the members of the organization that are not deactivated". |
| REQ-EVT-11 | Verified | `field-station-release.service.ts`; `field-stations.service.ts` `recordStationHealth` | `field-station-release.service.spec.ts` "reads release.json and gives the version and one download per file with its SHA-256"; `field-stations.db-spec.ts` "records the health a station reports ...". |
| REQ-EVT-12 | Verified | `compliance-cases.service.ts` `open`, `openOrLink`, record action, `close` | `compliance-cases.service.spec.ts` (25 tests); `compliance-cases.db-spec.ts` "gives two cases opened at the same moment distinct CMP- codes", "locks a case, appends an action and closes it once"; `loss-cases.db-spec.ts` two triages sharing a case. I did not re-read each action test. |
| REQ-EVT-13 | Verified | `channel-key.service.ts` `markKeyExposed`, `rotate`; `devices` `loss-cases.service.ts` calls it | `channel-key-exposed.service.spec.ts`, `channel-key.service.spec.ts` (rotate), `key-exposed.notifier.spec.ts`; `loss-cases.db-spec.ts` (flag set in the triage transaction). The refusal of an exposed key in the counter endpoints is in PR #358, not in this base. |
| REQ-EVT-14 | Gap | No route `GET /api/organizations/:id/roles` and no `organizationRole.read` check in the organizations controllers | None. Task 4.3 is a proposal of D-095, tracked by treklink-web#304 ("API 33 and the read-only section"). |
| REQ-STA-01 | Verified | `organizations.service.ts:178` `assertActive`; the resolution of roster, keys and stations does not read the status | `contracts-http.db-spec.ts` "01: a request from an organization that is not ACTIVE is ORGANIZATION_NOT_ACTIVE"; `broker-hooks.db-spec.ts` "refuses a station of a CLOSED organization and still admits one of a SUSPENDED organization". |
| REQ-STA-02 | Verified | `shifts.service.ts` (`NO_PRIMARY`, lines 143 and 346) | `roster.db-spec.ts` "lists the shifts of the window with a NO_PRIMARY warning for the gap". |
| REQ-STA-03 | Partly | The status gate of the role save is in `auth` (`OrganizationRolePolicyService`, #328 and #336) | `organization-role-policy.db-spec.ts`, `organization-roles.e2e-spec.ts`. The Manager read while the organization is `PENDING` or `SUSPENDED` and the closed-organization clause were not re-read here. The TrekLink read is the gap of REQ-EVT-14. |
| REQ-ERR-01 | Verified | `organization-onboarding.service.ts:102`; `members.service.ts:94` | onboarding spec "refuses a tax code already registered with 409 CONFLICT_UNIQUE (MSG10) and creates nothing", "turns a unique index violation of a racing registration into 409 CONFLICT_UNIQUE"; `members.service.spec.ts` "passes the email conflict of auth through (MSG10)". |
| REQ-ERR-02 | Verified | `organization-onboarding.service.ts:242` | spec "refuses to approve an organization not yet verified with 409 NOT_VERIFIED (MSG21)". |
| REQ-ERR-03 | Verified | `members.service.ts:222` | `members.service.spec.ts` "refuses to demote the last active Manager (AC-03) and writes nothing", "refuses to deactivate the last active Manager"; `members.db-spec.ts` concurrent rows. |
| REQ-ERR-04 | Verified | `organization-status.service.ts` (`canReactivate`, `canClose`) | spec "answers 409 BALANCE_OUTSTANDING with the check message ...", "answers 409 OPEN_CONTRACTS when a check reports a contract ..."; db-spec "refuses a closing while a check reports an open contract, and changes nothing". |
| REQ-ERR-05 | Verified | `scopeWhere` and the service scope checks | `organizations.e2e-spec.ts` "tenant isolation: another organization is 404" (every `:id` route a Manager may call); `tenancy.e2e-spec.ts` "keeps a member to its organization whatever the token or query claims". Limit: the 404 of Staff and Admin routes is read through `organization-lifecycle.db-spec.ts`, as `tasks.md` 4.2 already says. |
| REQ-ERR-06 | Verified | `api-keys.service.ts:67`; `field-stations.service.ts` limit | `api-keys.service.spec.ts` "answers 409 KEY_LIMIT at organizations.maxApiKeys active keys"; `api-keys.db-spec.ts` "creates keys up to the limit, also when two creates race for the last slot"; `field-stations.service.spec.ts` "refuses a create at the limit with 409 STATION_LIMIT and stores nothing"; `field-stations.db-spec.ts` "lets only two of three concurrent creates pass at a limit of two". |
| REQ-ERR-07 | Verified | `organization-onboarding.service.ts:166` | spec "refuses a contract without %s with 400 CONTRACT_TERMS_MISSING and stores nothing". |
| REQ-ERR-08 | Verified | `compliance-cases.service.ts:306` | spec "refuses closing a %s case without authorityReference with 409 POLICE_REFERENCE_REQUIRED"; db-spec "refuses closing a suspected theft case without a police reference (BR-40 CHECK)". |

## Acceptance criteria

| ID | Result | Evidence and limit |
| --- | --- | --- |
| AC-01 | Partly | Backend pieces are Verified: register, verify, approve (REQ-EVT-01 to 03) and the refusal of a request while the organization is not `ACTIVE` (`contracts-http.db-spec.ts`). The journey itself is `frontend/e2e/mf-01a-onboarding.spec.ts` (steps 1 to 8, TC-01) and has not run anywhere at this base. |
| AC-02 | Verified | Onboarding spec "refuses to approve an organization not yet verified with 409 NOT_VERIFIED (MSG21)". |
| AC-03 | Verified | `members.service.spec.ts` and `members.db-spec.ts` rows of REQ-ERR-03. |
| AC-04 | Verified | `roster.db-spec.ts` "refuses an overlapping shift with 409 SHIFT_OVERLAP and accepts one that only touches". |
| AC-05 | Verified (after the audit base) | At the audit base the pieces were tested apart (`api-keys.db-spec.ts` "resolves a live key by hash and records its use once a minute", "stops resolving a revoked key ..."; `route-guards.e2e-spec.ts`). The whole path is now one test, `test/org-api-http.db-spec.ts` "works with a created key and returns 401 after the key is revoked (AC-05)" (NgocLong216, `dev` 85088c22, after the audit base; its CI run is green with `test:db`; I read the test and did not run it). |
| AC-06 | Verified elsewhere | `broker-hooks.db-spec.ts` "accepts a new station with its secret and refuses it at its next connection once revoked" (gateway-sync 4.2). |
| AC-07 | Verified in an open PR | The contract request refusal is Verified (`contracts-http.db-spec.ts` 01, with a `SUSPENDED` organization). At the audit base no test routed an SOS from a device of a `SUSPENDED` organization to its primary, because neither `tiersAt` nor the incidents routing reads the organization status. TC-32 now has its own test: `test/incidents-suspended-organization.db-spec.ts` "routes the SOS to the primary of the shift in progress, ahead of the TrekLink accounts" and "still goes to UNROUTED when the suspended organization has nobody to alert" (treklink-web#387, CI green with `test:db`, not merged yet). The row becomes Verified when that PR merges. |
| AC-08 | Verified | `field-station-release.service.spec.ts` "reads release.json and gives the version and one download per file with its SHA-256", "gives null instead of failing for the list of stations, and tells outdated by the release"; `field-stations.service.spec.ts` "lists the stations with the health, the limit and the outdated flag". |
| AC-09 | Verified | Onboarding spec "refuses a contract without %s with 400 CONTRACT_TERMS_MISSING and stores nothing". |
| AC-10 | Verified | `compliance-cases.db-spec.ts` "refuses closing a suspected theft case without a police reference", "locks a case, appends an action and closes it once"; service spec POLICE_REFERENCE_REQUIRED rows. |
| AC-11 | Verified | Triage sets the flag and the Managers are told (`loss-cases.db-spec.ts`, `loss-cases.service.spec.ts`, `key-exposed.notifier.spec.ts`); the rotation clears it and raises the version (`ChannelKeyService.rotate`, `channel-key.service.spec.ts`). The criterion said re-provisioning; it now says the rotation, as REQ-EVT-13 does (treklink-web#366). |
| AC-12 | Gap | Needs API 33 (REQ-EVT-14). The role save gate of REQ-STA-03 exists in `auth`. |

## Non-functional rows

| Property | Result | Evidence and limit |
| --- | --- | --- |
| Cross-organization denial: every route of this module | Verified for `:id` routes a Manager may call | `organizations.e2e-spec.ts` "tenant isolation: another organization is 404". Staff and Admin routes: see REQ-ERR-05. |
| API key lookup by hash at most 5 ms p95 | Unchecked | The unique index exists and `api-keys.db-spec.ts` covers the lookup, but no timing measurement exists. |

## Controllers (task 4.1)

| Check | Result | Evidence and limit |
| --- | --- | --- |
| Every route has a policy | Verified | The nine controllers declare 32 routes. Each has `@CheckPolicies` except `POST /api/organizations/register`, which is `@Public()`. `route-guards.e2e-spec.ts` "declares a policy on every mutating route, except the listed public and token-only ones" and "gives every route a guard marking, so none relies on the fail-closed default" fail when one is missing. |
| The ability on each route is the right one | Partly | I read the ability named on each of the 32 routes (for example `suspend` on `Organization` for suspend and reactivate, `decide` for approve, reject and close, `rotateKey` for the rotation). I did not compare each with the permission column of its api-design file, and the role grants live in the `auth` seed, which I did not re-read. |

## Frontend (task 5.1)

Pages exist with component tests for the Manager side (`MembersPage`, `RosterPage`, `ApiKeysPage`,
`FieldStationsPage` with the release card of api-design 26), for Staff (`StaffFieldStationsPage`,
`ComplianceCasesPage`, `ComplianceCasePage`, the `ChannelKeySection` widget for the rotation) and for
onboarding (`OnboardingPages.test.tsx` covers `RegisterPage` and `OrganizationReviewPage`). I did not
inspect the Staff verification queue and the Admin approvals page by page, and no browser run of these
screens exists at this base (see the Playwright row), so 5.1 is recorded as partly done.

## Remaining gaps

1. **API 33 and REQ-EVT-14, REQ-STA-03 read, AC-12.** Not built; already tracked by treklink-web#304.
2. **TC-32 / AC-07.** Test written after the audit base in treklink-web#387 (CI green); closed when it merges.
3. **AC-05 over HTTP.** Closed after the audit base by `dev` 85088c22 (treklink-web#365).
4. **AC-11 wording.** Closed in this change: the criterion now names the rotation (treklink-web#366).
5. **Playwright.** The MF-01 and MF-01a journeys have never run at this base and cover AC-01.
6. **Performance row.** No measurement of the API key lookup.
7. **Documentation drift raised earlier (tasks.md 2.4, 2.5, 2.6): settled.** api-design 11 once sampled
   `actor` as a role label and 14, 15 and 17 to 19 once omitted 409 and 400 rows. On 2026-11-05 I read the
   current files against the throw sites of the status, members and shifts services: the rows match (11 files:
   08 to 11 and 13 to 19). The first version of this record repeated the older notes of `tasks.md` without
   opening the files; that was wrong. Limit: a malformed id in the path (`ParseUUIDPipe`, 400) is not listed on
   any endpoint without a body or query, because the generator adds the 400 row only for a body or a query;
   this is the same in all 32 files and was not changed. The other 21 files were not compared.

The suite including the `*.db-spec.ts` files is green in CI on the audit base, but the parent task 6.1
also requires `api-design/*.md` matching behaviour, and only 11 of the 32 files were compared with the
code. Tasks 2.4, 4.2, 4.3, 5.1 and 6.1 stay open with a dated line each; 14 of 19 are ticked. No Jira story is
changed by this record.
