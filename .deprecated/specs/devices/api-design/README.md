# API Design Index: devices

> Endpoint designs for `devices`, following `treklink-docs/_docs/02-templates/04-api-endpoint-template.md` with Mermaid diagrams (D-017).
> Contract: `{ "result": ..., "isSuccess": bool, "statusCode": int, "message": string }` (D-002); on failure `result` is `{ "errorCode": "..." }` (proposed, see `specs/platform/requirements.md` REQ-UBI-04).

| # | Method | Route | Permission | Spec File | Status |
|---|---|---|---|---|---|
| 01 | GET | `/api/hardware-variants` | Admin, Operator, Guide | [01-get-hardware-variants-list.md](01-get-hardware-variants-list.md) | Draft |
| 02 | POST | `/api/hardware-variants` | Admin | [02-post-hardware-variants-create.md](02-post-hardware-variants-create.md) | Draft |
| 03 | PATCH | `/api/hardware-variants/:id` | Admin | [03-patch-hardware-variants-update.md](03-patch-hardware-variants-update.md) | Draft |
| 04 | POST | `/api/devices` | Operator, Admin | [04-post-devices-register.md](04-post-devices-register.md) | Draft |
| 05 | GET | `/api/devices` | Operator, Admin; Guide (devices on own trips) | [05-get-devices-list.md](05-get-devices-list.md) | Draft |
| 06 | GET | `/api/devices/:id` | Operator, Admin; Guide (own trips) | [06-get-devices-detail.md](06-get-devices-detail.md) | Draft |
| 07 | PATCH | `/api/devices/:id` | Operator, Admin | [07-patch-devices-update.md](07-patch-devices-update.md) | Draft |
| 08 | POST | `/api/devices/:id/transitions` | Operator; Admin for RETIRED from AVAILABLE | [08-post-devices-transition.md](08-post-devices-transition.md) | Draft |
| 09 | GET | `/api/devices/:id/status-history` | Operator, Admin | [09-get-devices-status-history.md](09-get-devices-status-history.md) | Draft |
| 10 | POST | `/api/devices/:id/maintenance` | Operator | [10-post-devices-maintenance-open.md](10-post-devices-maintenance-open.md) | Draft |
| 11 | PATCH | `/api/devices/:id/maintenance/:recordId` | Operator | [11-patch-devices-maintenance-close.md](11-patch-devices-maintenance-close.md) | Draft |
| 12 | POST | `/api/devices/:id/provisioning` | Operator | [12-post-devices-provisioning.md](12-post-devices-provisioning.md) | Draft |
| 13 | GET | `/api/devices/availability` | Operator, Admin, Guide, Customer | [13-get-devices-availability.md](13-get-devices-availability.md) | Draft |

Manual testing: [00-api-testing-guide.md](00-api-testing-guide.md). Shared setup: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
