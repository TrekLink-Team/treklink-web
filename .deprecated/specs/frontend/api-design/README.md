# API Design Index: frontend

> The frontend consumes the backend contracts; it defines none of its own. Per `02-spec-driven-development-workflow.md` §2, this folder maps screens to the backend `api-design/*.md` files instead of duplicating them. Every call goes through `shared/api/apiClient.ts`, which unwraps the D-002 envelope and raises `ApiError { statusCode, errorCode, message }`.

| Screen or widget | Contracts |
|---|---|
| Packages, package detail | [`trips/01`](../../trips/api-design/01-get-trek-packages-list.md), [`trips/02`](../../trips/api-design/02-get-trek-packages-detail.md), [`trips/06`](../../trips/api-design/06-get-trips-list.md), [`billing/06`](../../billing/api-design/06-post-quotes.md) |
| Sign in, register, reset | [`auth/01` to `auth/07`](../../auth/api-design/README.md) |
| Booking wizard | [`rentals/01`](../../rentals/api-design/01-post-bookings-create.md), [`rentals/02`](../../rentals/api-design/02-post-bookings-reserve.md), [`billing/09`](../../billing/api-design/09-post-payments.md) |
| My bookings, agreement | [`rentals/03`, `04`, `07`, `14`, `15`](../../rentals/api-design/README.md) |
| My invoices | [`billing/07`, `08`, `09`](../../billing/api-design/README.md) |
| Operations dashboard, live map | [`monitoring/01`](../../monitoring/api-design/01-get-monitoring-snapshot.md), [`monitoring/03`](../../monitoring/api-design/03-ws-monitoring-events.md), [`incidents/01`](../../incidents/api-design/01-get-incidents-list.md), [`gateway-sync/01`](../../gateway-sync/api-design/01-op-health.md) |
| Incident detail | [`incidents/02` to `07`](../../incidents/api-design/README.md), [`gateway-sync/02`](../../gateway-sync/api-design/02-op-list-events.md) |
| Bookings queue | [`rentals/03` to `08`](../../rentals/api-design/README.md) |
| Rental desk | [`rentals/11` to `23`](../../rentals/api-design/README.md), [`billing/08` to `11`](../../billing/api-design/README.md) |
| Trips | [`trips/05` to `16`](../../trips/api-design/README.md) |
| Fleet, device detail | [`devices/01` to `13`](../../devices/api-design/README.md), [`rentals/10`](../../rentals/api-design/10-get-rentals-list.md), [`incidents/01`](../../incidents/api-design/01-get-incidents-list.md) |
| Guide trips, handover, readiness, finish | [`trips/07`, `09`, `12`, `13`](../../trips/api-design/README.md), [`rentals/17`](../../rentals/api-design/17-post-rentals-item-handover.md) |
| Admin users and roles | [`auth/10` to `17`](../../auth/api-design/README.md) |
| Admin parameters, audit | [`platform/02` to `05`](../../platform/api-design/README.md) |
| Admin pricing | [`billing/01` to `05`](../../billing/api-design/README.md) |
| Admin sync health and audit | [`gateway-sync/01` to `04`](../../gateway-sync/api-design/README.md) |
