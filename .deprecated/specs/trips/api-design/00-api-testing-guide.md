# API Testing Guide: trips

Setup and tokens: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).

## Walkthrough: from package to a trip in progress

1. As `operator`: create a package, then `PATCH` it to `PUBLISHED`.
2. Without a token: `GET /api/trek-packages`. The package is listed.
3. As `operator`: `POST /api/trips`, then transition `DRAFT` to `PREPARING`.
4. Transition to `BOOKING_OPEN` before assigning Guides. Expect 409 `LEAD_GUIDE_REQUIRED`.
5. `GET /api/guides/availability` for the window, then `PUT /api/trips/{id}/guides` with one LEAD.
6. Transition to `BOOKING_OPEN`, then `READY`.
7. As the Lead `guide`: transition to `IN_PROGRESS`. Expect 409 `READINESS_REQUIRED`.
8. `POST /api/trips/{id}/readiness-checks` with every item checked. Expect `PASS`.
9. Transition to `IN_PROGRESS`. Expect 200; rented devices on the trip become `IN_FIELD`.

## Scope check (E04-5)

As a Guide not assigned to the trip, `GET /api/trips/{id}` returns 404, not 403.
