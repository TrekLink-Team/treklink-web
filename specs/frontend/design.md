# Technical Design: frontend

> Fulfills `requirements.md` in this folder. Conventions: `06-frontend-conventions.md`. Routes for loss
> cases, maintenance, compliance cases and replacement added 2026-10-18 (D-045 to D-047).
>
> **Status**: Approved, written by KhoaDD and merged on `dev` (treklink-web PR #30 and #31, 2026-10-18). Changes go through a pull request reviewed by KhoaDD (D-052).

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

Matches SRS Table 78. `own` routes are inside the organization workspace and always scoped by the token.
TrekLink Admin inherits every TrekLink Staff route, and Org Manager every Org Operator route (FR-AUTH-10,
auth REQ-UBI-05, D-057 rule 7); a row names Admin only where an action on the page is Admin-only.

| Route | Page | Roles |
|---|---|---|
| `/` , `/plans` | Plans and how renting works | public |
| `/register` | Register an organization (MSG04) | public |
| `/sign-in`, `/forgot`, `/reset`, `/welcome` (set password) | Auth | public |
| `/o` | Organization home dashboard: contract summary, balance due, open incidents, devices out; built in Sprint 4, task 5.6 (D-059 rule 1) | Org Manager |
| `/o/map` | Live map | Org Operator, Org Manager |
| `/o/devices/:id/telemetry` | Position and telemetry history of a rented device, clipped to the organization's rental periods; period in `?from=&to=` (D-057 rule 8) | Org Operator, Org Manager |
| `/o/incidents`, `/o/incidents/:id` | Incident queue and detail | Org Operator, Org Manager |
| `/o/contracts`, `/o/contracts/:id` | Contracts, devices, holder labels | Org Operator (read), Org Manager |
| `/o/contracts/new` | Request with quote | Org Manager |
| `/o/invoices`, `/o/invoices/:id`, `/o/pay/:paymentId` | Invoices and SePay payment | Org Manager |
| `/o/members`, `/o/roster`, `/o/api-keys`, `/o/field-stations` | Organization administration; the Field Stations page shows each station's version, `outdated`, and the current release download (FR-EVT-18) | Org Manager (roster and stations readable by Operators) |
| `/o/loss-cases` | Loss cases of the organization's devices; a loss is reported from the contract's device row (D-045) | Org Manager |
| `/t/organizations`, `/t/organizations/:id` | Verification (NDA and software licence) and approval queues; channel key exposure and rotation | TrekLink Staff, Admin |
| `/t/contracts`, `/t/contracts/:id`, `/t/counter/:contractId` | Approval queue, counter handover and check-in, inspection, mid-contract replacement (UC-61) | TrekLink Staff |
| `/t/fleet`, `/t/devices/:id`, `/t/stock-take` | Fleet, device detail and lifecycle history (reset, retire, dispose actions), stock-take | TrekLink Staff, Admin (retire, dispose) |
| `/t/devices/:id/telemetry` | Position and telemetry history of any device; period in `?from=&to=` (D-057 rule 8) | TrekLink Staff |
| `/t/maintenance`, `/t/maintenance/approvals` | Maintenance records, the week's service list, estimates, completion with checklist and firmware; cost approvals on their own tab route (D-047, D-057 rule 3) | TrekLink Staff, Admin (approvals) |
| `/t/loss-cases`, `/t/loss-cases/:id` | Loss cases: triage, recover, confirm, settle (D-045) | TrekLink Staff, Admin (decisions) |
| `/t/compliance-cases`, `/t/compliance-cases/:id` | Compliance cases with actions and close (D-046) | TrekLink Staff, Admin (suspend) |
| `/t/incidents` | Unrouted and escalated queue, authority reports | TrekLink Staff |
| `/t/map` | Fleet map | TrekLink Staff |
| `/t/billing`, `/t/damage-charges` | Invoices, counter payments, damage approvals | TrekLink Staff, Admin (decisions) |
| `/t/reports` | Reports | TrekLink Staff |
| `/t/admin/accounts`, `/t/admin/roles`, `/t/admin/parameters`, `/t/admin/prices`, `/t/admin/variants`, `/t/admin/health` | Administration | TrekLink Admin |
| `/t/admin/audit/changes`, `/t/admin/audit/sign-ins` | Audit: the change log (`auditLog.read`) and the sign-in log (`authEvent.read`), one tab per route, each tab hidden without its permission; `/t/admin/audit` redirects to `changes`; filters in the query (D-057 rule 3) | TrekLink Admin |

**Landing after sign-in** (D-059 rule 1): a same-origin `?next=` path wins; otherwise the Org Manager lands
on `/o`, the Org Operator on `/o/map`, TrekLink Staff and Admin
on `/t/map`. **No route of their own** (D-059 rule 5): the account menu is a header menu with a
change-password dialog; damage rates are a section of `/t/admin/prices`.

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

---

## 7. Layout rules

**Sticky page chrome** (leader rule of 2026-10-30, dry run defect 6). On every long page the title, the
breadcrumb and the stepper (or the view tabs that act as steps) stay at the top of the content area and
turn compact once the content has scrolled a little; the action bar with Back, Next and the primary
action stays at the bottom; only the content between them scrolls. Pages build it from the shared
`StickyPageHeader` and `PageActionBar` (design-system §5.2), never with their own sticky or fixed
positioning. Dialogs follow the same rule: the title and the footer stay put and only the body scrolls.

Moved onto it on 2026-10-30: the counter handover and the counter's screen 5.5 (check-in, reset and
inspection, close), the contract request, organization review, and the open and complete maintenance
dialogs. The rule applies to every new long or multi-step page.
