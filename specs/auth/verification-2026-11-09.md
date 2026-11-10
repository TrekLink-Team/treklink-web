# Auth verification, 2026-11-09

Audit base: `dev` 9a67c926. Owner: TanNB (Jira TK-210). This record changes no production code and no test. It maps
the 10 acceptance criteria and the requirements of `specs/auth/requirements.md` to code and tests, in the format of
`specs/organizations/verification-2026-11-04.md`.

Method and limit: I read the titles of the cited tests and, for the account session, the code path of
`account-session.service.ts`. I did not re-read every assertion and I ran no test: there is no Postgres on the audit
machine, so a `*.db-spec.ts` row rests on the title and on CI (`test:db` runs in the Backend job of `ci.yml`), not on a
local run. "Verified" means a code path and a test of the stated behaviour are both named. "Partly" says what is
missing. "Unchecked" means I did not look for or did not find evidence. Update of 2026-11-10: AC-04, REQ-EVT-07,
REQ-STA-03, REQ-ERR-04 and REQ-ERR-05 moved from Partly to Verified after the tests of treklink-web#446; the rest of
the record is as audited at the base above.

## Acceptance criteria

| ID | Result | Evidence and limit |
| --- | --- | --- |
| AC-01 | Verified | `tenancy.e2e-spec.ts` "answers 404 to an Org Operator for another organization's incident (AC-01)" and "answers 200 to TrekLink Staff for the same incident (AC-01)". e2e with stubbed Prisma. |
| AC-02 | Verified | `auth.e2e-spec.ts` "rotates the refresh token and revokes the family when a rotated one returns (api-design 02, AC-02)"; `token.service.spec.ts` "revokes the whole family when a rotated token is presented again (REQ-ERR-02, AC-02)". |
| AC-03 | Verified | `auth-http.db-spec.ts` "refuses the operator's next acknowledge once the Admin removes incident.respond.own, without a restart (api-design 15, 16; AC-03)" (Postgres, real guards); `tenancy.e2e-spec.ts` same title (stubbed). |
| AC-04 | Verified | `auth-session-lifecycle.db-spec.ts` "ends every session of a member at once when the Manager deactivates it (AC-04, REQ-EVT-07)" (Postgres, real guards, treklink-web#446): after `POST /api/organizations/:id/members/:memberId/deactivate` the refresh answers 401, the old access token answers 401 on `GET /api/auth/me` and on `POST /api/auth/password/change`, and the sign-in is refused like a wrong password. Also `auth.e2e-spec.ts` "answers 401 UNAUTHENTICATED without a token, and once the account is deactivated (AC-04)" and `token.service.spec.ts` "ends every session of an account that may no longer sign in (REQ-EVT-07)" (stubbed data). The membership cache (30 s) is forgotten on `member.deactivated` (`account-session.service.spec.ts`), in-process only; the HTTP test runs in one process. |
| AC-05 | Verified | `route-guards.e2e-spec.ts` "reads a route marked for keys with 200" and "answers 403 on a mutating route, even one marked for keys"; `org-api-http.db-spec.ts` "works with a created key and returns 401 after the key is revoked (AC-05)". The two halves of AC-05 are tested on different routes, not on `acknowledge` itself. |
| AC-06 | Verified | `password.e2e-spec.ts` "lets Staff send a reset code to another account's own email without seeing it (api-design 14, AC-06)" and "never writes a code or a password to a response or a log line (AC-06)"; `mail.spec.ts` "the factory refuses the console transport in production (D-063 rule 4, AC-06)". |
| AC-07 | Verified | `organization-role-policy.db-spec.ts` "applies a revoke to the Operator of one organization only and leaves its Manager untouched (AC-07, AC-10)"; `organization-roles.e2e-spec.ts` "applies a revoke from the next request, leaves the Manager untouched and counts the version (AC-07, AC-10)". |
| AC-08 | Verified | `organization-roles.e2e-spec.ts` "answers 409 MANAGER_LOCKOUT for a Manager set without the protected key (AC-08)" and "answers 400 PERMISSION_OUT_OF_CEILING for a TrekLink key". |
| AC-09 | Partly | `effective-permissions.spec.ts` "ignores a grant outside the ceiling, as when the Admin narrowed the Manager baseline (AC-09)" proves the rule on the pure function. No test replaces the global `ORG_MANAGER` baseline as an Admin and then reads organization B's policy over HTTP or Postgres, so "stays stored" is not tested. `permission-cache.spec.ts` "drops every organization and counts the version for an Admin change" covers the cache half, with a mocked store. |
| AC-10 | Verified | Same two tests as AC-07, which carry the AC-10 label. |

## Requirements

| ID | Result | Evidence and limit |
| --- | --- | --- |
| REQ-UBI-01 | Verified | `accounts.repository.spec.ts` "trims and lower-cases (REQ-UBI-01)", "rejects a mixed-case duplicate email, including soft-deleted accounts (REQ-ERR-05)". Repository spec, not Postgres. |
| REQ-UBI-02 | Verified | `token.service.spec.ts` "signs the access token and stores only the hash of a new refresh token (REQ-UBI-02)"; `password.service.spec.ts`. The "never logs" half is `password.e2e-spec.ts` (AC-06). |
| REQ-UBI-03 | Unchecked | I found no test named for the pairing of `accountType` and role keys. `roles.service.spec.ts` covers the permission side (`PERMISSION_SCOPE_MISMATCH`), not the role side. |
| REQ-UBI-04 | Verified | `route-guards.e2e-spec.ts` "declares a policy on every mutating route, except the listed public and token-only ones", "marks no mutating route for API keys (BR-20)". |
| REQ-UBI-05 | Verified | `effective-permissions.spec.ts`, `ability.factory.spec.ts`. |
| REQ-UBI-06 | Verified | `tenancy.e2e-spec.ts` "keeps a member to its organization whatever the token or query claims (FR-AUTH-11)"; `scoping.spec.ts`. |
| REQ-UBI-07 | Partly | The soft-deleted email row above; no test that a soft-deleted account stays resolvable in an audit trail. |
| REQ-UBI-08 | Partly | `auth-events.service.spec.ts`, `auth.service.spec.ts` and `accounts.service.spec.ts` assert `LOGIN_FAILED`, `ACCOUNT_DEACTIVATED`, `ACCOUNT_REACTIVATED`; `token.service.spec.ts` asserts `TOKEN_REUSE_DETECTED`. I did not enumerate every event type of the criterion (sign-out, refresh, password set, reset, lock). |
| REQ-UBI-09 | Verified | `password.e2e-spec.ts` api-design 14 rows: Staff trigger a code to the account's own email without seeing it. |
| REQ-UBI-10 to REQ-UBI-12 | Verified | `organization-role-policy.service.spec.ts`, `effective-permissions.spec.ts`, `organization-role-policy.db-spec.ts` (ceiling, protected key, Manager keeps `organizationRole.manage.own`). |
| REQ-EVT-01 | Verified | `auth.service.spec.ts` "signs in, resets the failure counter and records the success (REQ-EVT-01)"; `auth.e2e-spec.ts` "signs in and returns both tokens and the account (api-design 01)". |
| REQ-EVT-02 | Partly | Rotation is verified (`token.service.spec.ts`). That a refresh re-reads roles and membership is covered through `eligible` in `account-session.service.spec.ts`, mocked. |
| REQ-EVT-03 | Verified | `token.service.spec.ts` "revokes the presented token of the caller and records the sign-out (REQ-EVT-03)"; `auth.e2e-spec.ts` "returns the caller from me, signs out, and refuses the revoked token". |
| REQ-EVT-04 to REQ-EVT-06 | Verified | `password.e2e-spec.ts` (forgot answers alike, reset ends every session, code refused twice, invitation signs in); `password-flows.service.spec.ts` "sends a SET_PASSWORD code to an account that never set a password (D-059 rule 6)"; `auth-codes.db-spec.ts` (attempt limit under 40 concurrent guesses). |
| REQ-EVT-07 | Verified | See AC-04. |
| REQ-EVT-08 | Verified | `auth-http.db-spec.ts` AC-03 test (Admin replaces a role permission, applies on the next request). |
| REQ-EVT-09 | Verified | `api-key.guard.spec.ts`, `jwt-auth.guard.spec.ts` "hands a request with an X-Api-Key and no bearer token to ApiKeyGuard"; `api-keys.db-spec.ts` "resolves a live key by hash and records its use once a minute" (organizations record). |
| REQ-EVT-10 | Verified | `organization-role-policy.db-spec.ts` (grants and revokes in one version, losers refused), `organization-roles.e2e-spec.ts`, `permission-cache.spec.ts`. |
| REQ-EVT-11 | Partly | See AC-09. |
| REQ-STA-01 | Verified | `auth.service.spec.ts` "locks the account at the threshold and answers 423 (REQ-STA-01)", "counts failures only inside the window", "lets an account in again once its lock has passed"; `auth.e2e-spec.ts` 423 row. |
| REQ-STA-02 | Verified | `auth.service.spec.ts` "refuses a correct password when the account may not hold a session (REQ-STA-02, REQ-STA-03)"; `account-session.service.spec.ts`. |
| REQ-STA-03 | Verified | `account-session.service.spec.ts` "refuses a member of a %s organization" (`CLOSED`, `REJECTED`) and "lets a member of a %s organization in" (`PENDING`, `SUSPENDED`) (unit, mocked provider). Over HTTP against Postgres, `auth-session-lifecycle.db-spec.ts` (treklink-web#446): "lets a member of a %s organization sign in and refresh (REQ-STA-03)", "refuses the sign-in of a member of a %s organization like a wrong password (REQ-STA-03)" and "ends the sessions of a member when an Admin closes the organization (REQ-EVT-06, REQ-STA-03)", where the refresh and `GET /api/auth/me` answer 401 and the sign-in is refused. Limit: a status change made without deactivating the members is seen by an already signed-in member up to 30 s late (membership cache); the HTTP tests set the status before the first sign-in or close through the service, so that window is not asserted. |
| REQ-STA-04 | Verified | `organization-role-policy.db-spec.ts` "refuses a save while the organization is not ACTIVE and reads while it is", "refuses a save when the organization was suspended after the first status read (REQ-STA-04)", "makes a save wait for a suspension in flight and then refuses it". The closed-organization clause (stored rows stay) is by construction, not tested. |
| REQ-ERR-01 | Verified | `auth.e2e-spec.ts` "answers a wrong password and an unknown email with the same 401 body (MSG09)"; `auth.service.spec.ts` rows. |
| REQ-ERR-02 | Verified | See AC-02. |
| REQ-ERR-03 | Verified | `auth-codes.db-spec.ts` (four rows). |
| REQ-ERR-04 | Verified | `password.service.spec.ts` asserts `PASSWORD_POLICY`; `auth-session-lifecycle.db-spec.ts` "refuses a password shorter than auth.passwordMinLength with 400 PASSWORD_POLICY (REQ-ERR-04)" (treklink-web#446) sends a 5-character password to `POST /api/auth/password/change` and checks that the old password still signs in. Limit: only the change route is asserted over HTTP; reset and set share `PasswordService` and have no row of their own. |
| REQ-ERR-05 | Verified | The repository row above and `members.service.spec.ts` (race to `CONFLICT_UNIQUE`); over HTTP, `auth-session-lifecycle.db-spec.ts` "refuses an invitation to the email of a soft-deleted account, in any letter case (REQ-ERR-05)" (treklink-web#446) answers 409 `CONFLICT_UNIQUE`. Limit: the HTTP row covers a soft-deleted holder in another letter case; an active holder is covered by the repository and service specs, not over HTTP. |
| REQ-ERR-06 | Verified | `tenancy.e2e-spec.ts`, `organizations.e2e-spec.ts` "tenant isolation: another organization is 404", `org-api-http.db-spec.ts` "shows a key only the units its own organization holds". |
| REQ-ERR-07 | Verified | `accounts.db-spec.ts` "lets only one of two concurrent deactivations of the last two Admins pass", "... a concurrent demotion and deactivation ..."; `accounts.service.spec.ts` and `accounts.e2e-spec.ts` (`LAST_ADMIN`, `SELF_DEMOTION`). |
| REQ-ERR-08 | Verified | `password.e2e-spec.ts` "answers a second request inside the cooldown as usual and sends nothing (REQ-ERR-08, D-063 rule 2)"; `one-time-code.service.spec.ts` (`OTP_COOLDOWN`). |
| REQ-ERR-09 | Verified | `roles.service.spec.ts` "refuses a permission of the other account type for %s (PERMISSION_SCOPE_MISMATCH)"; `accounts.e2e-spec.ts`. |
| REQ-ERR-10 to REQ-ERR-12 | Verified | `organization-roles.e2e-spec.ts` (`MANAGER_LOCKOUT`, `PERMISSION_OUT_OF_CEILING`, `UNKNOWN_PERMISSION`, `STALE_VERSION`); `organization-role-policy.db-spec.ts` "lets one of two concurrent saves for the same role win and refuses the other with STALE_VERSION". |
| REQ-OPT-01 | Verified | `mail.spec.ts` console and smtp factory rows, "refuses the console transport in production". |

## Gaps to act on

1. **AC-04 and REQ-EVT-07, REQ-STA-03 over HTTP against Postgres.** Closed on 2026-11-10 by treklink-web#446
   (`auth-session-lifecycle.db-spec.ts`); the rows above are now Verified.
2. **AC-09 and REQ-EVT-11.** An Admin narrows the global `ORG_MANAGER` baseline; a stored grant of organization B must
   stay stored and stop applying. Only the pure function is tested.
3. **REQ-ERR-04 and REQ-ERR-05 over HTTP.** Closed on 2026-11-10 by treklink-web#446, for the change route and a
   soft-deleted email; the limits are in the rows above.
4. **REQ-UBI-03, REQ-UBI-07 and REQ-UBI-08.** Pairing of account type and role, audit resolution of a soft-deleted
   account, and the full list of event types. Unchecked or partly checked here.
5. **Playwright.** Closed on 2026-11-10 as a question of fact. The MF-01a and MF-01 journeys of the organizations module
   cover sign-in and the invitation flow, and the CI Playwright job runs
   `npx playwright test --project=desktop a11y mf-01-request mf-01a mf-04 wf-04`, plus the release journey after MF-01
   handover (job log of treklink-web#446, read by the leader in the review of treklink-web#462). So they run in CI at
   this base. I did not read the job log myself.

This record added no test. Gaps 1 and 3 were closed on 2026-11-10 by the tests of treklink-web#446, which the leader ran
against Postgres 16 and which the CI Backend job ran (`test:db`); gap 5 was answered the same day from the CI job log;
gaps 2 and 4 stay open. Whether each becomes a test is a separate decision.
