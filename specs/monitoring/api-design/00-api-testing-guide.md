# API Testing Guide: monitoring

Setup and tokens: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).

## Watch the socket

```bash
npx wscat -c "ws://localhost:3000/socket.io/?EIO=4&transport=websocket"
```

A Socket.io client is easier: `io("http://localhost:3000/monitoring", { auth: { token } })` in a Node REPL, then `socket.onAny(console.log)`.

## Scope test (E04-5)

1. Connect as the `guide` of trip A and as `operator`.
2. Publish positions for a device on trip B.
3. The operator socket logs `device:position`; the guide socket logs nothing.

## Stale test (E04-1)

Stop publishing for a device on an active trip. After `monitoring.deviceStaleSeconds` one `device:connectivity` with `STALE` arrives, and `GET /api/monitoring/snapshot` shows it with `lastSeenAt`.
