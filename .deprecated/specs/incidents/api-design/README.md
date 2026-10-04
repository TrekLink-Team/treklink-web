# API Design Index: incidents

> Endpoint designs for `incidents`, following `treklink-docs/_docs/02-templates/04-api-endpoint-template.md` with Mermaid diagrams (D-017).
> Contract: `{ "result": ..., "isSuccess": bool, "statusCode": int, "message": string }` (D-002); on failure `result` is `{ "errorCode": "..." }` (proposed, see `specs/platform/requirements.md` REQ-UBI-04).

| # | Method | Route | Permission | Spec File | Status |
|---|---|---|---|---|---|
| 01 | GET | `/api/incidents` | Operator, Admin; Guide (own trips) | [01-get-incidents-list.md](01-get-incidents-list.md) | Draft |
| 02 | GET | `/api/incidents/:id` | Operator, Admin; Guide (own trips) | [02-get-incidents-detail.md](02-get-incidents-detail.md) | Draft |
| 03 | POST | `/api/incidents` | Operator | [03-post-incidents-create.md](03-post-incidents-create.md) | Draft |
| 04 | POST | `/api/incidents/:id/acknowledge` | Operator; Guide assigned to the incident's trip | [04-post-incidents-acknowledge.md](04-post-incidents-acknowledge.md) | Draft |
| 05 | POST | `/api/incidents/:id/transitions` | Operator | [05-post-incidents-transition.md](05-post-incidents-transition.md) | Draft |
| 06 | POST | `/api/incidents/:id/notes` | Operator; Guide (own trips) | [06-post-incidents-notes.md](06-post-incidents-notes.md) | Draft |
| 07 | POST | `/api/incidents/:id/dismiss` | Operator | [07-post-incidents-dismiss.md](07-post-incidents-dismiss.md) | Draft |
| 08 | GET | `/api/incidents/metrics` | Operator, Admin | [08-get-incidents-metrics.md](08-get-incidents-metrics.md) | Draft |

Manual testing: [00-api-testing-guide.md](00-api-testing-guide.md). Shared setup: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
