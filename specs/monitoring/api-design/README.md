# API Design Index: monitoring

> Endpoint designs for `monitoring`, following `treklink-docs/_docs/02-templates/04-api-endpoint-template.md` with Mermaid diagrams (D-017).
> Contract: `{ "result": ..., "isSuccess": bool, "statusCode": int, "message": string }` (D-002); on failure `result` is `{ "errorCode": "..." }` (proposed, see `specs/platform/requirements.md` REQ-UBI-04).

| # | Method | Route | Permission | Spec File | Status |
|---|---|---|---|---|---|
| 01 | GET | `/api/monitoring/snapshot` | Operator, Admin; Guide (own trips) | [01-get-monitoring-snapshot.md](01-get-monitoring-snapshot.md) | Draft |
| 02 | GET | `/api/monitoring/devices/:id/trail` | Operator, Admin; Guide (own trips) | [02-get-monitoring-device-trail.md](02-get-monitoring-device-trail.md) | Draft |
| 03 | WS | namespace `/monitoring` | Authenticated; rooms computed server-side | [03-ws-monitoring-events.md](03-ws-monitoring-events.md) | Draft |

Manual testing: [00-api-testing-guide.md](00-api-testing-guide.md). Shared setup: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
