# MQTT fixtures (gateway-sync task 1.2)

Each file holds `{ "description", "messages": [{ "topic", "message" | "raw" }] }`. `message` is one stock
Meshtastic JSON publish exactly as `MeshPacketSerializer.cpp` builds it; `raw` is a payload that is not
JSON. The replay harness (`test/harness/replay.ts`) publishes them to a broker; the unit tests read them.

**Provenance: synthesized, not captured.** No capture from real devices exists yet. The envelope fields
follow `treklink-firmware/src/serialization/MeshPacketSerializer.cpp:440-454` (`id`, `timestamp` = the
uplinking node's `rx_time`, `to`, `from`, `channel`, `type`, `sender`, then `rssi`, `snr`, `hops_away`
and `hop_start` when set). Payload members follow the same file: `text` (`:28-50`), telemetry
`device_metrics` (`:56-69`), position (`:208-250`) and the TrekLink `treklink_queue_health` case. The SOS
strings follow `TrekLinkSOSHelper.h:19-20`. The channel name `LongFast` in the topic is a placeholder;
ingestion does not read it.

Node numbers are the demo seed's placeholders (`backend/prisma/seed-demo.ts`): TL-0009 is `!de000009`,
TL-0010 is `!de00000a`; `!de0000ff` is deliberately unregistered. Timestamps are 2026-10-23 03:00 UTC.
When real captures replace these files, put the captured node numbers on TL-0009 and TL-0010 in the
seed in the same change.

`station-sos-e02-7.json` is the Stage C shape (`treklink/fs/<username>/2/json/<channelId>/<nodeId>`,
mqtt-ingress-contract.md): the stock JSON of a TL-0010 SOS plus `fs_captured_at` and `fs_sent_at`, as
the Field Station `fs-org-a-1` of organization A flushes it after the unit went to B (E02-7, AC-06).
`!de0000a1` stands for the station's own USB node. The station clock runs 3 h fast, so the corrected
capture (`fs_captured_at + receivedAt - fs_sent_at`) is the device time only for a receipt at
2026-10-24 02:00 UTC. The database test `station-attribution.db-spec.ts` replaces `from`, `id` and the
two station times with values of its own run.
