# Requirements Specification: frontend

**User Story**: As **each of the four roles**, I want one responsive web app that shows me exactly my screens, works on a phone at a trailhead, keeps a live map honest about stale data, and makes the time-critical actions (acknowledging an SOS, checking a device out) the shortest paths in the product.
**Story IDs**: US-015, US-016, US-021, US-024, US-025, US-037, US-039, US-055, US-056, US-065, US-066, US-070, plus the UI tasks of every backend story | **Priority**: High | **Main Flows**: MF-01 to MF-05 (MF-01 and MF-02 views first for Review 2) | **Lane**: LongNN (FSD, map and monitoring UI), with each backend owner building their own module's screens per D-023

> **Authority**: D-012 (MapLibre GL over Goong; provider, style, key and viewport are configuration; OpenStreetMap prohibited), D-015, `06-frontend-conventions.md` (FSD, state triad, 4 steps and 6 fields, WCAG 2.1 AA, Pattern A/B/C, API client rules), NFR-USE-01 to NFR-USE-05, NFR-LEG-01, NFR-LEG-04. This spec references backend `api-design/*.md` files and does not duplicate them (`02-spec-driven-development-workflow.md` §2).

---

## 1. Domain Context & Scope

- **In-Scope**:
  - Public pages: package catalogue, package detail with open trips, sign-in, registration with OTP, password reset
  - Customer area: booking wizard with quote, hold countdown and sandbox escrow payment; my bookings, rentals, invoices; agreement signing
  - Operator area: bookings queue, trip management, rental desk (allocation, agreement, check-out, check-in, inspection, settlement), device fleet, incident queue and detail, live map
  - Guide area: my trips, readiness checklist, handover check, own-trip live map, incident acknowledge and notes
  - Admin area: users and roles, parameters, pricing, audit log, gateway sync health and audit (RQ1 evidence)
  - Shared: envelope-unwrapping API client with silent refresh, one socket client, live store, map widget, connectivity and battery indicators, confirmation modals, error and empty states
- **Out-of-Scope**:
  - Native mobile apps (charter §2); the web app is responsive instead
  - Localisation of the operations app: charter §2 lists localisation as out of scope. Q9's locale system applies to the landing page (`TrekLink-Team.github.io`), not here. Strings are nonetheless kept in one module per feature so a later locale layer is a mechanical change (C-003 asks whether that is wanted now)
  - The public landing site (separate repository)
- **Depends on**: every backend module's `api-design/`; `monitoring` socket contract.

### Traceability

| Group | MF | UC | FR / NFR | Exception | Story |
|---|---|---|---|---|---|
| Browse and book | MF-01 | UC-01, UC-02, UC-03 | FR-TRIP-01, FR-BOOK-01, NFR-USE-01 | E01-1 | US-024, US-025, US-026 |
| Operator rental desk | MF-01, MF-05 | UC-04 to UC-12 | FR-RENT-*, FR-BILL-* | E01-3, E05-4 | US-027 to US-036 |
| Guide field views | MF-01, MF-03, MF-04 | UC-14, UC-15, UC-17 | FR-AUTH-03, NFR-USE-02, NFR-USE-04 | E04-5 | US-033, US-037, US-038, US-063 |
| Live map | MF-04 | UC-14 | FR-MON-01, FR-MON-03, NFR-LEG-01, NFR-USE-05 | E04-1, E04-2, E04-3, E04-6 | US-055, US-056, US-065 |
| Incident handling | MF-03 | UC-15, UC-16, UC-17, UC-26 | FR-INC-*, NFR-USE-02 | E03-1, E03-3, E03-7 | US-060 to US-066, US-088 |
| Administration | all | UC-18, UC-19, UC-20 | FR-ADM-*, NFR-CFG-01 | | US-009, US-067, US-073 |

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The app SHALL follow Feature-Sliced Design with the dependency rule `shared → entities → features → widgets → pages → app`, enforced by a lint rule. [`04-architecture-conventions.md` §5]
- **REQ-UBI-02**: The app SHALL call the backend only through `shared/api/apiClient.ts`, which unwraps the D-002 envelope once and turns a failure into an `ApiError { statusCode, errorCode, message }`; no component SHALL see the envelope. [`06-frontend-conventions.md` §6.1]
- **REQ-UBI-03**: The app SHALL keep server state in TanStack Query, live state in one Zustand store fed by one socket connection, form state in React Hook Form with Zod, and UI state locally; server state SHALL NOT be copied into a global store. [`06-frontend-conventions.md` §2]
- **REQ-UBI-04**: The app SHALL mirror every backend request DTO with a Zod schema field for field, including bounds, and SHALL validate before submission. [`06-frontend-conventions.md` §6.2]
- **REQ-UBI-05**: The app SHALL read the map provider, style URL, map key, attribution and default viewport only from `shared/config/map.ts`, which reads environment variables, and SHALL have no fallback tile source; OpenStreetMap and other global default tiles SHALL NOT be used. [D-012, NFR-LEG-01, BR-24]
- **REQ-UBI-06**: The app SHALL treat CASL rules from `GET /api/auth/me` as display hints only; every action is still authorised by the server, and a 403 or 404 SHALL render as a clear message, never a blank screen. [NFR-SEC-03]
- **REQ-UBI-07**: The app SHALL meet WCAG 2.1 AA: logical tab order, visible focus, keyboard operation of every control, Escape closes modals and returns focus, and no information conveyed by colour alone. [NFR-USE-03, `13-diagram-and-figure-conventions.md` monochrome rule applied to status markers]
- **REQ-UBI-08**: The app SHALL be usable at 360 px wide for every Guide screen and for the incident acknowledge action. [NFR-USE-04]
- **REQ-UBI-09**: The app SHALL show times in the viewer's browser time zone, defaulting to `Asia/Ho_Chi_Minh` when the browser reports none, and SHALL label the zone. [Q37] *(Proposal: browser time zone instead of IP geolocation, which needs an external service. C-003.)*
- **REQ-UBI-10**: The app SHALL display the disclaimer that TrekLink is an operations and coordination tool and does not replace official search-and-rescue channels, on the live map and incident screens. [NFR-LEG-04]

### Event-Driven

- **REQ-EVT-01**: WHEN an API call returns 401 `UNAUTHENTICATED`, the client SHALL call `/api/auth/refresh` once, replay the request, and on a refresh failure clear the session and route to sign-in. [`06-frontend-conventions.md` §6.1]
- **REQ-EVT-02**: WHEN the socket disconnects, the app SHALL show a visible "reconnecting" indicator; WHEN it reconnects or detects a `seq` gap, it SHALL reload the snapshot and replace the live store. [E04-3, E03-7]
- **REQ-EVT-03**: WHEN an `incident:new` or `incident:escalated` message arrives, the app SHALL show it in the incident queue beside the map without scrolling, announce it to assistive technology (`aria-live="assertive"`), and play an audible cue that the user can mute. [US-058, `06-frontend-conventions.md` §4 Pattern B]
- **REQ-EVT-04**: WHEN the map style or tiles fail to load or the key is rejected, the map area SHALL show a visible error state while the device and incident panels keep working. [E04-6]
- **REQ-EVT-05**: WHEN a reservation returns 409 `DEVICE_NOT_AVAILABLE`, the booking wizard SHALL say the device is no longer available, keep the booking, and offer to retry or change the device count. [E01-1]
- **REQ-EVT-06**: WHEN an acknowledgement returns 409 `ALREADY_ACKNOWLEDGED`, the app SHALL show who acknowledged and when, and update the row, without an error styling. [E03-3]

### State-Driven

- **REQ-STA-01**: WHILE a device is `STALE`, its marker SHALL render with a distinct outline and pattern plus its last-seen time, never as a current position. [E04-1, NFR-USE-05, BR-15]
- **REQ-STA-02**: WHILE a gateway is `STALE`, the per-gateway indicator SHALL show it in the map header, not in a tooltip. [E04-2]
- **REQ-STA-03**: WHILE an Incident is `SUSPECTED`, it SHALL render with a hatched marker and the word "Suspected", and its actions SHALL include Dismiss. [E03-1, US-088]
- **REQ-STA-04**: WHILE a Customer hold is running, the booking wizard SHALL show a countdown to `holdExpiresAt`.

### Unwanted Behaviour

- **REQ-ERR-01**: IF a server 400 arrives for a form the Zod schema accepted, THEN the app SHALL show the `message` as a form-level banner. [`06-frontend-conventions.md` §6.3]
- **REQ-ERR-02**: IF a list has no rows, THEN the app SHALL show an informative empty state with the next action, never a blank table. [Pattern A]
- **REQ-ERR-03**: IF a state-changing action is destructive (retire, cancel, dismiss, reject), THEN the app SHALL ask for confirmation in a modal first. [Pattern A]

### Optional Features

- **REQ-OPT-01**: WHERE `VITE_MAP_STYLE_VARIANT` selects `goong_satellite`, the map SHALL use the satellite style with the same overlays.

---

## 3. Non-Functional Requirements

| Property | Target | Source |
|---|---|---|
| Multi-step flows | at most 4 steps, 6 fields per step | NFR-USE-01 |
| Acknowledge | one step, at most 2 inputs | NFR-USE-02 |
| Accessibility | WCAG 2.1 AA, checked with axe in CI | NFR-USE-03 |
| Map key | referer allowlist and per-IP rate limit set in the Goong console, recorded as evidence | D-012, NFR-SEC-05 |
| Sovereignty | Goong confirmed compliant by the leader (Q28); screenshots over 16.5°N 112.0°E and 9.7°N 114.0°E filed | D-012 |

---

## 4. Configuration Matrix entries

| Parameter | Default | Location |
|---|---|---|
| `VITE_API_BASE_URL`, `VITE_WS_URL` | local backend | env |
| `VITE_MAP_PROVIDER`, `VITE_MAP_STYLE_URL`, `VITE_MAP_KEY`, `VITE_MAP_ATTRIBUTION` | Goong, no fallback | env |
| `VITE_MAP_CENTER_LNG`, `VITE_MAP_CENTER_LAT`, `VITE_MAP_ZOOM`, `VITE_MAP_MIN_ZOOM`, `VITE_MAP_MAX_ZOOM` | Ta Nang region | env |
| `VITE_DEFAULT_TIMEZONE` | `Asia/Ho_Chi_Minh` | env |

Thresholds shown in the UI (stale, battery levels) come from the server, never from frontend constants.

---

## 5. Acceptance Criteria

- **AC-01**: A lint rule fails the build when `entities/` imports from `features/`.
- **AC-02**: No component file contains `fetch(` or `axios`; a lint rule enforces it.
- **AC-03**: With `VITE_MAP_KEY` unset the app shows the map error state and the incident panel still lists incidents.
- **AC-04**: A Guide's live map after reconnect matches the Operator's view of the same trip.
- **AC-05**: The acknowledge action works with keyboard only and at 360 px wide.
- **AC-06**: axe reports no serious or critical violations on each page.
- **AC-07**: The booking wizard is 3 steps with at most 6 fields each.

---

## 6. Open Questions

Carried into QUESTION entry C-003: time-zone detection method, whether a locale layer is wanted in the operations app now, and the frontend test stack (Vitest, Testing Library and Playwright are proposed; the package has no test runner today).
