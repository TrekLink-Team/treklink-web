# API Design Index: devices

> Generated from `scripts/specs/endpoints/devices.py`. Contract: D-002 envelope; on failure `result = { errorCode }` (`specs/platform/requirements.md` REQ-UBI-04). Organization members and API keys only ever see their own organization's records (FR-AUTH-11).

| # | Method | Route | Permission | Spec File |
| --- | --- | --- | --- | --- |
| 01 | GET | `/api/hardware-variants` | TrekLink Staff, TrekLink Admin; Org Manager (active variants, no counts) | [01-get-hardware-variants.md](01-get-hardware-variants.md) |
| 02 | POST | `/api/hardware-variants` | TrekLink Admin | [02-post-hardware-variants.md](02-post-hardware-variants.md) |
| 03 | PATCH | `/api/hardware-variants/:id` | TrekLink Admin | [03-patch-hardware-variants-id.md](03-patch-hardware-variants-id.md) |
| 04 | DELETE | `/api/hardware-variants/:id` | TrekLink Admin | [04-delete-hardware-variants-id.md](04-delete-hardware-variants-id.md) |
| 05 | POST | `/api/devices` | TrekLink Staff | [05-post-devices.md](05-post-devices.md) |
| 06 | GET | `/api/devices` | TrekLink Staff, TrekLink Admin | [06-get-devices.md](06-get-devices.md) |
| 07 | GET | `/api/devices/:id` | TrekLink Staff, TrekLink Admin | [07-get-devices-id.md](07-get-devices-id.md) |
| 08 | PATCH | `/api/devices/:id` | TrekLink Staff | [08-patch-devices-id.md](08-patch-devices-id.md) |
| 09 | POST | `/api/devices/:id/intake-checks` | TrekLink Staff | [09-post-devices-id-intake-checks.md](09-post-devices-id-intake-checks.md) |
| 10 | POST | `/api/devices/:id/reset` | TrekLink Staff | [10-post-devices-id-reset.md](10-post-devices-id-reset.md) |
| 11 | POST | `/api/devices/:id/maintenance` | TrekLink Staff | [11-post-devices-id-maintenance.md](11-post-devices-id-maintenance.md) |
| 12 | PATCH | `/api/devices/:id/maintenance/:recordId/estimate` | TrekLink Staff | [12-patch-devices-id-maintenance-recordid-estimate.md](12-patch-devices-id-maintenance-recordid-estimate.md) |
| 13 | POST | `/api/devices/:id/maintenance/:recordId/decision` | TrekLink Admin | [13-post-devices-id-maintenance-recordid-decision.md](13-post-devices-id-maintenance-recordid-decision.md) |
| 14 | PATCH | `/api/devices/:id/maintenance/:recordId` | TrekLink Staff | [14-patch-devices-id-maintenance-recordid.md](14-patch-devices-id-maintenance-recordid.md) |
| 15 | GET | `/api/maintenance-records` | TrekLink Staff, TrekLink Admin | [15-get-maintenance-records.md](15-get-maintenance-records.md) |
| 16 | POST | `/api/devices/:id/retire` | TrekLink Admin | [16-post-devices-id-retire.md](16-post-devices-id-retire.md) |
| 17 | POST | `/api/devices/:id/loss-cases` | Org Manager: a device rented by the organization; TrekLink Staff: any device in service | [17-post-devices-id-loss-cases.md](17-post-devices-id-loss-cases.md) |
| 18 | GET | `/api/loss-cases` | TrekLink Staff, TrekLink Admin; Org Manager: own organization | [18-get-loss-cases.md](18-get-loss-cases.md) |
| 19 | POST | `/api/loss-cases/:id/triage` | TrekLink Staff | [19-post-loss-cases-id-triage.md](19-post-loss-cases-id-triage.md) |
| 20 | POST | `/api/loss-cases/:id/recover` | TrekLink Staff | [20-post-loss-cases-id-recover.md](20-post-loss-cases-id-recover.md) |
| 21 | POST | `/api/loss-cases/:id/confirm` | TrekLink Staff | [21-post-loss-cases-id-confirm.md](21-post-loss-cases-id-confirm.md) |
| 22 | POST | `/api/loss-cases/:id/decision` | TrekLink Admin | [22-post-loss-cases-id-decision.md](22-post-loss-cases-id-decision.md) |
| 23 | POST | `/api/devices/:id/dispose` | TrekLink Admin | [23-post-devices-id-dispose.md](23-post-devices-id-dispose.md) |
| 24 | GET | `/api/devices/availability` | TrekLink Staff, TrekLink Admin; Org Manager (counts only) | [24-get-devices-availability.md](24-get-devices-availability.md) |
| 25 | POST | `/api/stock-takes` | TrekLink Staff, TrekLink Admin | [25-post-stock-takes.md](25-post-stock-takes.md) |
| 26 | GET | `/api/stock-takes` | TrekLink Staff, TrekLink Admin | [26-get-stock-takes.md](26-get-stock-takes.md) |
| 27 | GET | `/api/loss-cases/:id` | TrekLink Staff, TrekLink Admin; Org Manager: own organization | [27-get-loss-cases-id.md](27-get-loss-cases-id.md) |

Route order: `GET /api/devices/availability` is declared before `GET /api/devices/:id` in `DevicesController`, so the literal segment is never read as an id.


Manual testing: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
