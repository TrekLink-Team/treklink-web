# Evidence for frontend 1.3, AC-03

Both sovereignty overlay labels drawn over the OpenStreetMap tiles at zoom 5, 7 and 9, centred on
Hoang Sa (16.5N 112.0E) and Truong Sa (10.0N 114.0E). Captured 2026-10-24 from `LiveMapWidget` in
headless Edge at 1000 px wide.

`GET /api/map/config` is monitoring task 3.1 and is not built, so the page stubbed it with the sample
of monitoring api-design 01 (tile URL `https://tile.openstreetmap.org/{z}/{x}/{y}.png`). The throwaway
harness that mounted the widget is not committed. Re-capture these once task 3.1 serves the real config.

The base tiles still carry foreign toponyms (for example the Chinese label near Hoang Sa at zoom 7).
That is the accepted course risk of D-031 (R11); the overlay labels are drawn above them in every shot.
