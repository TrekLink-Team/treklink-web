---
id: envelope-and-errors
title: Response envelope and errors
sidebar_position: 3
---

Every answer of the system, success or failure, has the same four fields.

| Field | Type | Meaning |
| --- | --- | --- |
| `result` | object | The payload on success. `{ "errorCode": "..." }` on failure. |
| `isSuccess` | boolean | `true` for a 2xx answer. |
| `statusCode` | integer | The HTTP status, repeated in the body. |
| `message` | string | A short sentence for people. Do not parse it. |

## Success

```json
{
  "result": { "entries": [], "nextCursor": 88215, "hasMore": false },
  "isSuccess": true,
  "statusCode": 200,
  "message": "OK"
}
```

## Failure

```json
{
  "result": { "errorCode": "UNAUTHENTICATED" },
  "isSuccess": false,
  "statusCode": 401,
  "message": "Authentication required."
}
```

Branch on the HTTP status and `result.errorCode`. The `message` can change wording.

## Errors of the organization API

| Status | `result.errorCode` | When | What to do |
| --- | --- | --- | --- |
| 400 | `VALIDATION_FAILED` | `after` is missing or not a whole number, `limit` is outside 1 to 500, or the query carries a parameter the route does not know. The message names the field. | Fix the query. |
| 401 | `UNAUTHENTICATED` | The key is missing, malformed, unknown or revoked. | Check the header. Create a new key if it was revoked. |
| 403 | `FORBIDDEN` | An access token was sent instead of a key. | Send `X-Api-Key`. |
| 410 | `CURSOR_EXPIRED` | The `after` cursor is older than the stream retention window. | Read the devices again and stream from the new cursor. See [Reading the stream](./reading-the-stream.md). |
| 429 | `RATE_LIMITED` | The key spent its requests for the current minute. | Wait for the next minute. See [Rate limits](./rate-limits.md). |

A 5xx answer carries `INTERNAL_ERROR` or `SERVICE_UNAVAILABLE`. Retry it after a pause that grows with each attempt.

The [API reference](./reference/treklink-organization-api.info.mdx) shows the envelope example of each response per endpoint.
