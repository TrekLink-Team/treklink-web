---
id: reading-the-stream
title: Reading the stream with the after cursor
sidebar_label: Reading the stream
sidebar_position: 5
---

`GET /api/telemetry/stream` returns the events about your devices in the order they were written. Every entry has a `seq`, a number that only grows. You tell the endpoint where you stopped with `after`, and it returns the entries with a greater `seq`.

## The loop

1. Call `GET /api/telemetry/devices`. Keep `result.devices` as your starting state and `result.cursor` as your position.
2. Call `GET /api/telemetry/stream?after=<cursor>&limit=200`.
3. Apply `result.entries` to your state, in order.
4. Store `result.nextCursor` as the new position, after the entries are applied.
5. If `result.hasMore` is `true`, call again at once with the new position. If it is `false`, wait a few seconds, then call again.

`nextCursor` is the `seq` of the last entry returned. When no entry is returned it equals `after`, and you send it back unchanged on the next poll.

```bash
curl -H "X-Api-Key: <key>" \
  "https://<host>/api/telemetry/stream?after=88213&limit=200"
```

```json
{
  "result": {
    "entries": [
      {
        "seq": 88214,
        "type": "device.position",
        "deviceId": "0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10",
        "payload": { "lat": 11.5603, "lon": 108.5405, "at": "2026-10-20T03:15:00.000Z" },
        "createdAt": "2026-10-20T03:15:00.000Z"
      }
    ],
    "nextCursor": 88214,
    "hasMore": false
  },
  "isSuccess": true,
  "statusCode": 200,
  "message": "OK"
}
```

## Parameters

| Parameter | Required | Meaning |
| --- | --- | --- |
| `after` | yes | The last cursor you saw. A whole number, 0 or more. |
| `limit` | no | Most entries to return, 1 to 500. Default 500. |

## Example in Python

```python
import time
import requests

HOST = "https://<host>"
HEADERS = {"X-Api-Key": "<key>"}


def read_devices():
    body = requests.get(f"{HOST}/api/telemetry/devices", headers=HEADERS, timeout=30).json()
    return body["result"]["devices"], body["result"]["cursor"]


devices, cursor = read_devices()
while True:
    response = requests.get(
        f"{HOST}/api/telemetry/stream",
        params={"after": cursor, "limit": 200},
        headers=HEADERS,
        timeout=30,
    )
    if response.status_code == 410:
        devices, cursor = read_devices()  # the cursor expired: start again
        continue
    if response.status_code == 429:
        time.sleep(60)
        continue
    response.raise_for_status()
    page = response.json()["result"]
    for entry in page["entries"]:
        print(entry["seq"], entry["type"], entry["deviceId"])  # apply it to your state here
    cursor = page["nextCursor"]
    if not page["hasMore"]:
        time.sleep(5)
```

## When the cursor expires

Entries are kept for a limited time (72 hours by default, a platform setting). A cursor older than that answers `410` with `result.errorCode` `CURSOR_EXPIRED`, because the entries between it and now are gone. Positions are shared by every organization, so a quiet fleet that keeps polling with an unchanged cursor can also get `410` once that time has passed: handle `410` on every poll. Read `GET /api/telemetry/devices` again, replace your state with it and stream from the new `cursor`.

## Entry types

`payload` depends on `type`.

| `type` | `payload` fields |
| --- | --- |
| `device.position` | `lat`, `lon`, `at`, and `late: true` for a reading that occurred before the unit's latest check-in and reached the platform afterwards |
| `device.telemetry` | `batteryPct`, `at`, and `late: true` as above |
| `incident.changed` | `incidentId`, `state`, `tier`, `ownerId`, and details of the incident such as its code |
| `device.label` | `holder`, the new holder label |
| `device.groupChanged` | `group`, the unit's new group |
| `device.handedOver` | `contractId`, `at`: a unit joined your open contracts |
| `device.released` | `contractId`, `checkedInAt`: a unit left your open contracts |
| `device.stale` | `stale`, `lastSeenAt`: the unit went silent, or recovered |
| `station.stale` | `fieldStationId`, `stale`, `lastSyncAt`. `deviceId` is `null`. |

Treat an unknown `type` as something to skip, so a new kind of entry does not stop your reader. `deviceId` is `null` for entries that are not about one unit.

## What you receive

Only entries written for your organization are returned. A unit's entries start at the handover to you: nothing from before your custody is replayed, except from your own earlier custody of the same unit. The same rule shapes `GET /api/telemetry/devices`, where a unit you have not heard from since the handover is `NOT_HEARD` with a `null` position, battery and `lastSeenAt`.
