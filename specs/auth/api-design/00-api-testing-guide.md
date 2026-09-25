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
