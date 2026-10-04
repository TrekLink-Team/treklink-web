# API Design Index: billing

> Generated from `scripts/specs/endpoints/billing.py`. Contract: D-002 envelope; on failure `result = { errorCode }` (`specs/platform/requirements.md` REQ-UBI-04). Organization members and API keys only ever see their own organization's records (FR-AUTH-11).

| # | Method | Route | Permission | Spec File |
| --- | --- | --- | --- | --- |
| 01 | GET | `/api/plans` | Public | [01-get-plans.md](01-get-plans.md) |
| 02 | POST | `/api/quotes` | Org Manager: own; TrekLink Staff | [02-post-quotes.md](02-post-quotes.md) |
| 03 | GET | `/api/price-schedules` | TrekLink Admin | [03-get-price-schedules.md](03-get-price-schedules.md) |
| 04 | POST | `/api/price-schedules` | TrekLink Admin | [04-post-price-schedules.md](04-post-price-schedules.md) |
| 05 | GET | `/api/damage-rates` | TrekLink Staff, TrekLink Admin | [05-get-damage-rates.md](05-get-damage-rates.md) |
| 06 | POST | `/api/damage-rates` | TrekLink Admin | [06-post-damage-rates.md](06-post-damage-rates.md) |
| 07 | PATCH | `/api/damage-rates/:id` | TrekLink Admin | [07-patch-damage-rates-id.md](07-patch-damage-rates-id.md) |
| 08 | GET | `/api/invoices` | Org Manager: own; TrekLink Staff, TrekLink Admin | [08-get-invoices.md](08-get-invoices.md) |
| 09 | GET | `/api/invoices/:id` | Org Manager: own; TrekLink Staff, TrekLink Admin | [09-get-invoices-id.md](09-get-invoices-id.md) |
| 10 | GET | `/api/contracts/:id/balance` | Org Manager: own; TrekLink Staff, TrekLink Admin | [10-get-contracts-id-balance.md](10-get-contracts-id-balance.md) |
| 11 | POST | `/api/invoices/:id/payments/sepay` | Org Manager: own | [11-post-invoices-id-payments-sepay.md](11-post-invoices-id-payments-sepay.md) |
| 12 | POST | `/api/payments/sepay/webhook` | Public (SePay API key header) | [12-post-payments-sepay-webhook.md](12-post-payments-sepay-webhook.md) |
| 13 | POST | `/api/invoices/:id/payments/counter` | TrekLink Staff, TrekLink Admin | [13-post-invoices-id-payments-counter.md](13-post-invoices-id-payments-counter.md) |
| 14 | GET | `/api/payments` | Org Manager: own; TrekLink Staff, TrekLink Admin | [14-get-payments.md](14-get-payments.md) |
| 15 | GET | `/api/payments/:id` | Org Manager: own; TrekLink Staff, TrekLink Admin | [15-get-payments-id.md](15-get-payments-id.md) |
| 16 | GET | `/api/damage-charges` | TrekLink Staff, TrekLink Admin | [16-get-damage-charges.md](16-get-damage-charges.md) |
| 17 | POST | `/api/damage-charges/:id/decision` | TrekLink Admin, never the inspector | [17-post-damage-charges-id-decision.md](17-post-damage-charges-id-decision.md) |

Charges created by other modules have no endpoint of their own: `chargeLate` on check-in (FR-BILL-03), `chargeDamage` from an inspection (FR-BILL-04), `chargeLoss` (FR-BILL-05), and the term invoice issued by the term rollover (FR-BILL-01). See `design.md` §2.


Manual testing: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
