# WebSocket live contract: Socket.io namespace `/live`

> Module `monitoring`. Hand-written: push is not request and response, so it has no D-002 envelope. Every
> payload below is the `payload` of a `StreamEvent` row (schema `monitoring`), so a push and a REST replay
> (`GET /api/telemetry/stream`) carry the same shape.

[TOC]

---
## Overview

One authenticated socket per client (FR-MON-02). The server joins it to rooms on connect and never lets
the client choose a room, so organization scoping is enforced on the server (FR-AUTH-11, NFR-SEC-03).

| Client | Handshake `auth` | Rooms joined |
|---|---|---|
| Web user, organization member | `{ "token": "<access JWT>", "after": <cursor?> }` | `org:<organizationId>` |
| Web user, TrekLink Staff or Admin | same | `fleet` (every organization plus platform-wide entries) |
| Organization system | `{ "apiKey": "tlk_...", "after": <cursor?> }` | `org:<organizationId>` |

A failed handshake answers `connect_error` with `{ "errorCode": "UNAUTHENTICATED" }` and closes. A token
expiring during the session is refreshed by the client with `emit("auth.refresh", { token })`; an API key
revoked during the session first receives the event `auth.error` with `{ "errorCode": "KEY_REVOKED" }` and then has its socket closed (E04-5); the organization's other sockets stay open.

## Replay on connect and reconnect (FR-MON-05, E04-3)

When `after` is given the server first sends every entry of the client's rooms with `seq > after`, in
order, then `{ "type": "replay.done", "cursor": <seq> }`, then live entries. The web client shows
MSG32 ("Reconnecting. Live data is paused.") from disconnect to `replay.done`. A cursor older than
`monitoring.streamRetentionHours` gets `{ "type": "replay.expired" }` and the client reloads
`GET /api/map/snapshot`.

While a client replays, live entries for it are held back and delivered after the replay in `seq` order, so a replay and the live stream never interleave out of order. An account with no stream rights (no `fleet` and no organization room) gets `replay.done` at its own cursor and nothing else. A cursor that is not a non-negative integer counts as no cursor.

Both control messages are delivered as the event `stream`, with `type` `replay.done` or `replay.expired` in the same body as an entry (`seq` 0), so a client needs one listener (frontend 1.4). `replay.done` keeps its `cursor` field, and the client stores it so an empty replay still advances the cursor.

## Server-to-client event: `stream`

Every live entry is emitted as the event `stream` with this body:

```json
{ "seq": 88214, "type": "device.position", "deviceId": "0d3f6a2b-...", "payload": { }, "createdAt": "2026-10-20T03:15:00.000Z" }
```

| `type` | `payload` | Source |
|---|---|---|
| `device.position` | `{ lat, lon, at }` and `late: true` for a late entry; never an unplotted position (FR-MON-04). `altitude` is not carried by `field.position` yet | gateway-sync after commit, throttled by `monitoring.positionEmitMinIntervalMs` per device |
| `device.telemetry` | `{ batteryPct, at }` and `late: true` for a late entry | gateway-sync |
| `device.stale` | `{ stale: true, lastSeenAt }` or `{ stale: false }` | staleness sweep (FR-MON-03, BR-21) |
| `device.label` | `{ holder: { name } \| null }` | rentals (FR-CON-14) |
| `device.handedOver` | `{ contractId, at }`; the organization's map learns of the device, its first position follows | rentals on handover |
| `device.released` | `{ contractId, checkedInAt }`; the client removes the device and refreshes that contract's invoices; nothing more is sent for it to that organization (FR-MON-08). An entry stored before the field was added carries no `contractId`, and the client then narrows by the contracts it has cached | rentals on check-in |
| `incident.changed` | `{ incidentId, state, tier, ownerId }` today; `code`, `ownerName`, `lastPosition` and `stale` join when `incidents` exports a read for them (task 2.1 status) | incidents after commit (FR-INC-12) |
| `incident.alert` | `{ incidentId, code, deviceLabel, holderName, at, message }`; MSG31 for the recipient's tier | incidents outbox, WEBSOCKET channel, sent only to the recipient's personal room `user:<id>` |
| `station.stale` | `{ fieldStationId, stale, lastSyncAt }` | staleness sweep (E04-2) |

`incident.alert` is the only event addressed to a person rather than a room. Every other type goes to
`fleet` and to `org:<id>` of the entry's organization: for a position or telemetry, the organization the
field event is attributed to by its occurrence time (D-040); for an incident, the routed organization; for
a device event, the current holder. An `UNATTRIBUTED` field event goes to `fleet` only. A position whose
occurrence time precedes the device's check-in from that organization carries `late: true` and is not
drawn as a live marker.

## Client-to-server events

| Event | Body | Effect |
|---|---|---|
| `auth.refresh` | `{ token }` | Re-validates; on failure the socket closes |
| `ack` | `{ seq }` | Optional; the server records the client's last cursor for diagnostics only |

No client event changes data: acknowledgement and every other action go through REST with a policy check.

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant G as LiveGateway
    participant S as StreamService
    participant DB as Postgres
    C->>G: connect, auth { token, after }
    G->>G: verify token or API key, resolve rooms
    G->>S: replay(rooms, after)
    S->>DB: SELECT stream_events WHERE room scope AND seq > after
    S-->>G: entries
    G-->>C: stream (each), replay.done
    Note over G,C: live entries follow as they are committed
```
