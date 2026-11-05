# 2026-11-05 08:10 (UTC+7): W20B device page, fleet and contract screens

KhoaDD under D-078, branch `fix/device-contract-views` from `dev` at `35ca5cd`.

## Environment

- Postgres 16 from apt, a fresh `initdb` cluster on port 5433, database `treklink_demo`; never a Neon host.
  `prisma migrate deploy`, then `seed:demo` (55 row groups).
- No MQTT broker: the backend logs reconnect errors and the gateway did not run, so no device reports a
  position. TL-0009, TL-0010 and LOSS-0001 got a position by a local `UPDATE` for the map check only.
- RC-2026-0004 (day plan, 5 units, approved) and LOSS-0001 (TL-0010) were created through the local API
  as the seeded Manager and Staff, so the handover counter and the loss case page had data.
- The egress proxy of the cloud container refuses the tile hosts (OpenTopoMap, Esri, Stadia, OSM), so
  real tiles did not load and the map showed MSG33 with the overlay labels. The map check used a plain
  stub tile, as `e2e/support/fixtures.ts` `stubTiles` does.
- A Postgres data directory under the session scratchpad lost its permissions mid-run and the cluster
  stopped; moved to `/var/tmp`.

## Walk

78 page visits: Staff (two device pages, fleet, loss case, two contract homes, return counter, handover
counter, billing), Manager (`/o`, `/o/contracts/:id`) and signed out (`/plans`, `/sign-in`), at 1280, 900
and 360 px, light and dark. Each visit ran axe (WCAG 2.0, 2.1 A and AA, 2.2 AA) and a horizontal overflow
check: no violation, no overflow. Looked at the renders of the device page (1280 dark, 360 dark), the
small maps (device 1280, loss case 360, stub tiles), the contract home (360 light, 900 light), the return
and handover counters (360), the embedded Handover mode (360), the fleet List view (360 dark) and the plans
skip link after one Tab (360).

## Findings outside the task

- Loss case page at 360 px: two "Loss cases" back links, the shell breadcrumb and the page's own.
- Loss case page: "Device state when reported" prints the enum (`RENTED`).
- Fleet status chips at 360 px still scroll behind an arrow (kept by the leader ruling of 2026-11-04).
