# 2026-11-01 08:40: Field Station local page and local API (task W15, gateway-sync 5.2)

KhoaDD under D-078, run by the leader's cloud agent. Branch `feat/field-station-local-page` from
`origin/dev` at `dcd5cfe`. Scope: gateway-sync task 5.2; the MF-02 demo path (simulation mode, node topic,
flush order, PUBACK rule) is not changed.

## Done

| Item | Where |
|---|---|
| Local HTTP server on `127.0.0.1` only, `GATEWAY_LOCAL_PORT` (4321, 1 to 65535), started by `index.ts` after the MQTT client and the reader; a start failure is logged and the station keeps queuing | `gateway/src/local/local-server.ts`, `src/index.ts`, `src/config.ts` |
| Routes `/local/nodes`, `/local/queue`, `/local/uplink`, `/local/events?after=` in the D-002 envelope; `PUT /local/config` answers 501; Host check against DNS rebinding | `local-server.ts` |
| In-memory state holder: nodes heard, last position, battery, `sosActive`, stale after `GATEWAY_LOCAL_STALE_SECONDS`, bounded event log | `gateway/src/local/station-state.ts` |
| Small reads on existing classes: `SQLitePriorityQueue.oldestEntry()`, `GatewayMqttClient.uplinkStatus()` (with the last connection error), `SerialFrameReader.status()` and an `onFrame` observer called after each enqueue | `queue/priority-queue.ts`, `mqtt/mqtt-client.ts`, `serial/serial-reader.ts` |
| The page: one HTML file, its CSS and JS, no build step, same-origin-only CSP, polling every 2 s | `gateway/local-page/` |
| Docs: `.env.example`, `gateway/README.md` (new), root README, requirements §4 configuration table, design §3 row, the api-design contract as built, task 5.2 Partly done line | |

## Facts confirmed

- mqtt.js emits `error` for a refused connection (`connect ECONNREFUSED 127.0.0.1:1`), so `/local/uplink`
  shows the reason the uplink is down.
- Node's HTTP client calls `Socket.prototype.connect` with its normalised arguments as the first argument;
  the no-outbound tests read the target from `args[0][0]`.
- Real run: `ts-node src/index.ts` in simulation with `MQTT_BROKER_URL=mqtt://127.0.0.1:1`. The API
  answered, a foreign Host got 403, and Chromium at 360 px and 1280 px loaded the page with every request
  to `localhost:4321`, no console error and no horizontal overflow.
- Gateway checks on the last commit: lint 0 problems, typecheck clean, jest 12 suites and 89 tests passed.

## Open

- `PUT /local/config` (configuration from the page, stored locally): not built; asked the leader.
- The local clear of `sosActive`: the contract says an operator clears it locally but names no route; it
  stays set while the station runs.
- The task's test names a network interface taken down; the tests take the uplink down by refusing or
  stopping the broker and assert no request leaves the loopback.
- `PORT_GATEWAY=3001` in `.env.example` is read by nothing in the gateway (unchanged).
