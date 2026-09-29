# API Testing Guide: auth

Setup, tokens and Postman: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md). Run with `MAIL_TRANSPORT=console` so OTP codes appear in the backend log.

## Walkthrough 1: self-registration (Flow 1)

1. `POST /api/auth/register` with an email and no username. Expect 201 and a derived username.
2. Read the OTP from the backend log line `[MailPort console] VERIFY_EMAIL to ...`.
3. `POST /api/auth/login` before verifying. Expect 401 `INVALID_CREDENTIALS`.
4. `POST /api/auth/register/verify`. Expect 200 with tokens.

## Walkthrough 2: refresh rotation and theft response

1. Log in, keep refresh token R1.
2. `POST /api/auth/refresh` with R1. Expect R2.
3. `POST /api/auth/refresh` with R1 again. Expect 401 `REFRESH_TOKEN_REUSED`.
4. `POST /api/auth/refresh` with R2. Expect 401: the family was revoked.

## Walkthrough 3: Guide scope

1. As `operator`, assign `guide` to trip A only (`PUT /api/trips/{A}/guides`).
2. As `guide`, `GET /api/trips/{A}` returns 200 and `GET /api/trips/{B}` returns 404.
3. As `operator`, assign `guide` to B. As `guide`, repeat without logging in again. Expect 200 for B.

## Walkthrough 4: data-driven role

1. As `admin`, create role `MANAGER` and `PUT /api/roles/{id}/permissions` with read-only keys.
2. Grant it to a Staff user with `PUT /api/users/{id}/roles`.
3. That user can `GET /api/bookings` and receives 403 on `POST /api/bookings/{id}/confirm`.

## Walkthrough 5: TK-22 invited account

1. As `admin`, `POST /api/users` with email, full name, phone number, `accountType=STAFF` and `roleKeys=["GUIDE"]`. Expect 201 with `isActive=false` and no password or invitation token.
2. Read the invitation URL from the console mail adapter. `POST /api/auth/invitations/accept` with its token and a valid password. Expect 200 with `isActive=true`.
3. Submit the same invitation again. Expect 400 `INVITATION_INVALID`.
4. Create another invited account, then `POST /api/users/{id}/invitation/resend`. The first token returns 400 `INVITATION_INVALID`; the new token succeeds.

## Walkthrough 6: TK-22 role and status rules

1. As `admin`, list with `GET /api/users?page=1&limit=20&role=GUIDE&isActive=true`. Expect newest-first results and `{ page, limit, totalCount, totalPages }` metadata.
2. Replace a non-Admin Staff account's roles with `PUT /api/users/{id}/roles`. Its old refresh token and access token must fail immediately.
3. `POST /api/users/{id}/deactivate`. Expect 200 and `isActive=false`; repeat it and expect the same state with 200.
4. `POST /api/users/{id}/reactivate`. Expect 200 with the original roles and profile; repeat it and expect 200.
5. Attempt role replacement or deactivation on an active account holding `ADMIN`. Expect 409 `ACTIVE_ADMIN_IMMUTABLE`.
6. Deactivate an Admin through test setup, then call the reactivation endpoint as another active Admin. Expect 200.
