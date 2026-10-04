# Technical Design: frontend

> Fulfills `requirements.md` in this folder. Conventions: `06-frontend-conventions.md`.

---

## 1. Component architecture (Feature-Sliced Design)

| Layer | Slices |
|---|---|
| `app` | providers (TanStack Query, auth context, socket), router, global alert banner |
| `pages` | one per route of §2 |
| `widgets` | `LiveMapWidget`, `IncidentQueue`, `ContractSummary`, `InvoiceTable`, `RosterCalendar`, `FleetTable` |
| `features` | `acknowledge-incident`, `report-incident-status`, `request-contract`, `pay-invoice`, `sign-handover`, `check-in-devices`, `inspect-device`, `invite-member`, `manage-api-keys`, `manage-field-stations`, `edit-parameter`, `decide-damage-charge` |
| `entities` | `organization`, `member`, `device`, `contract`, `invoice`, `payment`, `incident`, `fieldStation` |
| `shared` | `api/apiClient`, `socket/socketClient`, `config/map`, `ui`, `lib/time` |

Existing code to change: `shared/config/map.ts` and `widgets/LiveMapWidget` move from MapLibre to
Leaflet with the overlay (D-031); the `maplibre-gl` dependency is removed; `pages/DashboardPage` is
replaced by the workspace home pages below.

---

## 2. Routes and screen authorization

Matches SRS Table 72. `own` routes are inside the organization workspace and always scoped by the token.

| Route | Page | Roles |
|---|---|---|
| `/` , `/plans` | Plans and how renting works | public |
| `/register` | Register an organization (MSG04) | public |
| `/sign-in`, `/forgot`, `/reset`, `/welcome` (set password) | Auth | public |
| `/o/map` | Live map | Org Operator, Org Manager |
| `/o/incidents`, `/o/incidents/:id` | Incident queue and detail | Org Operator, Org Manager |
| `/o/contracts`, `/o/contracts/:id` | Contracts, devices, holder labels | Org Operator (read), Org Manager |
| `/o/contracts/new` | Request with quote | Org Manager |
| `/o/invoices`, `/o/invoices/:id`, `/o/pay/:paymentId` | Invoices and SePay payment | Org Manager |
| `/o/members`, `/o/roster`, `/o/api-keys`, `/o/field-stations` | Organization administration | Org Manager (roster and stations readable by Operators) |
| `/t/organizations`, `/t/organizations/:id` | Verification and approval queues | TrekLink Staff, Admin |
| `/t/contracts`, `/t/contracts/:id`, `/t/counter/:contractId` | Approval queue, counter handover and check-in | TrekLink Staff |
| `/t/fleet`, `/t/devices/:id`, `/t/stock-take` | Fleet, device detail and history, stock-take | TrekLink Staff |
| `/t/incidents` | Unrouted and escalated queue, authority reports | TrekLink Staff |
| `/t/map` | Fleet map | TrekLink Staff |
| `/t/billing`, `/t/damage-charges` | Invoices, counter payments, damage approvals | TrekLink Staff, Admin (decisions) |
| `/t/reports` | Reports | TrekLink Staff |
| `/t/admin/accounts`, `/t/admin/roles`, `/t/admin/parameters`, `/t/admin/prices`, `/t/admin/variants`, `/t/admin/audit`, `/t/admin/health` | Administration | TrekLink Admin |

---

## 3. State

- Server state in TanStack Query; query keys per entity and organization; invalidation on the matching
  stream entry (`incident.changed` invalidates `['incident', id]` and the queue).
- `socketClient` keeps one socket, the last cursor in `sessionStorage`, and an event bus for widgets.
- The auth context holds the `me` response; `apiClient` refreshes once on 401.

---

## 4. Live map

Leaflet; tile layer from `GET /api/map/config` with its attribution; an overlay `LayerGroup` with the
two archipelago labels from the same response, always on top and not removable by the user; markers by
state with text alternatives; a stale marker shows last-seen time; an incident marker pulses. The map
starts from `GET /api/map/snapshot` and then applies `stream` entries in `seq` order, ignoring entries
at or below the snapshot cursor.

---

## 5. Counter screens

The counter handover is one page with four steps (NFR-USE-01): devices (scan, provisioning recorded,
battery and GPS check, swap), payment status, the preview note, and the signature pad with the identity
field. The signature pad produces a PNG; nothing is stored in the browser after submit.

---

## 6. Testing strategy

Component tests for the features; Playwright journeys per Main Flow on the seeded demo data; axe-core on
every route; a test that switching organization in the token never shows the previous organization's
cached data (query cache cleared on sign-out and sign-in).
