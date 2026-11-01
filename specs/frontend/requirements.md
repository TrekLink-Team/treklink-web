# Requirements Specification: frontend (web client)

**User Story**: As **any user of TrekLink**, I want one responsive web application that shows me only what my role and organization allow, works on a phone for on-duty operators, and tells me plainly what happened when something fails.
**Story ID**: the Stories row of `tasks.md` (backlog D-051) | **Priority**: High | **Milestone**: every Main Flow

> **Authority**: Report 3 SRS (2026-10-14; traceability checked 2026-10-19) Table 78 (screen authorization), NFR-UI-01 to NFR-UI-04, NFR-USE-01 to NFR-USE-05, NFR-SEC-03, NFR-LEG-05, §5.3 messages MSG01 to MSG39, FR-MON-01, FR-MON-05, FR-MON-09, BR-30; D-031 (Leaflet, OpenStreetMap, overlay); `06-frontend-conventions.md` (FSD, Tailwind, TanStack Query). Rewritten 2026-10-04 (D-036): the customer portal and every booking and trip screen are retired. Screens Flow and Screen Descriptions of the SRS are due at W8; this suite fixes routes and behaviour, not visual design.

---

## 1. Domain Context & Scope

- **In-Scope**: the public pages (plans, registration), sign-in and password pages, the organization
  workspace (Manager and Operator), the TrekLink workspace (Staff and Admin), the live map widget, alert
  banners, and the client contracts with every backend `api-design/`.
- **Out-of-Scope**: the Field Station local page (`gateway/`, its own small UI); native mobile apps.
- **Depends on**: every backend module's `api-design/` and `ws-live-contract.md`.

---

## 2. EARS Functional Criteria

### Ubiquitous

- **REQ-UBI-01**: The client SHALL show a route only when the signed-in role holds its permission (design §2), and SHALL treat this as convenience only: the server decides (NFR-SEC-03).
- **REQ-UBI-02**: The client SHALL unwrap the D-002 envelope in one place and SHALL show the server's `message` for a failure, never a raw error, stack or internal id. [NFR-UI-02]
- **REQ-UBI-03**: The client SHALL be usable on a 360 px wide mobile browser for the operator's incident and map screens. [NFR-UI-01]
- **REQ-UBI-04**: The client SHALL meet WCAG 2.1 AA: logical tab order, visible focus, keyboard operation of every control, text alternatives on map markers. [NFR-USE-03]
- **REQ-UBI-05**: The client SHALL show times in the viewer's timezone, UTC+7 by default. [NFR-USE-05]
- **REQ-UBI-06**: Every map SHALL use Leaflet with the configured basemaps and their attribution, open on the default basemap, let the user switch between basemaps, and draw the Vietnamese sovereignty overlay over Hoàng Sa and Trường Sa on every basemap. The overlay SHALL NOT appear in the layer control. A basemap marked `localOnly` SHALL be left out when the page is not served from a loopback host, unless no other basemap remains. [FR-MON-01, BR-30, D-031, D-072]
- **REQ-UBI-07**: Every multi-step flow SHALL take at most 4 steps of at most 6 fields; acknowledging an incident SHALL be one step with at most 2 fields. [NFR-USE-01, NFR-USE-02]
- **REQ-UBI-08**: Sandbox payments SHALL be labelled as sandbox wherever shown. [NFR-UI-03]
- **REQ-UBI-09**: The public plans page, the registration page and the organization incident screens SHALL state that TrekLink does not replace official search-and-rescue channels and that the organization remains responsible for its own emergency response. [NFR-LEG-05]

### Event-Driven

- **REQ-EVT-01**: WHEN an `incident.alert` arrives, the client SHALL show the red pulsing banner MSG31 with a one-tap acknowledge, on every page, until acknowledged or taken by someone else (MSG27). In poll mode (REQ-EVT-03) the banner comes from the open-incidents read instead and clears on the next poll after an acknowledge or a take-over. [FR-INC-06]
- **REQ-EVT-02**: WHEN an access token expires, the client SHALL refresh it once and retry; WHEN refresh fails, it SHALL return to sign-in. WHEN the page loads with a refresh token in the tab's `sessionStorage`, the client SHALL run one silent refresh and restore the session before routing (D-090 rule 3).
- **REQ-EVT-03**: WHEN the socket disconnects, the client SHALL show MSG32, reconnect with its last cursor, and clear the banner on `replay.done`. WHERE the build sets `VITE_LIVE_MODE=poll` (a host that cannot keep a socket, D-089), the client SHALL open no socket, SHALL NOT show MSG32, SHALL refetch the views the stream would refresh every 15 seconds, SHALL show MSG31 for the open incidents that wait for the viewer (an organization's unacknowledged `NOTIFY_*` incidents to its members, unrouted and escalated ones to Staff), and the header SHALL say "Auto refresh" instead of "Live". [FR-MON-05]
- **REQ-EVT-04**: WHEN the map provider fails, the client SHALL show MSG33 and keep the lists live. [FR-MON-09]

### Unwanted Behaviour

- **REQ-ERR-01**: IF the server answers 404 or 403 for a page's main record, THEN the client SHALL show MSG26 and nothing of the record.

---

## 3. Acceptance Criteria

- **AC-01**: An Org Operator sees no Contracts-request, Members or API keys entries; typing their URLs shows MSG26 when the server refuses.
- **AC-02**: On a phone, an operator acknowledges an alert from the banner in one tap.
- **AC-03**: The map renders the overlay labels at every zoom where the archipelagos are visible. (TC-30)
- **AC-04**: axe-core reports no serious or critical violation on every route.
