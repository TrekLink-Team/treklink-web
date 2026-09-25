# API Design Index: trips

> Endpoint designs for `trips`, following `treklink-docs/_docs/02-templates/04-api-endpoint-template.md` with Mermaid diagrams (D-017).
> Contract: `{ "result": ..., "isSuccess": bool, "statusCode": int, "message": string }` (D-002); on failure `result` is `{ "errorCode": "..." }` (proposed, see `specs/platform/requirements.md` REQ-UBI-04).

| # | Method | Route | Permission | Spec File | Status |
|---|---|---|---|---|---|
| 01 | GET | `/api/trek-packages` | Public (PUBLISHED only); Operator, Admin (all statuses) | [01-get-trek-packages-list.md](01-get-trek-packages-list.md) | Draft |
| 02 | GET | `/api/trek-packages/:id` | Public (PUBLISHED); Staff | [02-get-trek-packages-detail.md](02-get-trek-packages-detail.md) | Draft |
| 03 | POST | `/api/trek-packages` | Operator | [03-post-trek-packages-create.md](03-post-trek-packages-create.md) | Draft |
| 04 | PATCH | `/api/trek-packages/:id` | Operator | [04-patch-trek-packages-update.md](04-patch-trek-packages-update.md) | Draft |
| 05 | POST | `/api/trips` | Operator | [05-post-trips-create.md](05-post-trips-create.md) | Draft |
| 06 | GET | `/api/trips` | Public (BOOKING_OPEN); Operator, Admin (all); Guide (own) | [06-get-trips-list.md](06-get-trips-list.md) | Draft |
| 07 | GET | `/api/trips/:id` | Public (BOOKING_OPEN, reduced view); Operator, Admin; Guide (own) | [07-get-trips-detail.md](07-get-trips-detail.md) | Draft |
| 08 | PATCH | `/api/trips/:id` | Operator | [08-patch-trips-update.md](08-patch-trips-update.md) | Draft |
| 09 | POST | `/api/trips/:id/transitions` | Operator (all edges); Lead Guide of the trip (start, finish) | [09-post-trips-transition.md](09-post-trips-transition.md) | Draft |
| 10 | PUT | `/api/trips/:id/guides` | Operator | [10-put-trips-guides.md](10-put-trips-guides.md) | Draft |
| 11 | GET | `/api/guides/availability` | Operator | [11-get-guides-availability.md](11-get-guides-availability.md) | Draft |
| 12 | GET | `/api/trips/:id/participants` | Operator; Guide (own trip) | [12-get-trips-participants.md](12-get-trips-participants.md) | Draft |
| 13 | POST | `/api/trips/:id/readiness-checks` | Guide assigned to the trip | [13-post-trips-readiness-check.md](13-post-trips-readiness-check.md) | Draft |
| 14 | POST | `/api/trip-requests` | Guide | [14-post-trip-requests-create.md](14-post-trip-requests-create.md) | Draft |
| 15 | GET | `/api/trip-requests` | Operator (all); Guide (own) | [15-get-trip-requests-list.md](15-get-trip-requests-list.md) | Draft |
| 16 | PATCH | `/api/trip-requests/:id` | Operator | [16-patch-trip-requests-decide.md](16-patch-trip-requests-decide.md) | Draft |

Manual testing: [00-api-testing-guide.md](00-api-testing-guide.md). Shared setup: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).
