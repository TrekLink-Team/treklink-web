# 2026-11-05 11:10 (UTC+7): W22 basemap sovereignty labels and the WCAG walk of the live map

KhoaDD under D-078, branch `fix/basemap-sovereignty-labels` from `dev` at `b0e6b856`. Frontend and specs.

## Tiles checked (zoom 5, 6 and 7, Gulf of Tonkin and East Sea)

Real tiles fetched from each host and joined into one image per zoom, then read by eye.

| Basemap | Seen | Outcome |
|---|---|---|
| OpenTopoMap | "South China Sea" in open water; "北部湾 Vịnh Bắc Bộ (Gulf of Tonkin)"; 西沙区 and 南沙区 (under the masks) | Hidden from the picker |
| Stadia | Not fetched: keyless tiles answer a loopback host only. Hidden on the 2026-11-04 panel walk finding | Hidden from the picker |
| Esri World Topo | "Gulf of Tonkin" in English only; no name in open water; no Chinese label | Kept, the only basemap left on the demo seed |
| OpenStreetMap | No sea name; 西沙区 and 南沙区 with PRC boundary lines around both archipelagos | Not in the server list since 2026-10-30; not re-added |

## Environment

Postgres 16 `initdb` cluster on port 5433, database `treklink_demo`, all migrations, `seed:demo` (56 row
groups); `MQTT_INGESTION_ENABLED=false`, no broker. Vite dev server, Chromium from `/opt/pw-browsers`, real
Esri tiles through the proxy.

## WCAG 2.2 AA walk (ui-design/0-ui-standard.md)

`/o/map` as `operator@treklink.local` and `/t/map` as `staff@treklink.local`, light and dark, at 1440,
1280, 900, 360 and 320 px. Each view: a screenshot read by eye, axe (WCAG 2.0, 2.1 and 2.2 A and AA tags), a
horizontal overflow check, an 80-stop Tab walk checking the focus outline and any fixed or sticky element
over the focused control, and the size of every pointer target. 360 and 320 px also in a fresh session for
the first screen. The basemap picker, not drawn on the demo seed, was checked with a second basemap
injected into the config response, at 1440 and 360 px in both themes.

Found and fixed:

1. 320 px: the header ran to 363 px and cut the account menu (1.4.10). Fixed in `AppHeader.tsx`,
   `EnvironmentBadge.tsx`, `AccountMenu.tsx`; fits with the Sandbox and Staging labels.
2. Skip link 102 by 22 px when focused (2.5.8). Now 44 px high (`AppShell.tsx`).
3. Map zoom buttons 40 px and basemap rows 28 px. Now 44 px (`app/styles/index.css`).

After the fixes: 0 axe violations in all 20 views, no horizontal overflow, an outline on every focus stop,
no focused control under a sticky bar. The only target under 24 px is the inline "Leaflet" credit link
(inline in text, an exception of 2.5.8).

## The picker on the demo seed (review of #391)

The seeded `monitoring.mapBasemaps` holds OpenTopoMap, Stadia and Esri (`scripts/specs/catalog.py`
`BASEMAPS`, migrations `20261027090000` to `20261101130000`). With the first two hidden, Esri is the only
entry, and the widget draws a layer control only for two or more basemaps (`LiveMapWidget.tsx`,
`basemaps.length > 1`). So on the demo seed and the Vercel staging the picker never shows, and its 44 px rows
cannot be seen in the app. They were seen only in the walk above, with a second basemap injected into the
config response.

OpenStreetMap is not kept as a second entry: screen 9.1 does not list it, and it is not in the seed list.
Migration `20261030220000_map_drop_osm_standard` removed it on 2026-10-30 (dry run defect 11) because its
tiles print the PRC district names 西沙区 and 南沙区 over the archipelagos, and the W22 tile check also saw
PRC boundary lines around both. No client filter removes it; it is absent from the server list. Re-adding it
needs a new forward migration and a ruling on D-031, raised to the leader.

Left for the leader (not in this task's files):

- At 320 px the Staff tab bar cuts "Fleet map", "Contracts" and "Invoices" with an ellipsis (`MobileTabBar.tsx`).
- On a phone the legend wraps to three rows over the lower third of the map, and the counts and search
  start at the bottom of the first screen (`LiveMapWidget.tsx` legend, `LiveMapPage.tsx`).
- The Trường Sa label is cut at the right edge of the map at zoom 6 until the map is dragged (known, demo
  script MF-04 step 3).
