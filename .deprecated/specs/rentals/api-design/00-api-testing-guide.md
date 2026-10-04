# API Testing Guide: rentals

Setup and tokens: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md). The walkthrough needs a trip in `BOOKING_OPEN` with a Lead Guide (see the `trips` guide) and at least one provisioned device.

## Walkthrough 1: MF-01 end to end

1. As `customer`: `POST /api/bookings` (1 device). Expect 201 `PENDING` with a quote.
2. `POST /api/bookings/{id}/reservations`. Expect 201, `holdExpiresAt` 10 minutes ahead.
3. `POST /api/payments` for the escrow invoice (see `billing`). Expect the allocation `CONFIRMED`.
4. As `operator`: `POST /api/bookings/{id}/confirm`. Expect a rental in `DRAFT`.
5. `POST /api/rentals/{id}/agreement`, then `.../agreement/signature`. Expect the rental `READY`.
6. `POST /api/rentals/{id}/checkout`. Expect `CHECKED_OUT` and the device `RENTED`.
7. As the custodian `guide`: `POST .../items/{itemId}/handover` with `batteryPct 80, gpsFix true`. Expect passed.

## Walkthrough 2: E01-1, the last device

With one free device, fire two reservations at once (for example two `curl` calls with `&`). One gets 201, the other 409 `DEVICE_NOT_AVAILABLE`; its booking stays `PENDING` with no allocation.

## Walkthrough 3: MF-05 return

1. Trip in progress then finished (see `trips`).
2. `POST .../items/{itemId}/checkin` one hour after `dueAt`.
3. `POST .../items/{itemId}/inspection` with `MAJOR_DAMAGE, serviceable false`. Device goes to `MAINTENANCE`.
4. `POST /api/rentals/{id}/settlement`. Invoice shows late and damage lines and the deposit applied.
5. `POST /api/rentals/{id}/close`. Expect 409 `BALANCE_OUTSTANDING`; pay, then close succeeds.
