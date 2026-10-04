# API Design Index: gateway-sync

> Endpoint designs for `gateway-sync`, following `treklink-docs/_docs/02-templates/04-api-endpoint-template.md` with Mermaid diagrams (D-017).
> Contract: `{ "result": ..., "isSuccess": bool, "statusCode": int, "message": string }` (D-002); on failure `result` is `{ "errorCode": "..." }` (proposed, see `specs/platform/requirements.md` REQ-UBI-04).

| # | Method | Route | Permission | Spec File | Status |
|---|---|---|---|---|---|
| 01 | POST | `/api/gateway-sync` | Operator, Admin | [01-op-health.md](01-op-health.md) | Draft |
| 02 | POST | `/api/gateway-sync` | Operator, Admin; Guide (own trips' devices) | [02-op-list-events.md](02-op-list-events.md) | Draft |
| 03 | POST | `/api/gateway-sync` | Admin | [03-op-list-audit.md](03-op-list-audit.md) | Draft |
| 04 | POST | `/api/gateway-sync` | Admin | [04-op-replay.md](04-op-replay.md) | Draft |
| 05 | MQTT | `treklink/2/json/+/+` | Broker ACL | [05-mqtt-ingress-contract.md](05-mqtt-ingress-contract.md) | Draft |
| 06 | MQTT | `type: treklink_queue_health` payload | Broker ACL | [06-queue-health-payload.md](06-queue-health-payload.md) | Consumer copy of firmware design §2.4 |

Manual testing: [00-api-testing-guide.md](00-api-testing-guide.md). Shared setup: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
