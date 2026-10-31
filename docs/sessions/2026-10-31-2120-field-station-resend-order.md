# 2026-10-31 21:20: Field Station resend order and the #227 review suggestions (gateway-sync 5.1, 5.3)

KhoaDD under D-078, run by the leader's cloud agent (task W7). Branch `fix/field-station-resend-order`
from `origin/dev` at `1e20725`. Scope: `gateway/`, the gateway-sync spec, the demo script. No topic,
flush order or PUBACK rule changed.

## Done

| Item | Commit | Where |
|---|---|---|
| Resend order (NFR-REL-04) | `66dbc41` | `gateway/src/mqtt/mqtt-client.ts` (`dropUnacknowledged` on close), `flush-outage.spec.ts` (link cut mid-batch), design §3 Flush row, tasks 5.1 |
| Over-bound log after a shed | `1283721` | `gateway/src/queue/priority-queue.ts`, `queue-bound.spec.ts` |
| Shed of an in-flight row | `2f154ec` | `priority-queue.ts` (`shedByTier()` comment), `flush-outage.spec.ts` (two cases) |
| Harness option | `e8ab243` | `gateway/test/harness/outage.ts` (`--cut-after-tick-ms`) |
| Docs | `ec904bb` | harness README results, requirements REQ-STA-03, demo script citations |
| Rerun record | this commit | tasks 5.3, this file |

## Facts confirmed

- **mqtt.js 5.15.2 resend.** A QoS 1 publish sits in `outgoing` and `outgoingStore` until its PUBACK;
  `_flushVolatile` on close skips it (`volatile: false`), and `_onConnect` streams the store and resends
  each copy, one PUBACK at a time, before it emits `connect` (`build/lib/client.js:1165-1255`).
  `removeOutgoingMessage(messageId)` is public and typed; with the default in-memory store it deletes
  the copy and calls the publish callback with `Message removed` synchronously, inside the close handler.
- **The new test fails on the old code** with arrival order P2, P3, P3, P3, P0, P0, P1 and passes with
  the fix (P0, P0, P1, P2, P3, P3, P3). The second shed test also fails without the fix (the dropped
  copy would be resent and delivered).
- **Duplicates.** Dropping the copy means a publish the broker took but whose PUBACK the cut lost is
  sent again from the queue: the fixed phase-locked run counted 1 duplicate in 4 of 6 trials. QoS 1
  already allows this; the backend dedups by `eventId` (REQ-ERR-02).

## Measurements (indicative)

Results tables: `gateway/test/harness/README.md`. Random cut after the fix, 3 trials each: 30 s,
386/386 delivered, P0 first 30/30, p95 18 ms, max 24 ms; 2 min, 1560/1560, 120/120, p95 21 ms,
max 25 ms; 0 duplicates, 0 shed. Cut 1 ms after a tick, 4.5 s, 6 trials: before the fix 4 of 6 trials
had 3 P2 or P3 ahead of the P0 (4/12, FAIL); after it 0 of 6 (12/12).

## Checks

Gateway: jest 9 suites, 49 tests passed (the flush and queue suites 4 more times, 19 of 19 each);
`npm run lint` 0 problems; `npm run typecheck` clean. No backend or frontend file touched.

## Not done

The 20-trial runs, a silent link, a real Mosquitto and the backend in the harness loop (task 5.3);
the Stage C table and topics, the `FromRadio` decoder and packaging (task 5.1).
