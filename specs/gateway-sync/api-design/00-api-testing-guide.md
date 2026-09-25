# API Testing Guide: gateway-sync

Setup and tokens: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md). Ingestion is not an HTTP call; it is driven by publishing to the broker.

## Publish a captured SOS frame

```bash
mosquitto_pub -h localhost -t 'treklink/2/json/0/!a4b1c2d3' -f fixtures/sos-text.json
```

Fixtures are the golden captures of task 0.4, never hand-written.

## The 10x replay demonstration (E02-2, NFR-REL-03)

```bash
for i in $(seq 1 10); do mosquitto_pub -h localhost -t 'treklink/2/json/0/!a4b1c2d3' -f fixtures/sos-text.json; done
```

Then, as `admin`:

```bash
curl -s -X POST http://localhost:3000/api/gateway-sync -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"op":"listAudit","summary":true}'
```

Expect `ACCEPTED: 1`, `DUPLICATE_REJECTED: 9`, and `GET /api/incidents?deviceId=...` showing exactly one Incident.

## Per-operation authorization (design §4 caveat)

As `operator`, `{"op":"listAudit"}` must return 403. As `admin` it returns 200. This check replaces the route-level visibility that one route per operation would have given.
