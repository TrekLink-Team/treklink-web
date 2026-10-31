# Field Station outage harness (gateway-sync task 5.3)

`outage.ts` measures what RQ1 asks of the Field Station: does every event generated while the uplink is
down reach the cloud once it is back, how fast, and SOS first. It reports against three rows of the NFR
table in `specs/gateway-sync/requirements.md` §3:

| NFR | Target | What the harness measures |
|---|---|---|
| NFR-REL-01 | ≤5 s Field Station to cloud with the uplink up | Latency, queue insert to arrival at the backend stand-in, of the events generated at least 5 s before the cut or after the backlog drained. A lost one counts as late |
| NFR-REL-02 | ≥99 % of the events generated during a 30 s to 30 min outage, ≥20 trials per condition | Delivered over generated, for the events generated between the cut and the restore; pooled over the trials and worst trial |
| NFR-REL-04 | ≥99 % P0 before any P2 or P3 on flush | Over the backlog (events queued at the restore and not yet delivered): the share of backlog P0 events that arrived before the first backlog P2 or P3 |

## What it runs

```
simulator -> SQLitePriorityQueue -> GatewayMqttClient -> uplink relay -> broker <- backend stand-in
            (the gateway's own code, unchanged)          (cut here)              (subscribes treklink/2/json/#)
```

- The Field Station is the gateway's own `FrameSimulator`, `SQLitePriorityQueue` and
  `GatewayMqttClient`, wired as `SerialFrameReader` wires them (enqueue, then flush), on a fresh
  SQLite file per trial.
- The uplink is a TCP relay (`test/support/uplink.ts`). A cut resets every open and new connection, the
  way a dropped link looks once the station's kernel reports it; the restore relays again. The backend
  stand-in connects to the broker directly, so only the station loses its link.
- The broker is aedes in process unless `--broker` names one (for example a local Mosquitto,
  anonymous access).
- Each trial: connect, warm up, cut at a random point inside one simulator tick, wait the outage,
  restore, wait for the backlog, run the tail, stop generating, wait for the last events.
- Not covered: a link that goes silent without a reset (the station then waits for its MQTT keepalive
  to notice), a station restart during the outage (the crash test in
  `src/mqtt/flush-outage.spec.ts` covers that), and the backend's ingestion (the stand-in only counts
  arrivals at the broker).

## Run it

From `gateway/` (`npm ci` at the repository root first):

```bash
npm run harness:outage -- --outage 30,120 --trials 3 > /dev/null
```

The report goes to stderr and the gateway's own JSON log lines to stdout, so `> /dev/null` leaves only
the report. One line per trial, then one table row per condition with pass or FAIL per NFR. A run with
fewer than 20 trials is marked indicative.

The full runs for RQ1 are 20 trials per condition from 30 s to 30 min. A trial takes its outage plus
about 23 s (warm-up, reconnect, tail), so the four conditions below take about 18 min, 48 min, 3.5 h and
10 h, about 14.7 h in all. Run them one condition at a time, on a machine that does not sleep, each with
its JSON record:

```bash
npm run harness:outage -- --outage 30 --trials 20 --json outage-30s.json > /dev/null
```

```bash
npm run harness:outage -- --outage 120 --trials 20 --json outage-2min.json > /dev/null
```

```bash
npm run harness:outage -- --outage 600 --trials 20 --json outage-10min.json > /dev/null
```

```bash
npm run harness:outage -- --outage 1800 --trials 20 --drain-timeout 600 --json outage-30min.json > /dev/null
```

| Option | Default | Meaning |
|---|---|---|
| `--outage` | `30,120` | Outage lengths in seconds, comma separated; each is one condition |
| `--trials` | `20` | Trials per condition |
| `--warmup`, `--tail` | `10`, `10` | Seconds with the uplink up before the cut and after the backlog drained |
| `--interval-ms` | `1000` | Simulator tick; each tick every node sends a position (P2) and a telemetry reading (P3) |
| `--nodes` | `2` | Simulated nodes, `!de000009` upwards |
| `--sos-every` | `3` | Every n-th tick the first node sends an SOS (P0) |
| `--reconnect-ms` | `GATEWAY_MQTT_RECONNECT_PERIOD_MS` (3000) | The station's MQTT reconnect period |
| `--drain-timeout` | `120` | Seconds to wait for the backlog, and for the last events, before a trial gives up on them |
| `--max-rows` | `GATEWAY_QUEUE_MAX_ROWS` (100000) | The queue bound; the table shows what it shed |
| `--min-trials` | `20` | Trials below which a condition is marked indicative |
| `--broker` | in-process aedes | An external broker URL |
| `--json` | none | Writes every trial's figures to this file |

`outage.spec.ts` runs one 2 s trial in CI so the harness keeps working; `outage-metrics.spec.ts` tests
the figures.
