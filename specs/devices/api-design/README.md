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
| 12 | PATCH | `/api/devices/:id/maintenance/:recordId` | TrekLink Staff | [12-patch-devices-id-maintenance-recordid.md](12-patch-devices-id-maintenance-recordid.md) |
| 13 | POST | `/api/devices/:id/retire` | TrekLink Admin | [13-post-devices-id-retire.md](13-post-devices-id-retire.md) |
| 14 | POST | `/api/devices/:id/recover` | TrekLink Staff | [14-post-devices-id-recover.md](14-post-devices-id-recover.md) |
| 15 | GET | `/api/devices/availability` | TrekLink Staff, TrekLink Admin; Org Manager (counts only) | [15-get-devices-availability.md](15-get-devices-availability.md) |
| 16 | POST | `/api/stock-takes` | TrekLink Staff, TrekLink Admin | [16-post-stock-takes.md](16-post-stock-takes.md) |
| 17 | GET | `/api/stock-takes` | TrekLink Staff, TrekLink Admin | [17-get-stock-takes.md](17-get-stock-takes.md) |

Route order: `GET /api/devices/availability` is declared before `GET /api/devices/:id` in `DevicesController`, so the literal segment is never read as an id.


Manual testing: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
