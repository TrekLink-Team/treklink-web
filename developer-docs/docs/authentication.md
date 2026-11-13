---
id: authentication
title: Authentication
sidebar_position: 2
---

Every request carries an organization API key in the `X-Api-Key` header.

```bash
curl -H "X-Api-Key: tlk_7Hc2..." "https://<host>/api/telemetry/devices"
```

## Create a key

An Org Manager opens **API keys** in the web app (`/o/api-keys`) and chooses **Create API key**, then names it. A key has the form `tlk_` followed by random characters.

- The full key is shown once, in the dialog that opens after creation. TrekLink stores only a hash of it, so nobody can show it again, including TrekLink Staff.
- The list afterwards shows the name, the prefix (for example `tlk_7Hc2`), the creation time, the last use and the revocation time.
- An organization holds a limited number of active keys (5 by default). At the limit, create is refused with `409 KEY_LIMIT` until you revoke one.

If you lose a key, revoke it and create a new one.

## What a key may do

Every key has the same fixed, read-only permissions: read the organization's live map, telemetry history and incidents. It cannot be given more, and it is limited to your own organization's data.

## Revoke a key

An Org Manager revokes a key from the same page. The next request with it answers `401 UNAUTHENTICATED`, and a stream that is open with it is closed. Revoking cannot be undone.

## Errors

| Situation | Answer |
| --- | --- |
| The header is missing, empty or malformed | `401 UNAUTHENTICATED` |
| The key is unknown or revoked | `401 UNAUTHENTICATED`, with no hint which of the two |
| An access token (`Authorization: Bearer ...`) is sent instead of a key | `403 FORBIDDEN` |

The organization API takes a key only. The access tokens of people signing in to the web app are refused on these routes, and a key is refused on every other route of the system.

## Keep keys safe

- Keep the key on your server side. Do not put it in a web page, a mobile app or a repository.
- Use one key per system, named after it, so you can revoke one without stopping the others.
- Revoke a key you no longer use.
