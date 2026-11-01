# 2026-11-01 21:00 (UTC+7): the custody clip on the organization API

KhoaDD under D-078 (task W30, follow-up of W26 and treklink-web#277). Branch `fix/org-api-custody-clip`,
cut from `origin/dev` at `918aa40` (contains #277). Leader ruling of 2026-11-01: the organization API
applies the map snapshot's custody clipping and states (D-040, D-092 rule 2).

## Before the change

`OrgApiService.devicesOf` (api-design 04) answered the projection as stored: a unit heard only before the
handover came with its intake or previous-custody position, battery and last-seen time, `position.at` was
the last-seen time, and a unit never heard was `stale: true`.

## What was built

- `monitoring/custody-view.ts`: the pure `custodyView(readings, handedOverAt, staleBefore, clipped)`, moved
  out of `LiveMapService` (`unitView` and the snapshot's inline battery and stale rules). Both
  `LiveMapService.snapshot` and `OrgApiService.devicesOf` call it; the API always passes `clipped: true`.
- api-design 04 gains `state`; `position`, `batteryPct` and `lastSeenAt` follow the organization's
  snapshot; `stale` is true for `OFFLINE` only; `position.at` is `lastPositionAt`.
- api-design 05: no clip needed. Entries are read by the key's organization (`stream.repository.ts:57`),
  fixed at write time: field events by the custody interval at the occurrence time
  (`ingestion.service.ts:146`, `attribution.ts`). One gap found and closed: the staleness sweep's recovery
  of a unit marked while not heard since handover went to the holder even when a late upload moved
  `lastSeenAt` to a reading just before the handover. It now goes to `fleet` only, like the stale entry.

## Spec changes

Monitoring REQ-UBI-04 and AC-08 extended to api-design 04 and the stream; design §4 (the shared rule, the
api-design 04 row, why api-design 05 needs no clip); ws-live-contract `device.stale`; endpoint source and
regenerated api-design 04 and 05; tasks 3.1 (the open note closed) and 3.2 (partly done line).

## Checks

Local Postgres 16. Backend lint (0 errors, 1 warning that is on `dev` already), tsc, boundary check;
monitoring unit specs 22 suites, 217 tests; full unit suite 235 suites, 2674 tests; stubbed e2e 20 suites,
427 tests; db-specs 38 suites, 226 tests, including the new `test/org-api-custody.db-spec.ts`.

## Not done

- An organization that rents the same unit again still gets stream entries from its own earlier custody
  interval of it inside the retention window. D-040 attributes them to it, so this was left as is.
- The Mermaid render check was not run (mermaid-cli is not installed here).
