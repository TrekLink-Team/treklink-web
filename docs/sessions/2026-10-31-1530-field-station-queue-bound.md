# 2026-10-31 15:30: Field Station queue bound, flush tests and outage harness (gateway-sync 5.1, 5.3)

KhoaDD under D-078, run by the leader's cloud agent (task W3). Branch `feat/field-station-queue-bound`
from `origin/dev` at `b84c0ea`, rebased onto `79885d7` before the last push. Scope: `gateway/` only, plus the gateway-sync spec. The Stage C table and
topics, the `FromRadio` decoder and packaging stay out; no wire topic changed.

## Done

| Item | Commit | Where |
|---|---|---|
| Bound `QUEUE_MAX_ROWS` | `a97afc0` | `gateway/src/config.ts` (`GATEWAY_QUEUE_MAX_ROWS`), `queue/priority-queue.ts`, `queue/queue-bound.spec.ts`, `config.spec.ts`, `.env.example`, requirements §4, design §3 |
| AC-03 and crash tests | `3f87785` | `gateway/src/mqtt/flush-outage.spec.ts`, `test/support/broker.ts`, `test/support/station-process.ts`; aedes 0.51.3 dev dependency |
| Outage harness | `6f2707e` | `gateway/test/harness/` (`outage.ts`, `outage-metrics.ts`, README, two specs), `test/support/uplink.ts` |
| Spec progress | this commit | `specs/gateway-sync/tasks.md` 5.1 and 5.3 |

## Facts confirmed

- **Default bound.** The spec names none. 100000 kept from the scaffold's unused `GATEWAY_QUEUE_MAX_SIZE`
  (removed with the also unused `GATEWAY_QUEUE_SHED_FROM_TIER`, whose configurable tier contradicted
  REQ-STA-03). 100000 simulator packets measured 46.7 MB of SQLite (467 bytes a row); an insert at the
  bound took about 1.8 ms. The variable carries the gateway's `GATEWAY_` prefix because the root `.env`
  is shared with the backend; the spec's `QUEUE_MAX_ROWS` names it.
- **Health report.** It has no per-tier shed figure, so none was added (wire contract unchanged); the
  queue counts sheds per tier in process (`shedByTier()`), for the local page of task 5.2.
- **Mutation checks.** Removing a row at publish instead of on PUBACK fails the crash test; flushing in
  arrival order instead of tier order fails AC-03.
- **mqtt.js replay (mqtt 5.15.2, `lib/client.js` around lines 424 and 1165).** On reconnect the client
  resends every QoS 1 publish left unacknowledged by the dropped connection, and queues new publishes
  behind that replay. A P2 or P3 in flight at the cut therefore reaches the broker before the P0 the
  flush sends after the reconnect. Seen in 2 of 6 phase-locked 4.5 s trials (the cut landed a few ms
  after a tick); not seen in the 6 randomised trials below. Bounded by one flush batch
  (`GATEWAY_QUEUE_FLUSH_BATCH_SIZE`, 20). No row is lost and none leaves the queue without its PUBACK.
  Left unchanged pending the leader's decision (final report of this session).

## Measurements (indicative, 3 trials per condition)

In-process aedes, 2 nodes, 1 s tick, SOS every 3 ticks, reconnect 3000 ms, warm-up and tail 10 s.

| Outage | NFR-REL-02 delivery | NFR-REL-04 P0 first | NFR-REL-01 latency p95, max | Drain after restore | Duplicates, shed |
|---|---|---|---|---|---|
| 30 s | 390/390 (100 %) | 30/30 | 29 ms, 32 ms | 220 to 360 ms | 0, 0 |
| 2 min | 1556/1556 (100 %) | 120/120 | 25 ms, 30 ms | 915 to 1005 ms | 0, 0 |

The 20-trial runs are open (README, about 14.7 h).

## Checks

Gateway: jest 8 suites, 37 tests passed; eslint on `src` and `test` 0 problems; `tsc --noEmit` and
`tsc -p test/tsconfig.json` clean; `npm run build` clean. No backend or frontend file touched, so their
checks were not run.

## Not done

Stage C table and topics, `fs_captured_at` and `fs_sent_at`, `FromRadio` decoder, packaging (task 5.1);
the 20-trial runs, a silent (non-reset) link, a real Mosquitto and the backend in the harness loop
(task 5.3); a fix for the in-flight replay order.
