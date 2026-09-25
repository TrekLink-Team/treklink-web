# API Testing Guide: incidents

Setup and tokens: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md). Device-raised incidents are created by publishing SOS fixtures to the broker; see [`specs/gateway-sync/api-design/00-api-testing-guide.md`](../../gateway-sync/api-design/00-api-testing-guide.md).

## Walkthrough 1: one fall, one Incident (E03-2)

1. Publish the fall-SOS text fixture, then 12 position fixtures 5 s apart with the same `from`.
2. `GET /api/incidents?deviceId=...`. Expect one Incident, `eventCount` 13, `confidence CONFIRMED`.

## Walkthrough 2: lost text frame (E03-1)

1. Publish 12 positions 5 s apart with no text.
2. Expect one `SUSPECTED` Incident. Publish the text late: same Incident, now `CONFIRMED`, audit shows `CONFIDENCE_UPGRADED`.

## Walkthrough 3: acknowledgement race (E03-3)

As `operator` and as the trip's `guide`, send `POST /api/incidents/{id}/acknowledge` at the same moment. One 200, one 409 `ALREADY_ACKNOWLEDGED` naming the winner.

## Walkthrough 4: reopen (E03-6)

Resolve the Incident, then publish one more position within `incidents.episodeWindowSeconds`. Expect status `DETECTED`, `reopenCount` 1, audit `REOPENED` by `SYSTEM`.
