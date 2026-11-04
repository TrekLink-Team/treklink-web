# TrekLink gateway (Field Station)

The Field Station program of `specs/gateway-sync` (design §3): it reads mesh packets from one node on a
USB serial port (or simulates them), stores each in a SQLite queue before any network attempt, flushes the
queue to the MQTT broker by priority tier, and serves a local page on the laptop.

```bash
npm run dev:gateway
```

Configuration comes from `.env` (see `.env.example` at the repository root, the "Gateway Configuration"
block, and `src/config.ts`). A value out of bounds stops the gateway at start.

## Serial reader (task 5.1)

With `GATEWAY_SERIAL_SIMULATION` `false` or unset, the gateway opens `GATEWAY_SERIAL_PORT` at
`GATEWAY_SERIAL_BAUD`, asks the node for its configuration, keeps the session with a heartbeat every 5
minutes, and queues every decoded text, position and device-metrics packet in the stock JSON shape with the
node on the port as `sender` (design §3.1). A port that fails or closes is opened again every
`GATEWAY_SERIAL_RECONNECT_MS`. Only `true` runs the simulator. It uses `@meshtastic/core` and
`@meshtastic/transport-node-serial`, ES modules that need Node 22.12 or later.

Tests replay `test/fixtures/serial/node-stream.hex`; rebuild it with
`npx ts-node -P test/tsconfig.json --transpile-only test/fixtures/serial/generate.ts`. Its frames are
encoded from the protobuf schemas until captures from the bench units replace them.

## Local page and local API (task 5.2)

Open `http://localhost:4321` on the Field Station laptop. The server binds to `127.0.0.1` only and
answers with the uplink down (REQ-STA-02): every route reads memory or the local SQLite file, never the
network. The page shows the uplink state, an SOS banner, the queue depth per tier with the oldest entry
and the last send, the broker and serial port state, every node heard (position, battery, SOS, stale)
and the recent events. It is plain HTML, CSS and JavaScript in `local-page/`, with no build step and no
external asset, so it works with no internet.

| Variable | Default | Bounds | Meaning |
|---|---|---|---|
| `GATEWAY_LOCAL_PORT` | `4321` | 1 to 65535 | Port on `127.0.0.1`; the host is fixed |
| `GATEWAY_LOCAL_STALE_SECONDS` | `300` | 30 to 7200 | A node silent this long is shown stale |
| `GATEWAY_LOCAL_EVENT_LOG_SIZE` | `200` | 10 to 10000 | Decoded events kept in memory for the page's log |

Routes, all in the D-002 envelope (`specs/gateway-sync/api-design/field-station-local-page.md`):

| Route | Returns |
|---|---|
| `GET /` | The page (`/page.css`, `/page.js` beside it) |
| `GET /local/nodes` | Every node heard: last position, battery, `sosActive`, `stale` |
| `GET /local/queue` | Depth per tier, the oldest entry's age and retry count, the last flush, shed counts |
| `GET /local/uplink` | Broker state and last error, serial port state |
| `GET /local/events?after=<localSeq>` | Recent decoded events, newest last |
| `PUT /local/config` | Not served yet (501); configuration is read from `.env` at start |

If the port is taken, the gateway logs `Local page not started` and keeps queuing and flushing.

## Tests

```bash
npm --prefix gateway run lint
npm --prefix gateway run typecheck
npm --prefix gateway test
```

The outage harness of task 5.3 is described in `test/harness/README.md`.
