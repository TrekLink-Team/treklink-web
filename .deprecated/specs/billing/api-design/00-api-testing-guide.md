# API Testing Guide: billing

Setup and tokens: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md). Every payment request needs an `Idempotency-Key` header; generate one with `uuidgen`.

## Walkthrough 1: the configuration demo (D-015)

1. `POST /api/quotes` for a trip. Note the rental-fee line.
2. As `admin`, `PATCH /api/pricing-rules/{id}` with a new amount.
3. Quote again: the line changes. No deploy.

## Walkthrough 2: payment fails part-way (E05-4)

1. Settle a returned rental (see `rentals`), note the invoice.
2. `POST /api/payments` with `simulate: "DECLINE"`. Expect 402; `GET /api/invoices/{id}` shows the balance unchanged and a `FAILED` payment.
3. `POST /api/rentals/{id}/close`. Expect 409 `BALANCE_OUTSTANDING`.
4. Pay without `simulate`, close again. Expect 200.

## Walkthrough 3: separation of duty (E05-7)

Request a waiver above the threshold as the Operator who inspected the device, then try to approve it as the same user. Expect 409 `SEPARATION_OF_DUTY`; approve as another Operator.
