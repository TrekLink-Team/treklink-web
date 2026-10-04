# API Design Index: gateway-sync

> Generated from `scripts/specs/endpoints/gateway_sync.py`. Contract: D-002 envelope; on failure `result = { errorCode }` (`specs/platform/requirements.md` REQ-UBI-04). Organization members and API keys only ever see their own organization's records (FR-AUTH-11).

| # | Method | Route | Permission | Spec File |
| --- | --- | --- | --- | --- |
| 01 | POST | `/api/internal/mqtt/user` | Internal (broker) | [01-post-internal-mqtt-user.md](01-post-internal-mqtt-user.md) |
| 02 | POST | `/api/internal/mqtt/acl` | Internal (broker) | [02-post-internal-mqtt-acl.md](02-post-internal-mqtt-acl.md) |
| 03 | POST | `/api/gateway-sync` op `listEvents` | TrekLink Staff, TrekLink Admin | [03-post-gateway-sync-op-list-events.md](03-post-gateway-sync-op-list-events.md) |
| 04 | POST | `/api/gateway-sync` op `listAudit` | TrekLink Admin | [04-post-gateway-sync-op-list-audit.md](04-post-gateway-sync-op-list-audit.md) |
| 05 | POST | `/api/gateway-sync` op `replayAudit` | TrekLink Admin | [05-post-gateway-sync-op-replay-audit.md](05-post-gateway-sync-op-replay-audit.md) |
| 06 | POST | `/api/gateway-sync` op `listQueueReports` | TrekLink Staff, TrekLink Admin | [06-post-gateway-sync-op-list-queue-reports.md](06-post-gateway-sync-op-list-queue-reports.md) |

The MQTT ingress (Stage A, B and C) and the Field Station local page are not HTTP endpoints of the backend; they are documented in the hand-written contracts below. `POST /api/gateway-sync` is the D-027 operation endpoint; the broker hooks are separate routes because mosquitto-go-auth calls fixed URIs.

- Hand-written contract: [field-station-local-page.md](field-station-local-page.md)
- Hand-written contract: [mqtt-ingress-contract.md](mqtt-ingress-contract.md)
- Hand-written contract: [queue-health-payload.md](queue-health-payload.md)

Manual testing: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
