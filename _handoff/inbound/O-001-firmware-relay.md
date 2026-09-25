# O-001 | orchestrator to cloud | firmware relay | ANSWER

Delivered as a separate file, not a `SYNC.md` entry, so it merges cleanly while you are pushing.
Reply in `SYNC.md` as usual. Everything below comes from the `treklink-firmware` session, checked
by the orchestrator against `treklink-firmware@733dd40`, and is already in the SSOT: `treklink-docs`
PR #27 (merged into `dev`) replaced `04-firmware-ground-truth.md` and appended five register rows.
Your snapshot in `web-pack.zip` predates it.

## Facts that change `gateway-sync`

1. A fall auto-SOS sends one `BACKGROUND` position and one `"SOS - FALL DETECTED"` text frame, then
   nothing: it never calls `tickBeacon()` (`FallDetectionModule.cpp:140-145`). An SOS raised before
   the first GPS fix sends no beacon positions at all (`PositionModule.cpp:352-355`). REQ-EVT-06, the
   cadence-anomaly detector, therefore cannot fire for either case. Both are firmware fix candidates
   scheduled as `onboard-queue` Phase 9, so specify the detector against today's behaviour and note
   that the fixes add beacons later.
2. The node's MQTT uplink also forwards and queues peer packets it hears (`Router.cpp:767-769`). A
   peer SOS arrives at the broker as a `HIGH` priority text frame, not `MAX`. Do not infer SOS from
   priority. Classify by the `"SOS - "` text prefix.
3. In direct Wi-Fi mode stock firmware drains one queued entry per reconnect (`MQTT.cpp:604-636`,
   `:699-710`). Until `onboard-queue` ships, expect a backlog to arrive slowly and out of real time.
   Order by the event timestamp in the payload, never by arrival.
4. The v1 build env is `treklink`, not `treklink-v1`.

## Queue-health report, decided (firmware O-003, Q-A4)

The node publishes a queue-health report on `PRIVATE_APP` (256), MQTT only, and the firmware adds a
`PRIVATE_APP` case to its JSON serializer, so it is readable on the `<root>/2/json/...` topic
`gateway-sync` Stage A already ingests. The schema is `health-payload.md` in this folder. The
firmware `onboard-queue/design.md` §2.4 is the source of truth. Align REQ-EVT-12 and REQ-EVT-13 with
it: the report creates no `GatewayEvent` and never enters episode correlation.

Record in `SYNC.md` which requirement IDs you changed because of this file.
