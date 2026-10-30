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
  - **Partly done** (2026-10-30): `PlansPage` at `/` and `/plans` (public; the interim dashboard stays on `/o/map` and `/t/map`) over billing api-design 01: variant cards with the sandbox label, the shared terms, the four rental steps, loading, empty and error states with Retry (focus moves to the first card after a successful retry), the disclaimer under the header and above the contact line, and a signed-in user sees "Open your workspace" in place of Sign in and Register. The page asks `usePlans` for a 5-minute stale time with no refetch on window focus; the hook keeps its 60-second default for the other pages. `SAR_DISCLAIMER` now lives in `shared/ui/legal.ts` and is re-exported by `entities/incident/api.ts`, and `RegisterPage` shows it too. Component-tested (8); lint, typecheck and the frontend suite pass. Open: a walk through the page in a browser against a running backend, and a skip link (neither `AuthLayout` nor `AppShell` has one)
  - **Partly done** (2026-10-30, KhoaDD under D-078): rebased onto `dev`, and a component test asserts the contact link carries every `FOCUS` class (WCAG 2.4.7). Open: the browser walk-through and the skip link above
  - _Requirements: REQ-UBI-09, NFR-LEG-05_
  - _Story: US-UC15_

## Phase 3: Organization onboarding and administration

- [x] 3.1 `RegisterPage` (owner LongLP, reassigned from TanNB 2026-10-27, issue #98)
  - **Do**: organizations api-design 01; MSG04 on success; MSG10 on a duplicate
  - **Partly done** (2026-10-27, by LongLP for Review 2 in TanNB's lane): `/register`, public and linked from sign-in: seven fields with required checks, the server's field errors under each field, MSG10 as a page alert, MSG04 with the new code. Walked in the browser on local PGlite. 2026-10-28: rebuilt on the design-system components of #95, component-tested (required fields, MSG04 with the code), and `ui-design/3-1-registerpage.md` filled in
  - _Story: US-UC01_
  - **Done** (2026-10-30, LongLP): MSG10 is now component-tested too: a 409 `CONFLICT_UNIQUE` shows the server's message ("0312345678 is already registered.") as the page alert and keeps the form and its values (`OnboardingPages.test.tsx`). Nothing else in the `Do` line is open
- [x] 3.2 `OrganizationReviewPage` for Staff and Admin (owner LongLP, reassigned from TanNB 2026-10-27, issue #98)
  - **Do**: organizations api-design 02, 03, 05 to 11; verification form with method, documents, master contract reference and the NDA and software licence checkboxes (both required); approve or reject (MSG16, MSG21); suspend, reactivate, close
  - **Partly done** (2026-10-27, LongLP): `/t/organizations` for Staff and Admin with the Pending, Active, Rejected and All tabs, the queue table and a side panel: details, the verification form (both terms required) and, for the Admin, Approve (held until verified, MSG21) and Reject with its reason dialog (MSG16). 2026-10-28: rebuilt on the design-system components of #95 (Tabs, StatusBadge with `ORGANIZATION_STATUS`, Card panel, RadioGroup, Checkbox, Dialog, Alert), component-tested (Approve held until verified, both contract terms required), walked in the browser as the Admin (ORG-0002 verified and approved on local PGlite), and `ui-design/3-2-*.md` filled in. Open: suspend, reactivate and close (api-design 08 to 11)
  - **Done** (2026-10-30, LongLP): the Status section of the panel, Admin only, over the TK-120 endpoints: Suspend and Close organization on an `ACTIVE` organization, each through a dialog with the reason shown to the Manager (required, trimmed, at most 500 characters), and Reactivate on a `SUSPENDED` one. `OPEN_CONTRACTS` and `STALE_VERSION` stay in the dialog (a stale version also refetches the queue); `BALANCE_OUTSTANDING` and any other refusal of a reactivation show under Status. A Suspended tab joins the queue tabs. Every reviewer sees the Status history of api-design 11 (from, to, time, actor or SYSTEM, reason) once the organization has left `PENDING`. Every action invalidates `organizationKeys.all`, the history included. api-design 03 is not called: the rows of 02 carry every field the panel shows. Component-tested (4 new in `OnboardingPages.test.tsx`: suspend with a required reason, close refused with `OPEN_CONTRACTS`, reactivate refused then accepted, the history for Staff without the Admin actions). Not walked in a browser in this session
  - _Story: US-UC02, US-UC03, US-UC07_
- [x] 3.3 Members and roster (owner TanNB)
  - **Do**: organizations api-design 12 to 19; invite, change role, deactivate (MSG for `LAST_MANAGER`); `RosterCalendar` widget with overlap errors and `NO_PRIMARY` warnings (MSG22)
  - **Partly done** (2026-10-29, TanNB): `ui-design/3-3-members-and-roster.md` filled in, with its wireframe `3-3-members-and-roster.svg`. Open: the pages, their tests and the review
  - **Done** (2026-10-30, D-078 takeover, KhoaDD's agent): `MembersPage` at `/o/members` and `RosterPage` at `/o/roster`, built against `ui-design/3-3-members-and-roster.md`. Hooks in `src/entities/organization/members.ts` and `roster.ts`, the week view in `src/widgets/RosterCalendar/`, component tests in `MembersPage.test.tsx` and `RosterPage.test.tsx`. Routes registered in `app/router.tsx`; both entries flipped to `built: true` in `shared/config/navigation.ts`. Resend invitation uses auth api-design 05 (D-059 rule 6). Open: TanNB's review
  - _Story: US-UC04, US-UC05_
- [x] 3.4 API keys (owner TanNB)
  - **Do**: organizations api-design 20 to 22; the secret is shown once with a copy button and never again
  - **Done** (2026-10-30, D-078 takeover, KhoaDD's agent, PR #125): `ApiKeysPage` at `/o/api-keys`, built against `ui-design/3-4-api-keys.md` as merged from #117. `src/entities/api-key/api.ts`, `src/features/manage-api-keys/api.ts`, `src/pages/ApiKeysPage.tsx`, component tests in `ApiKeysPage.test.tsx`. Route registered in `app/router.tsx`; `/o/api-keys` flipped to `built: true` in `shared/config/navigation.ts`. Open: TanNB's review
  - _Story: US-UC06_
- [x] 3.5 `FieldStationsPage` (owner TanNB)
  - **Do**: organizations api-design 23 to 26; create shows the secret once; health columns with `outdated`; the current release with its version, SHA-256 and one download per operating system
  - **Partly done** (2026-10-29, TanNB): `ui-design/3-5-fieldstationspage.md` filled in, with its wireframe `3-5-fieldstationspage.svg`. Open: the page, its tests and the review
  - **Done** (2026-10-30, KhoaDD under D-078): `FieldStationsPage` at `/o/field-stations` against `ui-design/3-5-fieldstationspage.md`, on organizations 23 to 26 from #134: the release card with one download per file, the station table with health and `outdated`, "n of limit" with Create disabled at the limit, the credential shown once in its dialog (never in the query cache), and revoke with the reason hint of the 2026-10-30 ruling (optional for a Manager, required for Staff and Admin). `src/entities/organization/fieldStations.ts`, `src/pages/FieldStationsPage.tsx` and its tests; route in `app/router.tsx`, `built: true` in `shared/config/navigation.ts`. Covers MF-01 step 7. Open: TanNB's review
  - _Story: US-UC06, US-UC42_
- [ ] 3.6 `ComplianceCasePage` and channel key rotation (owner TanNB)
  - **Do**: organizations api-design 27 to 31; open a case, record actions (suspend for Admin only), close with outcome and authority reference (required for fraud and theft); rotate key on the organization page clears the exposed flag
  - **Partly done** (2026-10-29, TanNB): `ui-design/3-6-compliancecasepage-and-channel-key-rotation.md` filled in, with its wireframe `3-6-compliancecasepage-and-channel-key-rotation.svg`. Open: the page, the key rotation section, their tests and the review
  - **Partly done** (2026-10-30, KhoaDD under D-078): `ComplianceCasesPage` (`/t/compliance-cases`, status tabs, Open case) and `ComplianceCasePage` (`/t/compliance-cases/:id`, record action with the Field Station or API key target, Suspend disabled for Staff, Close case with the police reference for fraud and theft), and `widgets/ChannelKeySection` in the organization panel of `/t/organizations` (Record key rotation, `STALE_VERSION` with Reload). `src/entities/organization/complianceCases.ts` and `complianceCaseUi.tsx`, tests beside each page and the widget. Leader rulings 2026-10-30: Admin may record a key rotation (open point 3); loss case linking stays refused for the demo (open point 5). Open: the linked contract and loss case pickers, TanNB's review
  - _Story: US-UC63_

## Phase 4: Fleet

- [ ] 4.1 Hardware variants admin (owner KhoaDD)
  - **Do**: devices api-design 01 to 04; service interval with checklist, firmware baseline, depreciation schedule
  - _Story: US-UC13_
- [x] 4.2 Fleet table, register, intake, `DeviceDetailPage` (owner KhoaDD)
  - **Do**: devices api-design 05 to 10, 16, 23 and monitoring api-design 07; register, intake check (motion field only for motion variants), reset, retire, dispose with the three wipe steps
  - _Story: US-UC11, US-UC12, US-UC44, US-UC53, US-UC62_
  - **Progress** (2026-10-30, D-078 chain 3): `FleetPage` (register) and `DeviceDetailPage` (firmware edit, intake check, reset, retire, dispose dialogs, lifecycle history) built against devices api-design 05 to 09 and monitoring api-design 07, all served. The retire and dispose dialogs call `POST /devices/:id/retire` and `POST /devices/:id/dispose` (`entities/device/api.ts`), served since 2026-10-30 (devices tasks 2.4 and 2.7); the dispose dialog sends the wipe steps as ticked. Open: nothing for this task's declared scope.
  - **Done** (2026-10-30, KhoaDD under D-078): `/t/fleet` rebuilt on `DataTable`, `Toolbar` and `PageHeader`: status chips (multi-select, kept in the address as `?status=`, unknown values dropped) each with its count from devices api-design 06 `totalCount` (one cached request per chip, `useDeviceStatusCounts`), variant and search filters, Clear filters, server paging, a card per device below 768 px (asset tag, status, battery, last seen), "No devices registered yet." with Register device and MSG01 with filters; after register the new device's page opens for the intake check. Component-tested (8). Not walked in a browser in this session. The Report lost link waits on 4.4.
- [x] 4.3 `MaintenancePage` and `MaintenanceApprovalPage` (owner KhoaDD)
  - **Do**: devices api-design 11 to 15; the week's service list; estimate; completion with resolution, cost, checklist results and firmware version; Admin decision (hidden for the estimator, 403 shown if forced)
  - _Story: US-UC52, US-UC64, US-UC65_
  - **Progress** (2026-10-30, D-078 chain 3): `MaintenancePage` serves both `/t/maintenance` (records, this week's service, open preselected from the device detail) and `/t/maintenance/approvals` (Admin decision, hidden on a record the viewer estimated, MSG26 for Staff) against devices api-design 11 to 15, all served by `maintenance.controller.ts`. Open: nothing for this task's declared scope.
  - **Done** (2026-10-30, KhoaDD under D-078): records with status and reason filters, paging and cards below 768 px; labelled reasons and statuses; the record detail in a drawer (description, work by, estimate, decision, actual cost, warranty, firmware, checklist results, resolution) with Estimate and Complete on an `OPEN` record; Open maintenance as the page's primary action with a picker of `AVAILABLE` devices; the unrepairable confirmation; MSG36 with Reload on `STALE_VERSION` (the form keeps its values) and MSG29 on `MAINTENANCE_OPEN`; after completion a notice that the device stays `MAINTENANCE` until it passes an intake check, with a link to it; the week's service with "Due but still out" (devices api-design 06 `RESERVED` and `RENTED`, first 100, narrowed on `serviceDueAt` in the page because 06 has no due-date filter); mutations invalidate `['maintenance']`, `['devices']`, `['device', id]` and `['device-history', id]`. Component-tested (16). Leader rulings (2026-10-30): the estimate hint names the amount from devices api-design 15 `approvalThresholdVnd`, which the list now carries; api-design 15 now says `dueBefore` filters records on `expectedAt` only, and the due units still out keep coming from devices api-design 06; the device detail names the open record by its readable status. Component-tested (18 on this page). Not walked in a browser in this session.
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
  - **2026-10-30**: `LiveProvider` refreshes active contract details for device label, handover and release entries from other sessions, and contract lists, balances and transitions for handover or release. An expired replay refreshes these reads too; position updates do not refetch them. Contract and payment status pushes are still outside the existing stream contract
  - **Partly done** (2026-10-27): `/o/contracts` (status and plan filters, cards below 768 px) and the detail at `/o/contracts/:id` and `/t/contracts/:id` with prices, terms, devices, balance (billing 10), history (rentals 18) and Cancel with its reason dialog, STALE_VERSION reload and MSG15. Give notice (12, MSG18) and the holder label dialog with Clear label (13, MSG03) followed on 2026-10-27. The handover note download (11) followed with 5.4 on 2026-10-27, for the Org Manager and Staff, with a warning when the stored note no longer matches its hash or is missing; Staff open the counter from an approved contract. Open: Lost on a device row (screen 4.4)
- [x] 5.3 `ContractApprovalPage` (owner LongLP)
  - **Do**: rentals api-design 04 and 05; availability from devices api-design 24; MSG11 on shortfall
  - _Story: US-UC16, US-UC17_
  - **Partly done** (2026-10-27): `/t/contracts` with the Requested, Approved and All tabs as a table (cards below 768 px), the request panel with the handover appointment, Approve (reserved tags and expiry shown), Reject with its reason dialog, MSG11 and STALE_VERSION. The advisory availability banner (devices api-design 24) followed on 2026-10-27: amber with the count when fewer units than requested are available
- [x] 5.4 `CounterPage` handover (owner LongLP)
  - **Do**: rentals api-design 07 to 10 in four steps (design §5): devices with scan, provisioning, battery and GPS check and swap; payment status; preview note; signature pad (PNG) and identity field; nothing stored in the browser after submit
  - **Partly done** (2026-10-27): `/t/counter/:contractId` for Staff in four steps. Devices: the scan field (MSG12 for a tag of another contract), Record provisioning with the key version from organizations 03, battery and GPS per unit, Swap with its reason dialog (MSG11 when no spare unit exists); Next is held until each unit is provisioned in this visit, read and has a fix. Payment: the first invoice's first line, its payments and the link to the counter payment of 6.3 (MSG23). Preview: the unsigned PDF in a frame. Sign: active Managers only (organizations 12), the identity field and the signature pad; LOW_BATTERY shows MSG19 with Proceed anyway, and FIRST_PAYMENT_MISSING, DEVICE_NOT_PROVISIONED and DEVICE_CHECK_FAILED return to their step with the named rows marked. MSG06 and the issued count on success; the signature, identity text and preview are dropped. Component-tested (5 tests). Open: a walk through the screen in a browser, which needs a member to sign in, and provisioning state survives only the visit (a reload asks to record it again; the server keeps the records)
  - _Story: US-UC14, US-UC20, US-UC21_
  - **Done** (2026-10-30, LongLP): both open points are closed. The browser walk was done in the demo smoke of `docs/sessions/2026-10-30-1830-demo-smoke.md` (counter handover with signature, Playwright Chromium on `vite preview`). Provisioning now survives a reload: rentals api-design 03 answers `devices[].provisionedKeyVersion`, the key version each unit carries for the contract's organization (`ContractReadsService.detail` through `DevicesService.provisioning`), and the page takes this visit's recording first and the server's otherwise; a `DEVICE_NOT_PROVISIONED` refusal reloads the contract instead of trusting the cache. Unit-tested (the reads service drops a key of another organization; the controller answers the field) and component-tested (a reload shows "Provisioned v1" with nothing recorded)
- [x] 5.5 Check-in, inspection, replacement, close (owner LongLP)
  - **Do**: rentals api-design 14 to 17; check-in by scan (MSG07); inspection with damage codes; replacement of a faulty or lost unit with a signed note; close with MSG29 on open incidents
  - **Partly done** (2026-10-28): `/t/counter/:contractId` past the handover shows `ReturnCounter`, built on the `shared/ui` components: tabs for check-in (scan list, MSG12 for a tag of another contract, MSG07 with the late fee, the REQ-STA-01 rule), reset and inspection (`DataTable` of returned devices, Record reset with the three steps, Inspect with Passed, Damaged and Failed and damage codes, the result and damage charge per row) and close (balance, `ConfirmDialog` naming the contract, MSG29 for open balances or incidents, STALE_VERSION refetch). The contract page offers Open the counter in every state the counter serves. Component-tested (3 tests). Replacement tab (2026-10-28, rentals 4.3): on an `ACTIVE` or `ENDING` contract, the unit going out, whether it is here, the replacement's tag looked up through devices api-design 06, the organization's key version and the Manager's signature; component-tested (3). Open: the reset and inspection state survives only the visit. 2026-10-30: the damage codes are a checkbox list from billing api-design 05 for the contract's variant, one row per active code with its label and amount, the variant's own rate replacing the generic one; Damaged needs at least one, and `UNKNOWN_DAMAGE_CODE` shows the server's message and reloads the list; only codes still offered are sent, so a code deactivated meanwhile cannot block the retry. Component-tested.
  - _Story: US-UC43, US-UC44, US-UC51, US-UC61_
  - **Done** (2026-10-30, LongLP, verified on `dev`): the open point closed with KhoaDD's `0747668` (from #164): the counter reads the reset and inspection of each returned row from rentals api-design 03 (`devices[].resetAt`, `devices[].inspection`), so a reload keeps them, and a second reset is 409 `ALREADY_RESET`. The return counter was walked in a browser in the demo smoke of `docs/sessions/2026-10-30-1830-demo-smoke.md` (check-in, reset, inspection, counter payment, close)
- [x] 5.6 Organization home dashboard `/o` (owner LongLP)
  - **Do**: Sprint 4. The Org Manager's landing page (D-059 rule 1): contract summary from rentals api-design 02, balance due from billing api-design 10, open incidents from incidents api-design 01 (`open=true`), devices out; widgets `ContractSummary`, `InvoiceTable`, `IncidentQueue` of §1; screen design first (`ui-design/5-6-*.md`)
  - **Partly done** (2026-10-28): `/o` on the `shared/ui` components, the Org Manager's landing route, Overview built in `navigation.ts`. Tiles inside router links (the `href` of `StatCard` is a plain anchor, which reloads the page and drops the in-memory session): running contracts with the requested and approved counts, devices out on the first five running contracts, return due or overdue, and what contracts still owe with their overdue invoices; invoices to pay, overdue first; the three nearest dates; MSG28 when the organization is not `ACTIVE`; loading and errors per source. Still due nets each contract's invoices, CLOSING included, as the ruling on treklink-web#87 point 4 asks. Component-tested (5, with the landing route); walked in the browser on local PGlite. 2026-10-29 (review of #109): each list is read as one page of `MAX_PAGE_SIZE` (100), a second page shows the "Counted on the first 100" banner, and a failed contract detail or overdue query shows its error with Try again instead of a lower count; tested (8). Open: live updates through the stream. 2026-10-30: the Open incidents widget reads incidents api-design 01 with `open=true` (code, asset tag, holder, state, first event; five rows linking to `/o/incidents/:id`, All incidents to `/o/incidents`), with its own loading, error with Try again and "No open incidents."; it is the `IncidentQueue` widget of design §1 (`widgets/IncidentQueue`). Component-tested.
  - **Done** (2026-10-30, LongLP): live updates through the stream. `LiveProvider` already refreshed the open incidents (`incident.changed`), the contracts and the devices out (`device.handedOver`, `device.released`, `device.label`); `device.released` and an expired replay now also refresh the invoice lists behind Still due and Invoices to pay, because a check-in past the grace adds a late fee. Tested in `LiveProvider.test.tsx` (released and replay refresh the invoices; a label or handover does not). A contract status change or a confirmed payment has no entry in the stream contract, so those figures refresh on the next visit, as `ui-design/5-6-*.md` now says
  - _Story: US-UC55_

## Phase 6: Billing

- [x] 6.1 `InvoicePage` and invoice list (owner LongLP)
  - **Do**: billing api-design 08, 09; lines with due dates and status
  - _Story: US-UC55_
  - **Done** (2026-10-27): `/o/invoices` and `/o/invoices/:id` for the Org Manager, the invoice tab of `/t/billing` with the detail in a side panel for Staff; status and overdue filters, a contract filter from the contract page link, the line table with the derived line status, payments with the SANDBOX label. Pay with SePay waits on 6.2
- [x] 6.2 SePay payment page (owner LongLP)
  - **Do**: billing api-design 11, 15; VietQR image labelled sandbox; poll the payment until `CONFIRMED` (MSG20) or `EXPIRED` (MSG25)
  - **Done** (2026-10-27): Pay with SePay on `/o/invoices/:id` for the Org Manager (PAYMENT_PENDING opens the waiting request, NOTHING_DUE shows the server's message) and `/o/pay/:paymentId`: the VietQR image with amount, transfer content, account and a countdown, the SANDBOX label, polling every 3 s until CONFIRMED (MSG20) or EXPIRED (MSG25), then the invoice and balance refetch. Rebuilt on 2026-10-28 with the `shared/ui` components: the countdown, MSG20 and MSG25 are `Alert`s, the QR and transfer details a `Card`, the wait a `Skeleton`; no navigation entry, since the page is reached from the invoice. When the QR service returns no image (the sandbox placeholders `SANDBOX-0001` and `SANDBOX` are not a readable account and bank), a warning `Alert` replaces it and the transfer details stay. Walked locally with the SePay test key: 401 without or with a wrong key, CONFIRMED with the right one, the same transfer again applied once
  - _Requirements: REQ-UBI-08, NFR-UI-03_
  - _Story: US-UC19_
- [x] 6.3 Counter payments (owner LongLP)
  - **Do**: billing api-design 13, 14; overpayment and duplicate reference errors
  - _Story: US-UC22_
  - **Done** (2026-10-27): the record dialog from the invoice detail (method, amount, reference; OVERPAYMENT under Amount, DUPLICATE_REFERENCE under Reference, MSG20 with the amount) and the payments tab of `/t/billing` with a status filter. 2026-10-28: Record counter payment on an invoice shows only while the contract balance (billing 10 `settled`) is open, per the ruling on issue #87 point 4; component-tested. The contract page and the counter header show the handover appointment from `handoverAppointmentAt`
- [x] 6.4 Prices, damage rates, `DamageChargesPage` (owner LongLP)
  - **Do**: billing api-design 03 to 07, 16, 17; decision hidden for the inspector (MSG30)
  - **Partly done** (2026-10-27): `/t/admin/prices` for TrekLink Admin, the price history with Current, Upcoming and Past labels and the Schedule price dialog (confirmation, EFFECTIVE_IN_PAST under Effective from), the damage rates with Add and Edit (deactivation asks first, CONFLICT_UNIQUE under Code). Rebuilt on 2026-10-28 with the `shared/ui` components: `DataTable` with `StatusBadge` for both lists, a `Toolbar` of filters above each (variant and state for prices, text and active for rates), `Dialog` with `Field` and `Input`, and a `ConfirmDialog` naming the price or the rate; the entry sits under Administration in `navigation.ts`. 2026-10-29 (review of #91): the price state (Current, Upcoming, Past) comes from billing api-design 03 `state`, judged against the whole schedule, so an older page never shows a second Current. `/t/damage-charges` and the decision dialog followed on 2026-10-30, below
  - _Story: US-UC48, US-UC56_

  - **Done 2026-10-30 (UC-48)**: `/t/damage-charges` (`DamageChargesPage`) lists billing api-design 16, opening on `PENDING_APPROVAL`, with a status filter; Staff read it. An Admin decides a pending charge through the decision dialog (Approve, Reduce with a final amount below the charge, Waive after a confirmation naming the amount and the device) with a required reason (billing 17); on a charge the Admin inspected the row shows "Another Admin must decide" instead (BR-24, MSG30 only for a forced request). A decision refetches the queue and the contract balance. The navigation entry is built. Component-tested (5)
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
  - **Note**: `/o/incidents` and `/o/incidents/:id` are built in the MF-03 PR (2026-10-29) over api-design 01 to 07, with the state-and-viewer action table of screen 8.1. The false alarm uses an inline confirming form rather than a dialog. `src/pages/incident-pages.test.tsx` covers the queue, the detail, every action form and the MSG26, MSG27, MSG28 and MSG36 paths. The History panel (api-design 12) and the Org Manager's Alert deliveries panel with its Refresh (api-design 14) are built in TK-145 (2026-10-30) as `widgets/IncidentHistory`; an Operator never requests the alert log. Each panel fails alone: 403 hides it, 404 refetches the incident, any other error offers a retry. The panel keys sit under `['incident', id]`, so `incident.changed` refreshes them. Open: the events panel (api-design 13, waits for R2 in treklink-web#118), the device and created-from filters, and the dirty-form guard
  - _Requirements: REQ-UBI-03, REQ-UBI-07, REQ-UBI-09, AC-02_
  - _Story: US-UC32, US-UC33, US-UC34_
- [ ] 8.2 `StaffIncidentsPage` (owner HoangTK)
  - **Do**: unrouted and escalated queue; false alarm from `UNROUTED`
  - **Note**: 2026-10-30 (D-078 chain 4, KhoaDD): `/t/incidents` serves the queue (Unrouted and escalated, Unrouted, Escalated, All incidents) with read-only inline detail from api-design 01 and 02, and the alert banner gives TrekLink accounts an Open queue link instead of Acknowledge. Open: false alarm from `UNROUTED` (needs the Staff permission row, incidents 4.2), the history, episode and delivery panels (api-design 12 to 14, HoangTK's PR #121), filters by device and date, and the Authority reports tab (8.3). The box stays open
  - _Story: US-UC29, US-UC31_
- [x] 8.3 Authority reports (owner HoangTK)
  - **Do**: incidents api-design 08 to 11; report on an incident or a defaulted contract; close the case
  - **Note**: built 2026-10-30 (KhoaDD under D-078) over the TK-148 backend as `widgets/AuthorityReports` with hooks in `entities/incident/authorityReports.ts`. `/t/incidents` has an Incident queue tab and an Authority reports tab: Open cases only (default, `open=true`; unchecked omits `open`, because `open=false` reads closed cases only), Refresh, server order and pager, Open or Closed from `caseClosedAt`, View incident (back to the queue tab with the incident selected) or View contract, and Record case closed in a `Dialog`. Below the sm breakpoint each row is a labelled card (checked at 360 px, no page-level horizontal scroll). Record report has the subject step (incident `UNROUTED` or `ESCALATED`, or a `DEFAULTED` contract, rechecked by a detail read) and the details step; the selected incident's detail offers Report to authorities, which skips the subject step. Agency and reference take at most 200 characters; Closed at states the server's bounds (not in the future, not before the report time) and shows a refused time under the field. MSG03, MSG28, MSG36 with Reload that keeps the values, a discard check on a dirty draft. `incident.changed` also invalidates `['authority-reports']`. Tests: `widgets/AuthorityReports/AuthorityReports.test.tsx` and `pages/StaffIncidentsPage.test.tsx`. Not built: the entry from `/t/contracts/:id` (task 5.2 owns that page)
  - _Story: US-UC35, US-UC37_

## Phase 9: Monitoring

- [ ] 9.1 `LiveMapPage` for organizations and the fleet (owner LongNN)
  - **Do**: monitoring api-design 01 and 02 then stream entries in `seq` order, ignoring entries at or below the snapshot cursor; stale markers with last-seen time; pulsing incident markers; late entries kept off the live map
  - _Story: US-UC38, US-UC41_
  - **Status** (2026-10-30, D-078 takeover, KhoaDD): `LiveMapPage` serves `/o/map` and `/t/map`. Snapshot, then the stream reducer (`entities/live-map/model.ts`, cursor filter, late entries skipped, `device.handedOver` reloads the snapshot), stale state from `staleAfterSeconds`, SOS marker and incident badge, side list with search and centring, the fleet organization filter, MSG32, MSG26, a 400 that offers the whole fleet back. The snapshot now carries real `fieldStations` (MF-02 hook), but the page does not render the Field Station list yet. Open: the Field Station side panel, the 360 px bottom sheet, the popup links (the popup lists text; "Open incident" is in the side list on `/o/map`, screen 8.2 and 9.2 routes are not built), and keyboard focus moving into a popup. The interim dashboard at `/` now redirects to the landing route. The box stays open.
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
