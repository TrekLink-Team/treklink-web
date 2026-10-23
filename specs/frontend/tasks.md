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

- [ ] 1.1 Router, auth context, role guards (owner LongNN)
  - **Files**: `frontend/src/app/router.tsx`, `app/providers/AuthProvider.tsx`, `shared/lib/permissions.ts`
  - **Do**: the routes of design §2; a route shows only when the role holds its permission, as convenience; the query cache is cleared on sign-in and sign-out
  - **Test**: AC-01; switching accounts never shows the previous organization's cached data
  - _Requirements: REQ-UBI-01, REQ-ERR-01, AC-01, NFR-SEC-03_
- [ ] 1.2 `apiClient` (owner LongNN)
  - **Files**: the existing `frontend/src/shared/api/apiClient.ts`
  - **Do**: unwrap the D-002 envelope once; throw `ApiError { statusCode, errorCode, message }`; on 401 refresh once (auth api-design 02) and retry, else go to sign-in; run one refresh at a time and share its result between concurrent callers, because a second rotation of the same token revokes the session (D-060 rule 8)
  - **Test**: unit tests for success, failure envelope, refresh-and-retry, refresh failure
  - _Requirements: REQ-UBI-02, REQ-EVT-02, NFR-UI-02_
- [ ] 1.3 Leaflet map with the overlay (owner LongNN)
  - **Files**: the existing `shared/config/map.ts` and `widgets/LiveMapWidget/LiveMapWidget.tsx`
  - **Do**: replace MapLibre with Leaflet; remove `maplibre-gl`; tiles and attribution from `GET /api/map/config`; an overlay `LayerGroup` with the two archipelago labels, always on top, not removable; markers with text alternatives; MSG33 when tiles fail, lists stay live
  - **Test**: AC-03 at each zoom where the archipelagos show
  - _Requirements: REQ-UBI-06, REQ-EVT-04, AC-03, FR-MON-01, FR-MON-09, BR-30, D-031_
- [ ] 1.4 `socketClient` and the global alert banner (owner LongNN)
  - **Files**: the existing `shared/socket/socketClient.ts`, `app/AlertBanner.tsx`
  - **Do**: one socket to `/live` (`ws-live-contract.md`); last cursor in `sessionStorage`; MSG32 while reconnecting, cleared on `replay.done`; `incident.alert` shows the red pulsing MSG31 banner on every page with one-tap acknowledge until acknowledged or taken (MSG27); stream entries invalidate the matching query keys
  - **Test**: AC-02 on a 360 px viewport
  - _Requirements: REQ-EVT-01, REQ-EVT-03, AC-02, FR-MON-05, FR-INC-06_

## Phase 2: Public and auth pages

- [ ] 2.1 Sign-in, forgot, reset, welcome (set password) (owner LongLP)
  - **Do**: auth api-design 01, 05, 06, 07; one message for wrong credentials (MSG09); code errors MSG08; landing after sign-in per `design.md` §2 (D-059 rule 1)
  - _Story: US-UC08, US-UC09_
- [ ] 2.2 Account menu: profile and change password (owner LongLP)
  - **Do**: auth api-design 04 and 08
  - _Story: US-UC08_
- [ ] 2.3 Plans page (owner LongNN)
  - **Do**: billing api-design 01, public; the search-and-rescue disclaimer (also on `RegisterPage`)
  - _Requirements: REQ-UBI-09, NFR-LEG-05_
  - _Story: US-UC15_

## Phase 3: Organization onboarding and administration

- [ ] 3.1 `RegisterPage` (owner TanNB)
  - **Do**: organizations api-design 01; MSG04 on success; MSG10 on a duplicate
  - _Story: US-UC01_
- [ ] 3.2 `OrganizationReviewPage` for Staff and Admin (owner TanNB)
  - **Do**: organizations api-design 02, 03, 05 to 11; verification form with method, documents, master contract reference and the NDA and software licence checkboxes (both required); approve or reject (MSG16, MSG21); suspend, reactivate, close
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

- [ ] 5.1 `ContractRequestPage` with quote (owner LongLP)
  - **Do**: rentals api-design 01 and billing api-design 02; four steps at most
  - _Story: US-UC15_
- [ ] 5.2 `ContractDetailPage` and contract lists (owner LongLP)
  - **Do**: rentals api-design 02, 03, 06, 11, 12, 13, 18 and billing api-design 10; cancel, notice (MSG18), holder labels, handover note download
  - _Story: US-UC18, US-UC23, US-UC25, US-UC55_
- [ ] 5.3 `ContractApprovalPage` (owner LongLP)
  - **Do**: rentals api-design 04 and 05; availability from devices api-design 24; MSG11 on shortfall
  - _Story: US-UC16, US-UC17_
- [ ] 5.4 `CounterPage` handover (owner LongLP)
  - **Do**: rentals api-design 07 to 10 in four steps (design §5): devices with scan, provisioning, battery and GPS check and swap; payment status; preview note; signature pad (PNG) and identity field; nothing stored in the browser after submit
  - _Story: US-UC14, US-UC20, US-UC21_
- [ ] 5.5 Check-in, inspection, replacement, close (owner LongLP)
  - **Do**: rentals api-design 14 to 17; check-in by scan (MSG07); inspection with damage codes; replacement of a faulty or lost unit with a signed note; close with MSG29 on open incidents
  - _Story: US-UC43, US-UC44, US-UC51, US-UC61_
- [ ] 5.6 Organization home dashboard `/o` (owner LongLP)
  - **Do**: Sprint 4. The Org Manager's landing page (D-059 rule 1): contract summary from rentals api-design 02, balance due from billing api-design 10, open incidents from incidents api-design 01 (`open=true`), devices out; widgets `ContractSummary`, `InvoiceTable`, `IncidentQueue` of §1; screen design first (`ui-design/5-6-*.md`)
  - _Story: US-UC55_

## Phase 6: Billing

- [ ] 6.1 `InvoicePage` and invoice list (owner LongLP)
  - **Do**: billing api-design 08, 09; lines with due dates and status
  - _Story: US-UC55_
- [ ] 6.2 SePay payment page (owner LongLP)
  - **Do**: billing api-design 11, 15; VietQR image labelled sandbox; poll the payment until `CONFIRMED` (MSG20) or `EXPIRED` (MSG25)
  - _Requirements: REQ-UBI-08, NFR-UI-03_
  - _Story: US-UC19_
- [ ] 6.3 Counter payments (owner LongLP)
  - **Do**: billing api-design 13, 14; overpayment and duplicate reference errors
  - _Story: US-UC22_
- [ ] 6.4 Prices, damage rates, `DamageChargesPage` (owner LongLP)
  - **Do**: billing api-design 03 to 07, 16, 17; decision hidden for the inspector (MSG30)
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
