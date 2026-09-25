# API Design Index: billing

> Endpoint designs for `billing`, following `treklink-docs/_docs/02-templates/04-api-endpoint-template.md` with Mermaid diagrams (D-017).
> Contract: `{ "result": ..., "isSuccess": bool, "statusCode": int, "message": string }` (D-002); on failure `result` is `{ "errorCode": "..." }` (proposed, see `specs/platform/requirements.md` REQ-UBI-04).

| # | Method | Route | Permission | Spec File | Status |
|---|---|---|---|---|---|
| 01 | GET | `/api/pricing-rules` | Admin, Operator (read) | [01-get-pricing-rules-list.md](01-get-pricing-rules-list.md) | Draft |
| 02 | POST | `/api/pricing-rules` | Admin | [02-post-pricing-rules-create.md](02-post-pricing-rules-create.md) | Draft |
| 03 | PATCH | `/api/pricing-rules/:id` | Admin | [03-patch-pricing-rules-update.md](03-patch-pricing-rules-update.md) | Draft |
| 04 | GET | `/api/damage-fee-rules` | Admin, Operator (read) | [04-get-damage-fee-rules.md](04-get-damage-fee-rules.md) | Draft |
| 05 | PUT | `/api/damage-fee-rules` | Admin | [05-put-damage-fee-rules.md](05-put-damage-fee-rules.md) | Draft |
| 06 | POST | `/api/quotes` | Public (for BOOKING_OPEN trips); any role | [06-post-quotes.md](06-post-quotes.md) | Draft |
| 07 | GET | `/api/invoices` | Operator, Admin; Customer (own) | [07-get-invoices-list.md](07-get-invoices-list.md) | Draft |
| 08 | GET | `/api/invoices/:id` | Operator, Admin; Customer (own) | [08-get-invoices-detail.md](08-get-invoices-detail.md) | Draft |
| 09 | POST | `/api/payments` | Customer (charge, own invoice); Operator (charge, refund) | [09-post-payments.md](09-post-payments.md) | Draft |
| 10 | POST | `/api/fee-waivers` | Operator | [10-post-fee-waivers.md](10-post-fee-waivers.md) | Draft |
| 11 | POST | `/api/fee-waivers/:id/decision` | Operator other than the requester and the inspector | [11-post-fee-waivers-decision.md](11-post-fee-waivers-decision.md) | Draft |

Manual testing: [00-api-testing-guide.md](00-api-testing-guide.md). Shared setup: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
