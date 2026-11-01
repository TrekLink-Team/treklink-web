# Local MQTT broker

Two configurations of mosquitto 2 for local work (gateway-sync design §4, task 3.1).

| File | Used by | Behaviour |
|---|---|---|
| `mosquitto.conf` | `docker-compose.yml` (the default) | Open listeners on 1883 and 9001 (websockets), no credentials, persistence on. The demo runs on this. |
| `mosquitto.auth.conf` | `docker-compose.broker-auth.yml` (opt-in) | The mosquitto-go-auth plugin asks the backend's hooks (`POST /api/internal/mqtt/user` and `/acl`) about every connection, publish and subscription. Anonymous clients are refused. |
| `broker-hook-proxy.conf.template` | `docker-compose.broker-auth.yml` | nginx between the plugin and the backend. go-auth's HTTP backend cannot send a custom header (see below), so the proxy adds `X-Broker-Secret` from `MQTT_AUTH_HOOK_SECRET`. |

### Why a proxy

The go-auth HTTP backend sets only two request headers, in `httpRequest` of
[`backends/http.go`](https://raw.githubusercontent.com/iegomez/mosquitto-go-auth/master/backends/http.go):
`req.Header.Set("Content-Type", "application/json")` and `req.Header.Set("User-Agent", o.UserAgent)`.
Its options (`auth_opt_http_host`, `_port`, `_getuser_uri`, `_superuser_uri`, `_aclcheck_uri`, `_with_tls`,
`_verify_peer`, `_response_mode`, `_params_mode`, `_method`, `_timeout`, `_user_agent`), read in `NewHTTP` of
the same file and listed in the
[README](https://github.com/iegomez/mosquitto-go-auth#http), include none for another header. Read on
2026-11-01 at the `master` branch; the repository was archived by its owner in June 2025.

## Switching to the broker with credentials

1. Give the backend a hook secret of at least 16 characters, and the backend subscriber a credential,
   in `backend/.env` (or the shell that starts it):

   ```bash
   MQTT_AUTH_HOOK_SECRET="<a long random value>"
   MQTT_USERNAME="treklink-backend"
   MQTT_PASSWORD="<another long random value>"
   # optional, for Stage A and B fleet nodes:
   MQTT_NODE_PASSWORD="<a third long random value>"
   ```

   Then start the backend on the host's port 3000 (`npm run dev:backend`).

2. Start the broker with the override file, with the same secret in the environment or in the root
   `.env` that Compose reads:

   ```bash
   MQTT_AUTH_HOOK_SECRET="<the same value>" docker compose -f docker-compose.yml -f docker-compose.broker-auth.yml up -d mosquitto
   ```

   A backend elsewhere than the host's port 3000 is named with `BROKER_HOOK_BACKEND`, for example
   `BROKER_HOOK_BACKEND=http://192.168.1.10:3000`.

3. A Field Station connects with the Username and Secret of its credential (`GATEWAY_FS_USERNAME`,
   `GATEWAY_FS_SECRET`). A revoked station is refused at its next connection once the plugin's cache
   entry (60 s at most) has expired.

## Switching back

```bash
docker compose -f docker-compose.yml -f docker-compose.broker-auth.yml down
```

```bash
docker compose up -d mosquitto
```

The backend needs no change to go back: with `MQTT_AUTH_HOOK_SECRET` set or unset it works against
the open broker, which ignores the subscriber's username and password.

## Fleet nodes

A Stage A or B fleet node logs in as `node-<nodeId>` (for example `node-!a4b1c2d3`) with the password
in the backend's `MQTT_NODE_PASSWORD`, shared by every node. With it unset, fleet nodes are refused.
Each node username may publish only its own topics (design §4), but any holder of the shared password
can log in under any node username; that limit is accepted until per-device secrets come with the
hosted broker (D-055).

## What the broker with credentials does not yet allow

- The Stage B bridge of `gateway/` when it publishes node topics without credentials, as the demo does.
  Keep the default broker for that flow.

## Checking it by hand

With the broker and backend up, from any machine with the mosquitto clients:

```bash
mosquitto_pub -h localhost -V 5 -q 1 -u fs-org-0001-1 -P "<station secret>" -t treklink/fs/fs-org-0001-1/health -m '{}' -d
```

A valid credential gets `CONNACK (0)` and `PUBACK (RC:0)`; a wrong secret gets `Connection error: Not
authorized`; a publish under another station's topic gets `PUBACK (RC:135)`.
