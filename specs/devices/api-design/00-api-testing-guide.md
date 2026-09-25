# API Testing Guide: devices

Setup and tokens: [`specs/platform/api-design/00-api-testing-guide.md`](../../platform/api-design/00-api-testing-guide.md).

## Walkthrough 1: register and inspect

1. As `operator`, `GET /api/hardware-variants`; note the `treklink-v3` id.
2. `POST /api/devices` with `assetTag TL-0042`, that variant and `nodeNum !a4b1c2d3`. Expect 201, state `AVAILABLE`.
3. `POST /api/devices` again with `nodeNum 2763113171`. Expect 409 `NODE_NUM_TAKEN` (same node, decimal form).
4. `GET /api/devices/{id}/status-history`. Expect one row `null to AVAILABLE`.

## Walkthrough 2: the FSM guard

1. `POST /api/devices/{id}/transitions` with `toStatus RENTED`. Expect 409 `TRANSITION_NOT_MANUAL`.
2. `toStatus MAINTENANCE`, `reason STAFF_REPORTED`. Expect 200 and an open maintenance record.
3. `PATCH /api/devices/{id}/maintenance/{recordId}` with `COMPLETED`. Expect device `AVAILABLE`.

## Walkthrough 3: PSK version as configuration (D-015 demo)

1. Record provisioning at version 1.
2. As `admin`, `PATCH /api/settings/parameters/devices.currentPskVersion` to 2.
3. Attempt check-out of that device through `rentals`. Expect 409 `PSK_NOT_CURRENT`.
4. Record provisioning at version 2; check-out succeeds.
