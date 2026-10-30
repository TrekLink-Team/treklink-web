# `OrganizationReviewPage` for Staff and Admin (`/t/organizations`)

| | |
|---|---|
| Owner | LongLP (reassigned from TanNB 2026-10-27, issue #98) |
| Task | `specs/frontend/tasks.md` 3.2 |
| Assigned, due | 2026-10-21, 2026-10-23 |
| Status | Built: the queue, verification, approve and reject, and (2026-10-30) suspend, reactivate, close and the status history |
| Routes | `/t/organizations`, the queue with the selected organization in a side panel (beside the table from 1280 px, under it below) (`specs/frontend/design.md` §2). The sidebar entry sits under Organizations and compliance. `/t/organizations/:id` is not built. |
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
| Panel: Status history (not for `PENDING`), one line per change: from and to status, time, actor and reason | organizations 11 `fromStatus`, `toStatus`, `createdAt`, `actor` (a name, or `SYSTEM`), `reason` |

The panel reads the selected row of the list; organizations 03 (the detail) is not called yet.

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
