# `OrganizationReviewPage` for Staff and Admin (`/t/organizations`)

| | |
|---|---|
| Owner | LongLP (reassigned from TanNB 2026-10-27, issue #98) |
| Task | `specs/frontend/tasks.md` 3.2 |
| Assigned, due | 2026-10-21, 2026-10-23 |
| Status | Built: the queue, verification, approve and reject, and (2026-10-30) suspend, reactivate, close and the status history |
| Routes | `/t/organizations`, the queue with the selected organization in a side panel (beside the table from 1280 px, under it below) (`specs/frontend/design.md` §2). The sidebar entry sits under Organizations and compliance. `/t/organizations/:id` is the organization's own page (2026-11-05, TanNB, TK-190): the record, the counter verification, the status history and, read only, the permissions of its two roles; the panel of the queue links to it with "Open the full page". It changes nothing; every action stays on the queue. |
| Roles | TrekLink Staff: the queue and the counter verification. TrekLink Admin: the same, plus Approve and Reject. Organization accounts: MSG26 (TrekLink route). |
| Use case, FRs, story | UC-02, UC-03; FR-ORG-02, FR-ORG-03; US-UC02, US-UC03, US-UC07 |
| Requirements | `specs/organizations/requirements.md` REQ-UBI-01, REQ-EVT-02, REQ-EVT-03, REQ-ERR-02, REQ-ERR-07 |
| Wireframe | None drawn. The built screen was walked in a browser on local PGlite on 2026-10-28: ORG-0002 verified and approved by the Admin. |

Scope from the task: organizations api-design 02, 03, 05 to 11; verification form with method, documents, master contract reference and the NDA and software licence checkboxes (both required); approve or reject (MSG16, MSG21); suspend, reactivate, close

## Data

| Shown | Source (api-design file, property) |
|---|---|
| Tabs Pending, Active, Suspended, Rejected, All | organizations 02 with `status=PENDING`, `ACTIVE`, `SUSPENDED`, `REJECTED`, and without a status |
| Queue: code, organization, registered, verified, status | organizations 02 `items[].code`, `legalName`, `createdAt`, `verifiedAt`, `status` |
| Panel: name, status, code, tax code, address, contact | organizations 02 `items[].legalName`, `status`, `code`, `taxCode`, `address`, `contactEmail`, `contactPhone` |
| Panel: verification time, method and master contract | organizations 02 `items[].verifiedAt`, `verificationMethod`, `masterContractRef` |
| Panel: rejection reason | organizations 02 `items[].rejectionReason` |
| Panel: Status history (not for `PENDING`), one line per change: from and to status, time, actor and reason | organizations 11 `fromStatus`, `toStatus`, `createdAt`, `actor` (a name, or `SYSTEM`), `reason`. api-design 11 returns no row id, so a row is keyed by its time and target status (review of #156) |

The panel reads the selected row of the list; organizations 03 (the detail) is not called yet.

## Organization page (`/t/organizations/:id`, 2026-11-05)

| Shown | Source (api-design file, property) |
|---|---|
| Title, code, status badge, time of the last status change | organizations 03 `legalName`, `code`, `status`, `statusChangedAt` |
| Record: tax code, address, contact email and phone, members, running contracts, open incidents, channel key version | organizations 03 `taxCode`, `address`, `contactEmail`, `contactPhone`, `counts`, `channelKeyVersion` |
| Counter verification: time, verifier, method, master contract, documents seen; "Not verified at the counter yet." when absent | organizations 03 `verifiedAt`, `verification` |
| Status history, one line per change ("No status change yet." when empty) | organizations 11 |
| Roles and permissions, read only: the grid of screen 3.7 with every cell disabled, no toolbar, no reset | organizations 33 |

States: skeletons while loading; MSG26 with a link back to the queue for a 403 or 404 on the record; an error with Try again for the roles alone, which leaves the record on screen. Below 768 px the roles show one at a time from a select, as on 3.7, because the grid leaves no room for a role column at 360 px. The way back to the queue is a 24 px target (WCAG 2.5.8). The page is a fit page (chapter 06 §11.1, ui standard §7): the header stays, and the body (record, verification, history, roles) is the one focusable scroll region labelled "Organization details", so `#main` does not scroll (review of treklink-web#389).

## Actions

| Control | Endpoint | Confirmation | Success message |
|---|---|---|---|
| Record verification, Update verification (Staff, Admin; `PENDING` only) | organizations 05 `POST /api/organizations/:id/verification` with `expectedVersion` | none | toast "Saved." and the queue refetches |
| Approve (Admin; `PENDING`; held until verified) | organizations 06 `POST /api/organizations/:id/approve` | none | toast "{code} approved. The Manager can now request devices." |
| Reject (Admin; `PENDING`) | organizations 07 `POST /api/organizations/:id/reject` with the reason | the reject Dialog naming the organization, reason required | toast with MSG16 and the reason |
| Suspend (Admin; `ACTIVE`) | organizations 08 `POST /api/organizations/:id/suspend` with the reason and `expectedVersion` | Dialog naming the organization and what suspension keeps running, reason required | toast "{code} suspended." and the queue and history refetch |
| Close organization (Admin; `ACTIVE`) | organizations 10 `POST /api/organizations/:id/close` with the reason and `expectedVersion` | Dialog naming the organization and that members, API keys and stations are revoked, reason required | toast "{code} closed." |
| Reactivate (Admin; `SUSPENDED`) | organizations 09 `POST /api/organizations/:id/reactivate` with `expectedVersion` | none | toast "{code} reactivated." |

## States

| State | What the user sees |
|---|---|
| Loading | three skeleton rows |
| Empty | "No organizations here." in an empty-state card |
| No filter match | the in-table no-match row with Clear |
| Not verified (Admin) | warning Alert "Verify this organization at the counter before approving it." and Approve disabled (MSG21) |
| Error `NOT_VERIFIED` | MSG21, the server's message, as an error Alert under Decision |
| Error `CONTRACT_TERMS_MISSING` | checked first on the page: "The master contract must include the signed NDA and the software licence." |
| Error `STALE_VERSION` | the server's message as an error Alert; the queue refetches |
| Error `INVALID_STATE_TRANSITION` | the server's message as an error Alert |
| Error `OPEN_CONTRACTS` (close) | the server's message under the reason; the dialog stays open |
| Error `BALANCE_OUTSTANDING` (reactivate) | the server's message as an error Alert under Status |
| Not found or forbidden | MSG26 |

## Form fields (if any)

| Step | Field | Type | Required | Rule |
|---|---|---|---|---|
| Verification | Method | radio, In person or By phone | yes | defaults to In person |
| Verification | Documents seen | checkboxes: Business registration, Manager ID card, Tour operator licence | at least one | |
| Verification | Master contract number | text | yes | trimmed |
| Verification | The master contract includes the signed NDA | checkbox | yes | must be ticked (BR-43) |
| Verification | The master contract includes the Field Station software licence | checkbox | yes | must be ticked (BR-43) |
| Reject | Reason shown to the Manager | textarea | yes | trimmed, shown to the Manager (MSG16) |

## Mobile, accessibility, live data

- 360 px layout: the table scrolls inside its box; the panel sits under it; the panel buttons stack.
- Tab order and focus after each action: tabs (arrow keys move between them), the filter row, the code buttons of the rows, then the panel. The reject Dialog traps focus and returns it on close. Toasts and Alerts are announced.
- WebSocket events and invalidated query keys: no stream; every action invalidates `organizationKeys.all`.

## Checklist

Chapter 06 §7 (Screen Design Checklist) and §8 (UI and UX practices), ticked by the owner before review.

- [x] Built on the `shared/ui` components (PageHeader, Tabs, StatusBadge with `ORGANIZATION_STATUS`, Card, RadioGroup, Checkbox, Field, Input, Textarea, Dialog, Alert, Button), token classes only
- [x] Filters inside the table, as on every list table
- [x] Component-tested: Approve held until verified, both contract terms required, Approve offered once verified (`OnboardingPages.test.tsx`)
- [x] Suspend, reactivate and close (organizations 08 to 11), component-tested in `OnboardingPages.test.tsx`

## Shared table and row menu (W29, 2026-11-01)

Added by KhoaDD under D-078 to apply `0-ui-standard.md` §2 and §3. Where this section and the
tables above disagree, this section wins.

- The list is the shared `DataTable`; a row opens its detail pane through the code button (Enter
  works) or a click on the row. The column filter row moved to the toolbar: one search over code,
  legal name and tax code, and a Verified select.
- Admin: a `StateChangeMenu` "Change status of {code}" per row, listing only the lifecycle's next
  statuses (organizations design §2): `PENDING`, Approve organization (only once verified, MSG21) and
  Reject organization; `ACTIVE`, Suspend organization and Close organization; `SUSPENDED`, Reactivate
  organization; `REJECTED` and `CLOSED`, no menu. Reject, suspend and close are alert dialogs with the
  required reason shown to the Manager; every call sends the row's `expectedVersion`. The detail pane's
  action bar stays as a second path.
- Counter verification: shown to whoever holds `organization.verify`, that is TrekLink Staff and,
  through inheritance, Admin. The audit of 2026-11-01 read the form as Admin-only; the code already
  rendered it for Staff (only the Decision block is Admin-only), and a test now holds it.
- No bulk: each decision needs its own verification or reason. The API does not sort.

## Organization list on CollectionView (D-096, 2026-11-04)

Added by KhoaDD. The list under the status tabs renders through `CollectionView` (chapter 06 §9): the
search reads code, name and tax code, the verified select becomes its Show filter, and an Admin's
Approve, Reject, Suspend, Close and Reactivate are in the Change status menu behind the same dialogs. The
code and Show details open the organization card beside the list (verification, channel key, decision),
this screen's record view in place of the built-in pane. A tab change clears the selection. Endpoints
and messages are unchanged.
