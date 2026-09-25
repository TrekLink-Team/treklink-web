# API Design Index: rentals

> Endpoint designs for `rentals`, following `treklink-docs/_docs/02-templates/04-api-endpoint-template.md` with Mermaid diagrams (D-017).
> Contract: `{ "result": ..., "isSuccess": bool, "statusCode": int, "message": string }` (D-002); on failure `result` is `{ "errorCode": "..." }` (proposed, see `specs/platform/requirements.md` REQ-UBI-04).

| # | Method | Route | Permission | Spec File | Status |
|---|---|---|---|---|---|
| 01 | POST | `/api/bookings` | Customer; Guide (own trips); Operator | [01-post-bookings-create.md](01-post-bookings-create.md) | Draft |
| 02 | POST | `/api/bookings/:id/reservations` | Booking owner (Customer); Guide (own trips); Operator | [02-post-bookings-reserve.md](02-post-bookings-reserve.md) | Draft |
| 03 | GET | `/api/bookings` | Operator, Admin (all); Guide (own trips); Customer (own) | [03-get-bookings-list.md](03-get-bookings-list.md) | Draft |
| 04 | GET | `/api/bookings/:id` | Operator, Admin; Guide (own trips); Customer (own) | [04-get-bookings-detail.md](04-get-bookings-detail.md) | Draft |
| 05 | POST | `/api/bookings/:id/confirm` | Operator | [05-post-bookings-confirm.md](05-post-bookings-confirm.md) | Draft |
| 06 | POST | `/api/bookings/:id/reject` | Operator | [06-post-bookings-reject.md](06-post-bookings-reject.md) | Draft |
| 07 | POST | `/api/bookings/:id/cancel` | Customer (own); Operator | [07-post-bookings-cancel.md](07-post-bookings-cancel.md) | Draft |
| 08 | PATCH | `/api/bookings/:id/hold` | Operator | [08-patch-bookings-hold.md](08-patch-bookings-hold.md) | Draft |
| 09 | POST | `/api/rentals` | Operator; Guide (own trips) | [09-post-rentals-create.md](09-post-rentals-create.md) | Draft |
| 10 | GET | `/api/rentals` | Operator, Admin; Guide (custody); Customer (own) | [10-get-rentals-list.md](10-get-rentals-list.md) | Draft |
| 11 | GET | `/api/rentals/:id` | Operator, Admin; Guide (custody); Customer (own) | [11-get-rentals-detail.md](11-get-rentals-detail.md) | Draft |
| 12 | PUT | `/api/rentals/:id/items` | Operator | [12-put-rentals-items.md](12-put-rentals-items.md) | Draft |
| 13 | POST | `/api/rentals/:id/agreement` | Operator | [13-post-rentals-agreement.md](13-post-rentals-agreement.md) | Draft |
| 14 | POST | `/api/rentals/:id/agreement/signature` | Operator (hosting an in-person signature); Customer (own rental) | [14-post-rentals-agreement-sign.md](14-post-rentals-agreement-sign.md) | Draft |
| 15 | GET | `/api/rentals/:id/agreement/pdf` | Operator, Admin; Customer (own) | [15-get-rentals-agreement-pdf.md](15-get-rentals-agreement-pdf.md) | Draft |
| 16 | POST | `/api/rentals/:id/checkout` | Operator | [16-post-rentals-checkout.md](16-post-rentals-checkout.md) | Draft |
| 17 | POST | `/api/rentals/:id/items/:itemId/handover` | Custodian Guide of the rental | [17-post-rentals-item-handover.md](17-post-rentals-item-handover.md) | Draft |
| 18 | POST | `/api/rentals/:id/items/:itemId/checkin` | Operator | [18-post-rentals-item-checkin.md](18-post-rentals-item-checkin.md) | Draft |
| 19 | POST | `/api/rentals/:id/items/:itemId/inspection` | Operator | [19-post-rentals-item-inspection.md](19-post-rentals-item-inspection.md) | Draft |
| 20 | POST | `/api/rentals/:id/items/:itemId/lost` | Operator | [20-post-rentals-item-lost.md](20-post-rentals-item-lost.md) | Draft |
| 21 | POST | `/api/rentals/:id/settlement` | Operator | [21-post-rentals-settlement.md](21-post-rentals-settlement.md) | Draft |
| 22 | POST | `/api/rentals/:id/close` | Operator | [22-post-rentals-close.md](22-post-rentals-close.md) | Draft |
| 23 | POST | `/api/rentals/:id/cancel` | Operator | [23-post-rentals-cancel.md](23-post-rentals-cancel.md) | Draft |

Manual testing: [00-api-testing-guide.md](00-api-testing-guide.md). Shared setup: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
