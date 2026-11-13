---
id: introduction
title: Introduction
slug: /
sidebar_position: 1
---

The organization API lets your own systems read the devices your organization rents from TrekLink and the events they report. It is read-only: no request changes a device, a contract or an incident.

## What it offers

| Endpoint | Use it to |
| --- | --- |
| `GET /api/telemetry/devices` | Read every unit of your open contracts with its state, last position, battery, holder label and open incident, plus a cursor to stream from. |
| `GET /api/telemetry/stream` | Read the events after a cursor (positions, telemetry, staleness, incident changes), oldest first. |

Both endpoints answer for your organization only. You never pass an organization id: the key decides it.

## Who can create a key

An Org Manager creates keys, on the **API keys** page of the web app (`/o/api-keys`). The page also lists your keys by name and prefix and revokes them. The full key is shown once, when it is created. [Authentication](./authentication.md) covers the details.

## First request

Replace `<host>` with the host of the TrekLink system you use and `<key>` with your key.

```bash
curl -H "X-Api-Key: <key>" "https://<host>/api/telemetry/devices"
```

A successful answer is a JSON envelope. `result.cursor` is the stream position at the time of the read, and `result.devices` holds one object per unit.

```json
{
  "result": { "cursor": 88213, "devices": [] },
  "isSuccess": true,
  "statusCode": 200,
  "message": "OK"
}
```

## Where to go next

1. [Authentication](./authentication.md): the `X-Api-Key` header, revoking a key.
2. [Response envelope and errors](./envelope-and-errors.md): the shape of every answer and each error code.
3. [Rate limits](./rate-limits.md): how many requests a key may send.
4. [Reading the stream](./reading-the-stream.md): follow changes with the `after` cursor.
5. [API reference](./reference/treklink-organization-api.info.mdx): every parameter and response, with a panel to try a request.
