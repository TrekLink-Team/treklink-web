# API Design Index: platform

> Endpoint designs for `platform`, following `treklink-docs/_docs/02-templates/04-api-endpoint-template.md` with Mermaid diagrams (D-017).
> Contract: `{ "result": ..., "isSuccess": bool, "statusCode": int, "message": string }` (D-002); on failure `result` is `{ "errorCode": "..." }` (proposed, see `specs/platform/requirements.md` REQ-UBI-04).

| # | Method | Route | Permission | Spec File | Status |
|---|---|---|---|---|---|
| 01 | GET | `/api/health` | Public | [01-get-health.md](01-get-health.md) | Draft |
| 02 | GET | `/api/settings/parameters` | Admin, Operator (read only) | [02-get-parameters-list.md](02-get-parameters-list.md) | Draft |
| 03 | PATCH | `/api/settings/parameters/:key` | Admin | [03-patch-parameter-update.md](03-patch-parameter-update.md) | Draft |
| 04 | GET | `/api/settings/parameters/:key/history` | Admin | [04-get-parameter-history.md](04-get-parameter-history.md) | Draft |
| 05 | GET | `/api/audit-logs` | Admin | [05-get-audit-logs-list.md](05-get-audit-logs-list.md) | Draft |

Manual testing: [00-api-testing-guide.md](00-api-testing-guide.md). Shared setup: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
