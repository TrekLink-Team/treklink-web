# API Design Index: auth

> Generated from `scripts/specs/endpoints/auth.py`. Contract: D-002 envelope; on failure `result = { errorCode }` (`specs/platform/requirements.md` REQ-UBI-04). Organization members and API keys only ever see their own organization's records (FR-AUTH-11).

| # | Method | Route | Permission | Spec File |
| --- | --- | --- | --- | --- |
| 01 | POST | `/api/auth/login` | Public | [01-post-auth-login.md](01-post-auth-login.md) |
| 02 | POST | `/api/auth/refresh` | Public (refresh token) | [02-post-auth-refresh.md](02-post-auth-refresh.md) |
| 03 | POST | `/api/auth/logout` | Any signed-in user | [03-post-auth-logout.md](03-post-auth-logout.md) |
| 04 | GET | `/api/auth/me` | Any signed-in user | [04-get-auth-me.md](04-get-auth-me.md) |
| 05 | POST | `/api/auth/password/forgot` | Public | [05-post-auth-password-forgot.md](05-post-auth-password-forgot.md) |
| 06 | POST | `/api/auth/password/reset` | Public | [06-post-auth-password-reset.md](06-post-auth-password-reset.md) |
| 07 | POST | `/api/auth/password/set` | Public | [07-post-auth-password-set.md](07-post-auth-password-set.md) |
| 08 | POST | `/api/auth/password/change` | Any signed-in user | [08-post-auth-password-change.md](08-post-auth-password-change.md) |
| 09 | GET | `/api/accounts` | TrekLink Admin | [09-get-accounts.md](09-get-accounts.md) |
| 10 | POST | `/api/accounts` | TrekLink Admin | [10-post-accounts.md](10-post-accounts.md) |
| 11 | PATCH | `/api/accounts/:id` | TrekLink Admin | [11-patch-accounts-id.md](11-patch-accounts-id.md) |
| 12 | POST | `/api/accounts/:id/deactivate` | TrekLink Admin | [12-post-accounts-id-deactivate.md](12-post-accounts-id-deactivate.md) |
| 13 | POST | `/api/accounts/:id/reactivate` | TrekLink Admin | [13-post-accounts-id-reactivate.md](13-post-accounts-id-reactivate.md) |
| 14 | POST | `/api/accounts/:id/password-reset` | TrekLink Staff, TrekLink Admin | [14-post-accounts-id-password-reset.md](14-post-accounts-id-password-reset.md) |
| 15 | GET | `/api/roles` | TrekLink Admin | [15-get-roles.md](15-get-roles.md) |
| 16 | PUT | `/api/roles/:id/permissions` | TrekLink Admin | [16-put-roles-id-permissions.md](16-put-roles-id-permissions.md) |
| 17 | GET | `/api/auth-events` | TrekLink Admin | [17-get-auth-events.md](17-get-auth-events.md) |


Manual testing: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
