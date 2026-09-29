# API Design Index: auth

> Endpoint designs for `auth`, following `treklink-docs/_docs/02-templates/04-api-endpoint-template.md` with Mermaid diagrams (D-017).
> Contract: `{ "result": ..., "isSuccess": bool, "statusCode": int, "message": string }` (D-002); on failure `result` is `{ "errorCode": "..." }` (proposed, see `specs/platform/requirements.md` REQ-UBI-04).

| # | Method | Route | Permission | Spec File | Status |
|---|---|---|---|---|---|
| 01 | POST | `/api/auth/register` | Public | [01-post-auth-register.md](01-post-auth-register.md) | Draft |
| 02 | POST | `/api/auth/register/verify` | Public | [02-post-auth-register-verify.md](02-post-auth-register-verify.md) | Draft |
| 03 | POST | `/api/auth/login` | Public | [03-post-auth-login.md](03-post-auth-login.md) | Draft |
| 04 | POST | `/api/auth/refresh` | Public (valid refresh token) | [04-post-auth-refresh.md](04-post-auth-refresh.md) | Draft |
| 05 | POST | `/api/auth/logout` | Authenticated | [05-post-auth-logout.md](05-post-auth-logout.md) | Draft |
| 06 | POST | `/api/auth/password/forgot` | Public | [06-post-auth-password-forgot.md](06-post-auth-password-forgot.md) | Draft |
| 07 | POST | `/api/auth/password/reset` | Public (valid OTP) | [07-post-auth-password-reset.md](07-post-auth-password-reset.md) | Draft |
| 08 | GET | `/api/auth/me` | Authenticated | [08-get-auth-me.md](08-get-auth-me.md) | Draft |
| 09 | PATCH | `/api/auth/me` | Authenticated (self) | [09-patch-auth-me.md](09-patch-auth-me.md) | Draft |
| 10 | POST | `/api/users` | Admin | [10-post-users-create.md](10-post-users-create.md) | TK-22 approved 2026-09-29 |
| 11 | GET | `/api/users` | Admin | [11-get-users-list.md](11-get-users-list.md) | TK-22 approved 2026-09-29 |
| 12 | GET | `/api/users/:id` | Admin | [12-get-users-detail.md](12-get-users-detail.md) | TK-22 approved 2026-09-29 |
| 13 | PATCH | `/api/users/:id` | Deferred outside TK-22 | [13-patch-users-update.md](13-patch-users-update.md) | Deferred |
| 14 | PUT | `/api/users/:id/roles` | Admin | [14-put-users-roles.md](14-put-users-roles.md) | TK-22 approved 2026-09-29 |
| 15 | POST | `/api/users/:id/password-reset` | Operator (Customers), Admin | [15-post-users-password-reset.md](15-post-users-password-reset.md) | Draft |
| 16 | GET | `/api/roles` | Admin | [16-get-roles-list.md](16-get-roles-list.md) | TK-22 approved dependency |
| 17 | PUT | `/api/roles/:id/permissions` | Admin | [17-put-roles-permissions.md](17-put-roles-permissions.md) | Draft |
| 18 | POST | `/api/auth/invitations/accept` | Public with valid invitation | [18-post-auth-invitations-accept.md](18-post-auth-invitations-accept.md) | TK-22 approved 2026-09-29 |
| 19 | POST | `/api/users/:id/invitation/resend` | Admin | [19-post-users-invitation-resend.md](19-post-users-invitation-resend.md) | TK-22 approved 2026-09-29 |
| 20 | POST | `/api/users/:id/deactivate` | Admin | [20-post-users-deactivate.md](20-post-users-deactivate.md) | TK-22 approved 2026-09-29 |
| 21 | POST | `/api/users/:id/reactivate` | Admin | [21-post-users-reactivate.md](21-post-users-reactivate.md) | TK-22 approved 2026-09-29 |

Manual testing: [00-api-testing-guide.md](00-api-testing-guide.md). Shared setup: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
