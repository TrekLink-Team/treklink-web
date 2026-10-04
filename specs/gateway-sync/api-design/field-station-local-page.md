# Field Station local page and local API

> Module `gateway-sync`, Stage C. Hand-written: these routes are served by the Field Station executable on
> the organization's laptop (`treklink-web/gateway/`), not by the backend, and work with no internet
> (FR-EVT-12, NFR-UI-04). Local responses still use the D-002 envelope so the same frontend code reads them.

[TOC]

---
## Overview

The Field Station reads mesh packets from one rented node on a USB serial port, persists each to its
SQLite queue before any network attempt (FR-EVT-02), flushes by priority when the uplink is up
(FR-EVT-03, FR-EVT-04), and serves a page at `http://localhost:4321` (port configurable) showing what it
hears. The page binds to `127.0.0.1` only; there is no login, because it shows only what the laptop's own
radio receives. Configuration (broker URL, Field Station username and secret, serial port) is entered once
in the page and stored in the local configuration file, never sent anywhere but the broker.

## Routes

| Method | Route | Returns |
|---|---|---|
| GET | `/` | The single-page UI |
| GET | `/local/nodes` | Every node heard: `nodeId`, last position and time, battery, `sosActive` (an SOS or fall SOS heard with no later traffic suggesting otherwise is shown until an operator clears it locally), `stale` |
| GET | `/local/queue` | Queue depth per tier P0 to P3, the oldest entry's age and retry count, last successful flush |
| GET | `/local/uplink` | Broker connection state, last error, serial port state |
| PUT | `/local/config` | Sets broker URL, username, secret and serial port; the secret is stored and never returned |
| GET | `/local/events?after=<localSeq>` | Recent decoded events for the page's log, newest last |

`sosActive` on the local page is a display aid for the people on site. It never changes an incident: the
cloud incident is changed only by a person through the platform (D-038).

## Queue rules (Stage C)

| Rule | Requirement |
|---|---|
| Persist before any network attempt; the SQLite write is the commit point | FR-EVT-02 |
| Flush order: tier, then local queue sequence; every P0 before any P1, P2 or P3 | FR-EVT-03, BR-12 |
| Mark flushed only on the broker's PUBACK; on a drop, resume from the head | FR-EVT-04, E02-1 |
| At the configured bound shed P3 first, never P0; log each shed event | FR-EVT-06, E02-5 |
| Restart keeps every entry and reuses each entry's `from` and `id` | FR-EVT-07, E02-3 |
| Never compare wall clocks across hosts | FR-EVT-08, E02-6 |
| Publish to `treklink/fs/<username>/2/json/<channelId>/<nodeId>` | [mqtt-ingress-contract.md](mqtt-ingress-contract.md) |
| Report `queueDepth` and the oldest retry count every 60 s while connected, on `treklink/fs/<username>/health` | FR-EVT-13 |
