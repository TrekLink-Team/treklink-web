# API Design Index: platform

> Generated from `scripts/specs/endpoints/platform.py`. Contract: D-002 envelope; on failure `result = { errorCode }` (`specs/platform/requirements.md` REQ-UBI-04). Organization members and API keys only ever see their own organization's records (FR-AUTH-11).

| # | Method | Route | Permission | Spec File |
| --- | --- | --- | --- | --- |
| 01 | GET | `/api/health` | Public | [01-get-health.md](01-get-health.md) |
| 02 | GET | `/api/parameters` | TrekLink Admin | [02-get-parameters.md](02-get-parameters.md) |
| 03 | PATCH | `/api/parameters/:key` | TrekLink Admin | [03-patch-parameters-key.md](03-patch-parameters-key.md) |
| 04 | GET | `/api/parameters/:key/history` | TrekLink Admin | [04-get-parameters-key-history.md](04-get-parameters-key-history.md) |
| 05 | GET | `/api/audit-logs` | TrekLink Admin | [05-get-audit-logs.md](05-get-audit-logs.md) |


Manual testing: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
