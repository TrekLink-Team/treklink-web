---
id: rate-limits
title: Rate limits
sidebar_position: 4
---

Each key may send a fixed number of requests per minute. The limit is per key, not per organization or address, so two systems with two keys do not share it.

| Property | Value |
| --- | --- |
| Default | 120 requests per minute per key |
| Window | One minute, starting at the first counted request of the key |
| Configured by | The platform parameter `monitoring.apiRateLimitPerMinute`, between 10 and 6000. It belongs to the platform, not to an organization. |
| Answer when spent | `429`, `result.errorCode` is `RATE_LIMITED` |

A request counts once it has passed authentication and validation. The 429 answer carries no `Retry-After` header: wait until the next minute.

```json
{
  "result": { "errorCode": "RATE_LIMITED" },
  "isSuccess": false,
  "statusCode": 429,
  "message": "Too many requests. Try again in a minute."
}
```

## Stay inside the limit

- Read `GET /api/telemetry/devices` once at start and when a stream answers 410. Follow changes with `GET /api/telemetry/stream` after that.
- Poll the stream every few seconds, not in a tight loop. With `hasMore` set to `false` there is nothing waiting, so pause before the next call.
- On a 429, stop for the rest of the minute, then continue from the same cursor. No entry is lost, because the cursor decides what you read next.
