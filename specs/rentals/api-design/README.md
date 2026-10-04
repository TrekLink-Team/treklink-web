# API Design Index: rentals

> Generated from `scripts/specs/endpoints/rentals.py`. Contract: D-002 envelope; on failure `result = { errorCode }` (`specs/platform/requirements.md` REQ-UBI-04). Organization members and API keys only ever see their own organization's records (FR-AUTH-11).

| # | Method | Route | Permission | Spec File |
| --- | --- | --- | --- | --- |
| 01 | POST | `/api/contracts` | Org Manager: own | [01-post-contracts.md](01-post-contracts.md) |
| 02 | GET | `/api/contracts` | Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin | [02-get-contracts.md](02-get-contracts.md) |
| 03 | GET | `/api/contracts/:id` | Org Manager, Org Operator: own; TrekLink Staff, TrekLink Admin | [03-get-contracts-id.md](03-get-contracts-id.md) |
| 04 | POST | `/api/contracts/:id/approve` | TrekLink Staff, TrekLink Admin | [04-post-contracts-id-approve.md](04-post-contracts-id-approve.md) |
| 05 | POST | `/api/contracts/:id/reject` | TrekLink Staff, TrekLink Admin | [05-post-contracts-id-reject.md](05-post-contracts-id-reject.md) |
| 06 | POST | `/api/contracts/:id/cancel` | Org Manager: own; TrekLink Staff, TrekLink Admin | [06-post-contracts-id-cancel.md](06-post-contracts-id-cancel.md) |
| 07 | POST | `/api/contracts/:id/devices/:deviceId/swap` | TrekLink Staff | [07-post-contracts-id-devices-deviceid-swap.md](07-post-contracts-id-devices-deviceid-swap.md) |
| 08 | GET | `/api/contracts/:id/handover-note/preview` | TrekLink Staff | [08-get-contracts-id-handover-note-preview.md](08-get-contracts-id-handover-note-preview.md) |
| 09 | POST | `/api/contracts/:id/devices/:deviceId/provisioning` | TrekLink Staff | [09-post-contracts-id-devices-deviceid-provisioning.md](09-post-contracts-id-devices-deviceid-provisioning.md) |
| 10 | POST | `/api/contracts/:id/handover` | TrekLink Staff | [10-post-contracts-id-handover.md](10-post-contracts-id-handover.md) |
| 11 | GET | `/api/contracts/:id/handover-note` | Org Manager: own; TrekLink Staff, TrekLink Admin | [11-get-contracts-id-handover-note.md](11-get-contracts-id-handover-note.md) |
| 12 | POST | `/api/contracts/:id/notice` | Org Manager: own | [12-post-contracts-id-notice.md](12-post-contracts-id-notice.md) |
| 13 | PUT | `/api/contracts/:id/devices/:deviceId/holder` | Org Manager, Org Operator: own | [13-put-contracts-id-devices-deviceid-holder.md](13-put-contracts-id-devices-deviceid-holder.md) |
| 14 | POST | `/api/contracts/:id/check-ins` | TrekLink Staff | [14-post-contracts-id-check-ins.md](14-post-contracts-id-check-ins.md) |
| 15 | POST | `/api/contracts/:id/devices/:deviceId/lost` | TrekLink Staff | [15-post-contracts-id-devices-deviceid-lost.md](15-post-contracts-id-devices-deviceid-lost.md) |
| 16 | POST | `/api/contracts/:id/devices/:deviceId/inspection` | TrekLink Staff | [16-post-contracts-id-devices-deviceid-inspection.md](16-post-contracts-id-devices-deviceid-inspection.md) |
| 17 | POST | `/api/contracts/:id/close` | TrekLink Staff, TrekLink Admin | [17-post-contracts-id-close.md](17-post-contracts-id-close.md) |
| 18 | GET | `/api/contracts/:id/transitions` | Org Manager: own; TrekLink Staff, TrekLink Admin | [18-get-contracts-id-transitions.md](18-get-contracts-id-transitions.md) |

Scheduler moves that have no endpoint (rentals design §5): term rollover and day-plan end (UC-24, FR-CON-08, FR-CON-10), `RETURN_DUE` to `OVERDUE` to `DEFAULTED` (UC-50, FR-CON-12), and the reservation-expiry reminder (FR-CON-04).


Manual testing: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
