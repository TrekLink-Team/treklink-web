# Implementation Tasks: frontend

> Rewritten 2026-10-18 (D-051) in the full task format of `specs/README.md` §6; adds the pages for loss
> cases, compliance cases, maintenance with cost approval, replacement and the Field Station release
> (D-045 to D-047). Fulfills `design.md`; every page calls the endpoints of its module's `api-design/`.
> Page names are the ones the Report 4 sequence diagrams use. Each page task follows its backend module's
> API Presentation phase.

| | |
|---|---|
| Lane owner | LongNN for the shell (Phase 1), shared components, maps, plans, administration, monitoring and verification; each module's pages belong to that module's lane owner (D-053), and LongNN reviews them |
| Reviewer | KhoaDD; LongNN reviews every page PR for consistency with §7 and §8 of `06-frontend-conventions.md` |
| Sprint | 3 (W7 to W8) for Phases 1, 2, 3.1, 4.1, 4.2, 5.1 to 5.3, 6.1 to 6.3 and 9.1 (MF-01, MF-02 demo); 4 for 5.6, 8 and 9; 5 for the rest |
| Stories | screens of every story with a human actor (secondary owner in the backlog); primary owner of US-UC38, US-UC42, US-UC55, US-UC59 |
| Depends on | platform 2.1; each backend module's controllers |

Every page task includes: TanStack Query hooks in the entity slice, loading, empty and error states (the
server's `message`, MSG26 for a refused main record), keyboard operation and visible focus, times in the
viewer's timezone, and at most 4 steps of at most 6 fields per flow.

## Phase 1: Shell

- [x] 1.1 Router, auth context, role guards (owner LongNN)
  - **Files**: `frontend/src/app/router.tsx`, `app/providers/AuthProvider.tsx`, `shared/lib/permissions.ts`
  - **Do**: the routes of design §2; a route shows only when the role holds its permission, as convenience; the query cache is cleared on sign-in and sign-out
  - **Test**: AC-01; switching accounts never shows the previous organization's cached data
  - _Requirements: REQ-UBI-01, REQ-ERR-01, AC-01, NFR-SEC-03_
- [x] 1.2 `apiClient` (owner LongNN)
  - **Files**: the existing `frontend/src/shared/api/apiClient.ts`
  - **Do**: unwrap the D-002 envelope once; throw `ApiError { statusCode, errorCode, message }`; on 401 refresh once (auth api-design 02) and retry, else go to sign-in; run one refresh at a time and share its result between concurrent callers, because a second rotation of the same token revokes the session (D-060 rule 8)
  - **Test**: unit tests for success, failure envelope, refresh-and-retry, refresh failure
  - _Requirements: REQ-UBI-02, REQ-EVT-02, NFR-UI-02_
- [x] 1.3 Leaflet map with the overlay (owner LongNN)
  - **Files**: the existing `shared/config/map.ts` and `widgets/LiveMapWidget/LiveMapWidget.tsx`
  - **Do**: replace MapLibre with Leaflet; remove `maplibre-gl`; tiles and attribution from `GET /api/map/config`; an overlay `LayerGroup` with the two archipelago labels, always on top, not removable; markers with text alternatives; MSG33 when tiles fail, lists stay live
  - **Test**: AC-03 at each zoom where the archipelagos show
  - _Requirements: REQ-UBI-06, REQ-EVT-04, AC-03, FR-MON-01, FR-MON-09, BR-30, D-031_
- [x] 1.4 `socketClient` and the global alert banner (owner LongNN)
  - **Files**: the existing `shared/socket/socketClient.ts`, `app/AlertBanner.tsx`
  - **Do**: one socket to `/live` (`ws-live-contract.md`); last cursor in `sessionStorage`; MSG32 while reconnecting, cleared on `replay.done`; `incident.alert` shows the red pulsing MSG31 banner on every page with one-tap acknowledge until acknowledged or taken (MSG27); stream entries invalidate the matching query keys
  - **Test**: AC-02 on a 360 px viewport
  - _Requirements: REQ-EVT-01, REQ-EVT-03, AC-02, FR-MON-05, FR-INC-06_

## Phase 2: Public and auth pages

- [x] 2.1 Sign-in, forgot, reset, welcome (set password) (owner LongLP)
  - **Do**: auth api-design 01, 05, 06, 07; one message for wrong credentials (MSG09); code errors MSG08; landing after sign-in per `design.md` §2 (D-059 rule 1)
  - **Done**: the sign-in page at `/sign-in` with the landing rule, in treklink-web#48 and the same-origin `next` check of #50; `/forgot`, `/reset` and `/welcome` with US-UC09; a signed-in user on any of the four is sent to the landing route
  - **Fix** (2026-10-27): that redirect now keeps a same-origin `?next=`; before, `SignedOutOnly` rendered first after sign-in and sent every user to the default landing route, dropping `next`
  - _Story: US-UC08, US-UC09_
- [x] 2.2 Account menu: profile and change password (owner LongLP)
  - **Do**: auth api-design 04 and 08
  - **Done**: the header account menu with the read-only profile (`['me']`), the change-password dialog and sign out (auth 03), in TK-186; after a password change the client signs out to `/sign-in`, because the server ends every session (D-063 rule 1)
  - _Story: US-UC08_
- [ ] 2.3 Plans page (owner LongNN)
  - **Do**: billing api-design 01, public; the search-and-rescue disclaimer (also on `RegisterPage`)
  - _Requirements: REQ-UBI-09, NFR-LEG-05_
  - _Story: US-UC15_

## Phase 3: Organization onboarding and administration

- [ ] 3.1 `RegisterPage` (owner LongLP, reassigned from TanNB 2026-10-27, issue #98)
  - **Do**: organizations api-design 01; MSG04 on success; MSG10 on a duplicate
  - **Partly done** (2026-10-27, by LongLP for Review 2 in TanNB's lane): `/register`, public and linked from sign-in: seven fields with required checks, the server's field errors under each field, MSG10 as a page alert, MSG04 with the new code. Built on the pre-#95 `shared/ui`; it moves to the design-system components when it is rebased. Walked in the browser on local PGlite. Open: the screen design file `ui-design/3-1-*.md`, still a template
  - _Story: US-UC01_
- [ ] 3.2 `OrganizationReviewPage` for Staff and Admin (owner LongLP, reassigned from TanNB 2026-10-27, issue #98)
  - **Do**: organizations api-design 02, 03, 05 to 11; verification form with method, documents, master contract reference and the NDA and software licence checkboxes (both required); approve or reject (MSG16, MSG21); suspend, reactivate, close
  - **Partly done** (2026-10-27, LongLP): `/t/organizations` for Staff and Admin with the Pending, Active, Rejected and All tabs, the queue table and a side panel: details, the verification form (both terms required) and, for the Admin, Approve (held until verified, MSG21) and Reject with its reason dialog (MSG16). Typecheck and lint clean; not walked in a browser, which needs a Staff and an Admin sign-in. Open: suspend, reactivate and close (api-design 08 to 11), the screen design file, the move to the design-system components after #95
  - _Story: US-UC02, US-UC03, US-UC07_
- [ ] 3.3 Members and roster (owner TanNB)
  - **Do**: organizations api-design 12 to 19; invite, change role, deactivate (MSG for `LAST_MANAGER`); `RosterCalendar` widget with overlap errors and `NO_PRIMARY` warnings (MSG22)
  - _Story: US-UC04, US-UC05_
- [ ] 3.4 API keys (owner TanNB)
  - **Do**: organizations api-design 20 to 22; the secret is shown once with a copy button and never again
  - _Story: US-UC06_
- [ ] 3.5 `FieldStationsPage` (owner TanNB)
  - **Do**: organizations api-design 23 to 26; create shows the secret once; health columns with `outdated`; the current release with its version, SHA-256 and one download per operating system
  - _Story: US-UC06, US-UC42_
- [ ] 3.6 `ComplianceCasePage` and channel key rotation (owner TanNB)
  - **Do**: organizations api-design 27 to 31; open a case, record actions (suspend for Admin only), close with outcome and authority reference (required for fraud and theft); rotate key on the organization page clears the exposed flag
  - _Story: US-UC63_

## Phase 4: Fleet

- [ ] 4.1 Hardware variants admin (owner KhoaDD)
  - **Do**: devices api-design 01 to 04; service interval with checklist, firmware baseline, depreciation schedule
  - _Story: US-UC13_
- [ ] 4.2 Fleet table, register, intake, `DeviceDetailPage` (owner KhoaDD)
  - **Do**: devices api-design 05 to 10, 16, 23 and monitoring api-design 07; register, intake check (motion field only for motion variants), reset, retire, dispose with the three wipe steps
  - _Story: US-UC11, US-UC12, US-UC44, US-UC53, US-UC62_
- [ ] 4.3 `MaintenancePage` and `MaintenanceApprovalPage` (owner KhoaDD)
  - **Do**: devices api-design 11 to 15; the week's service list; estimate; completion with resolution, cost, checklist results and firmware version; Admin decision (hidden for the estimator, 403 shown if forced)
  - _Story: US-UC52, US-UC64, US-UC65_
- [ ] 4.4 `LossCasePage` (owner KhoaDD)
  - **Do**: devices api-design 17 to 22; Staff triage with suspected theft or fraud, recover, confirm; Admin decision (charged, reduced, waived, written off) with reason; Org Manager list at `/o/loss-cases` and the report action on the contract's device row
  - _Story: US-UC49, US-UC60_
- [ ] 4.5 Stock-take (owner KhoaDD)
  - **Do**: devices api-design 25 and 26; scan input; the four result groups
  - _Story: US-UC54_

## Phase 5: Contracts

- [x] 5.1 `ContractRequestPage` with quote (owner LongLP)
  - **Do**: rentals api-design 01 and billing api-design 02; four steps at most
  - _Story: US-UC15_
  - **Done** (2026-10-27): `/o/contracts/new` in three steps with the debounced quote panel (term fee, holding fee, balance per term, or the day-plan total and formula), field-level BELOW_MOQ, DAY_PLAN_LENGTH and date errors, the MSG28 banner for a not-active organization, a dirty-form check on Cancel, and MSG14 on the contract page
- [ ] 5.2 `ContractDetailPage` and contract lists (owner LongLP)
  - **Do**: rentals api-design 02, 03, 06, 11, 12, 13, 18 and billing api-design 10; cancel, notice (MSG18), holder labels, handover note download
  - _Story: US-UC18, US-UC23, US-UC25, US-UC55_
  - **Partly done** (2026-10-27): `/o/contracts` (status and plan filters, cards below 768 px) and the detail at `/o/contracts/:id` and `/t/contracts/:id` with prices, terms, devices, balance (billing 10), history (rentals 18) and Cancel with its reason dialog, STALE_VERSION reload and MSG15. Give notice (12, MSG18) and the holder label dialog with Clear label (13, MSG03) followed on 2026-10-27. The handover note download (11) followed with 5.4 on 2026-10-27, for the Org Manager and Staff, with a warning when the stored note no longer matches its hash or is missing; Staff open the counter from an approved contract. Open: Lost on a device row (screen 4.4)
- [x] 5.3 `ContractApprovalPage` (owner LongLP)
  - **Do**: rentals api-design 04 and 05; availability from devices api-design 24; MSG11 on shortfall
  - _Story: US-UC16, US-UC17_
  - **Partly done** (2026-10-27): `/t/contracts` with the Requested, Approved and All tabs as a table (cards below 768 px), the request panel with the handover appointment, Approve (reserved tags and expiry shown), Reject with its reason dialog, MSG11 and STALE_VERSION. The advisory availability banner (devices api-design 24) followed on 2026-10-27: amber with the count when fewer units than requested are available
- [ ] 5.4 `CounterPage` handover (owner LongLP)
  - **Do**: rentals api-design 07 to 10 in four steps (design §5): devices with scan, provisioning, battery and GPS check and swap; payment status; preview note; signature pad (PNG) and identity field; nothing stored in the browser after submit
  - **Partly done** (2026-10-27): `/t/counter/:contractId` for Staff in four steps. Devices: the scan field (MSG12 for a tag of another contract), Record provisioning with the key version from organizations 03, battery and GPS per unit, Swap with its reason dialog (MSG11 when no spare unit exists); Next is held until each unit is provisioned in this visit, read and has a fix. Payment: the first invoice's first line, its payments and the link to the counter payment of 6.3 (MSG23). Preview: the unsigned PDF in a frame. Sign: active Managers only (organizations 12), the identity field and the signature pad; LOW_BATTERY shows MSG19 with Proceed anyway, and FIRST_PAYMENT_MISSING, DEVICE_NOT_PROVISIONED and DEVICE_CHECK_FAILED return to their step with the named rows marked. MSG06 and the issued count on success; the signature, identity text and preview are dropped. Component-tested (5 tests). Open: a walk through the screen in a browser, which needs a member to sign in, and provisioning state survives only the visit (a reload asks to record it again; the server keeps the records)
  - _Story: US-UC14, US-UC20, US-UC21_
- [ ] 5.5 Check-in, inspection, replacement, close (owner LongLP)
  - **Do**: rentals api-design 14 to 17; check-in by scan (MSG07); inspection with damage codes; replacement of a faulty or lost unit with a signed note; close with MSG29 on open incidents
  - _Story: US-UC43, US-UC44, US-UC51, US-UC61_
- [ ] 5.6 Organization home dashboard `/o` (owner LongLP)
  - **Do**: Sprint 4. The Org Manager's landing page (D-059 rule 1): contract summary from rentals api-design 02, balance due from billing api-design 10, open incidents from incidents api-design 01 (`open=true`), devices out; widgets `ContractSummary`, `InvoiceTable`, `IncidentQueue` of §1; screen design first (`ui-design/5-6-*.md`)
  - _Story: US-UC55_

## Phase 6: Billing

- [x] 6.1 `InvoicePage` and invoice list (owner LongLP)
  - **Do**: billing api-design 08, 09; lines with due dates and status
  - _Story: US-UC55_
  - **Done** (2026-10-27): `/o/invoices` and `/o/invoices/:id` for the Org Manager, the invoice tab of `/t/billing` with the detail in a side panel for Staff; status and overdue filters, a contract filter from the contract page link, the line table with the derived line status, payments with the SANDBOX label. Pay with SePay waits on 6.2
- [ ] 6.2 SePay payment page (owner LongLP)
  - **Do**: billing api-design 11, 15; VietQR image labelled sandbox; poll the payment until `CONFIRMED` (MSG20) or `EXPIRED` (MSG25)
  - _Requirements: REQ-UBI-08, NFR-UI-03_
  - _Story: US-UC19_
- [x] 6.3 Counter payments (owner LongLP)
  - **Do**: billing api-design 13, 14; overpayment and duplicate reference errors
  - _Story: US-UC22_
  - **Done** (2026-10-27): the record dialog from the invoice detail (method, amount, reference; OVERPAYMENT under Amount, DUPLICATE_REFERENCE under Reference, MSG20 with the amount) and the payments tab of `/t/billing` with a status filter. 2026-10-28: Record counter payment on an invoice shows only while the contract balance (billing 10 `settled`) is open, per the ruling on issue #87 point 4; component-tested. The contract page and the counter header show the handover appointment from `handoverAppointmentAt`
- [ ] 6.4 Prices, damage rates, `DamageChargesPage` (owner LongLP)
  - **Do**: billing api-design 03 to 07, 16, 17; decision hidden for the inspector (MSG30)
  - **Partly done** (2026-10-27): `/t/admin/prices` for TrekLink Admin, the price history with Current, Upcoming and Past labels and the Schedule price dialog (confirmation, EFFECTIVE_IN_PAST under Effective from), the damage rates with Add and Edit (deactivation asks first, CONFLICT_UNIQUE under Code). Rebuilt on 2026-10-28 with the `shared/ui` components: `DataTable` with `StatusBadge` for both lists, a `Toolbar` of filters above each (variant and state for prices, text and active for rates), `Dialog` with `Field` and `Input`, and a `ConfirmDialog` naming the price or the rate; the entry sits under Administration in `navigation.ts`. 2026-10-29 (review of #91): the price state (Current, Upcoming, Past) comes from billing api-design 03 `state`, judged against the whole schedule, so an older page never shows a second Current. Open: `/t/damage-charges` and the decision dialog, waiting on billing 16 and 17 (treklink-docs#114)
  - _Story: US-UC48, US-UC56_

## Phase 7: Administration

- [ ] 7.1 TrekLink accounts (owner LongNN)
  - **Do**: auth api-design 09 to 14; last-Admin and self-demotion errors
  - _Story: US-UC10_
- [ ] 7.2 Roles and permissions (owner LongNN)
  - **Do**: auth api-design 15 and 16
  - _Story: US-UC10_
- [ ] 7.3 Authentication events (owner LongNN)
  - **Do**: auth api-design 17 with filters
  - _Story: US-UC58_
- [ ] 7.4 Parameters and audit log (owner LongNN)
  - **Do**: platform api-design 02 to 05; parameters grouped by module with inline edit within bounds and a history drawer; audit log with the organization filter
  - _Story: US-UC57, US-UC58_

## Phase 8: Incidents

- [ ] 8.1 Organization incident queue and `IncidentDetailPage` (owner HoangTK)
  - **Do**: incidents api-design 01 to 07, 12 to 14; one-step acknowledge with at most 2 fields; status and outcome forms; false alarm with a reason; the search-and-rescue disclaimer on the queue
  - _Requirements: REQ-UBI-03, REQ-UBI-07, REQ-UBI-09, AC-02_
  - _Story: US-UC32, US-UC33, US-UC34_
- [ ] 8.2 `StaffIncidentsPage` (owner HoangTK)
  - **Do**: unrouted and escalated queue; false alarm from `UNROUTED`
  - _Story: US-UC29, US-UC31_
- [ ] 8.3 Authority reports (owner HoangTK)
  - **Do**: incidents api-design 08 to 11; report on an incident or a defaulted contract; close the case
  - _Story: US-UC35, US-UC37_

## Phase 9: Monitoring

- [ ] 9.1 `LiveMapPage` for organizations and the fleet (owner LongNN)
  - **Do**: monitoring api-design 01 and 02 then stream entries in `seq` order, ignoring entries at or below the snapshot cursor; stale markers with last-seen time; pulsing incident markers; late entries kept off the live map
  - _Story: US-UC38, US-UC41_
- [ ] 9.2 Device telemetry history (owner LongNN)
  - **Do**: monitoring api-design 03; a range of at most 7 days
  - _Story: US-UC40_
- [ ] 9.3 `SystemHealthPage` (owner LongNN)
  - **Do**: monitoring api-design 06; stations with depth per tier and `outdated`; buffering devices; alert delivery stats
  - _Story: US-UC42_
- [ ] 9.4 Reports (owner LongNN)
  - **Do**: monitoring api-design 08; date range; CSV download
  - _Story: US-UC59_

## Phase 10: Verification

- [ ] 10.1 Playwright journeys MF-01 to MF-05 on the demo seed; axe-core on every route; 360 px check of the operator screens (owner LongNN)
  - _Requirements: REQ-UBI-03, REQ-UBI-04, REQ-UBI-05, AC-01, AC-04, NFR-USE-03, NFR-USE-05_
