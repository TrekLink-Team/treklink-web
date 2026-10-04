# API Design Index: monitoring

> Generated from `scripts/specs/endpoints/monitoring.py`. Contract: D-002 envelope; on failure `result = { errorCode }` (`specs/platform/requirements.md` REQ-UBI-04). Organization members and API keys only ever see their own organization's records (FR-AUTH-11).

| # | Method | Route | Permission | Spec File |
| --- | --- | --- | --- | --- |
| 01 | GET | `/api/map/config` | Any signed-in user | [01-get-map-config.md](01-get-map-config.md) |
| 02 | GET | `/api/map/snapshot` | Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin | [02-get-map-snapshot.md](02-get-map-snapshot.md) |
| 03 | GET | `/api/telemetry/devices/:id/history` | Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin | [03-get-telemetry-devices-id-history.md](03-get-telemetry-devices-id-history.md) |
| 04 | GET | `/api/telemetry/devices` | Organization API key | [04-get-telemetry-devices.md](04-get-telemetry-devices.md) |
| 05 | GET | `/api/telemetry/stream` | Organization API key | [05-get-telemetry-stream.md](05-get-telemetry-stream.md) |
| 06 | GET | `/api/system-health` | TrekLink Admin | [06-get-system-health.md](06-get-system-health.md) |
| 07 | GET | `/api/devices/:id/history` | TrekLink Staff, TrekLink Admin | [07-get-devices-id-history.md](07-get-devices-id-history.md) |
| 08 | GET | `/api/reports/:kind` | TrekLink Staff, TrekLink Admin | [08-get-reports-kind.md](08-get-reports-kind.md) |

Live push is the Socket.io contract in [ws-live-contract.md](ws-live-contract.md). The staleness sweep and stream pruning are scheduler jobs with no endpoint (monitoring design §3).

- Hand-written contract: [ws-live-contract.md](ws-live-contract.md)

Manual testing: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
