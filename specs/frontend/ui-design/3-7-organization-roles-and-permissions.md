# Roles and permissions of the organization (`/o/roles`)

| | |
|---|---|
| Owner | TanNB (RBAC framework, D-095, treklink-web#304 part 2) |
| Task | `specs/frontend/tasks.md` 3.7 |
| Assigned, due | 2026-11-02, 2026-11-07 (spec); built in W10 after the leader's ruling |
| Status | Proposal, specification only. Nothing is built until the leader rules on `specs/auth/design.md` section 9.7. |
| Routes | `/o/roles` (`specs/frontend/design.md` §2) |
| Roles | Org Manager: view and edit. Org Operator: no access (MSG26). TrekLink Staff and Admin: read-only view of one organization, see the last section. |
| Use case, FRs, story | UC-10; FR-AUTH-06, FR-AUTH-10, FR-ORG-04 (a new FR is an open point, `specs/auth/requirements.md` OQ-04); US-UC10 |
| Requirements | `specs/auth/requirements.md` REQ-UBI-10 to REQ-UBI-12, REQ-EVT-10, REQ-EVT-11, REQ-STA-04, REQ-ERR-10 to REQ-ERR-12; `specs/organizations/requirements.md` REQ-STA-03 |
| Wireframe | ![Roles and permissions of the organization](3-7-organization-roles-and-permissions.svg) |
| UI standard | `0-ui-standard.md` (WCAG 2.2 AA, dark mode, shared primitives) |

Scope from the task: auth api-design 19 and 20. The screen is the grid of screen 7.2 (`RoleGrid`, `cellOf`, the draft helpers of `entities/role/model.ts`) fed with the roles of one organization. Nothing about the grid itself is redefined here; this file states what differs.

## Layout

One matrix: the permissions of the ceiling are the rows, grouped by `subject`; the two columns are `ORG_MANAGER` and `ORG_OPERATOR`; each cell is one checkbox. Above the grid, a toolbar with the change summary, Discard draft and Save permissions, as on 7.2. Each column header carries a "Reset to TrekLink default" control that sets the draft of that role to its baseline.

## Data

| Shown | Source (api-design file, property) |
|---|---|
| Column header per role: role key, "Organization", "System role", count of effective permissions | auth 19 `roles[].key`, `roles[].effectiveKeys.length` |
| Rows: every permission inside the ceiling, key, description, grouped by `subject`, alphabetical | auth 19 `catalog[].key`, `description`, `subject` |
| Cell ticked when the effective set of the role, or its draft, holds the key | auth 19 `roles[].effectiveKeys` |
| Scope text "Own organization only" when `scope` is `own` | auth 19 `catalog[].scope` |
| Inherited cell: on `ORG_MANAGER` a permission that the TrekLink baseline of `ORG_OPERATOR` holds, ticked, read-only, "From ORG_OPERATOR"; it does not change with the Operator's draft (auth REQ-UBI-10, AC-10) | auth 19 `roles[]` of `ORG_OPERATOR`, `baselineKeys` |
| Locked cell: a `protected` permission on `ORG_MANAGER` is ticked, read-only, "Required for Manager" | auth 19 `catalog[].protected` |
| Not available: a `protected` permission on `ORG_OPERATOR` has no box (it cannot be granted below the Manager, auth REQ-UBI-11) | auth 19 `catalog[].protected` |
| Customised mark: a cell whose saved value differs from the baseline carries the word "Customised" | auth 19 `roles[].baselineKeys` against `effectiveKeys` |
| Changed mark: a cell whose draft differs from the saved value carries the mark and the word "Changed" of 7.2 | the draft against `effectiveKeys` |
| Change summary: "3 changes in 2 roles", or "No changes", in a status region | the draft |
| Status banner when the organization is `PENDING` or `SUSPENDED`: "Role permissions can be read but not changed while your organization is {state}." All cells disabled, Save and Reset hidden | the organization status from `GET /api/auth/me` (auth 04) |

## Actions

| Control | Endpoint | Confirmation | Success message |
|---|---|---|---|
| Page load | auth 19 `GET /api/organization/roles`, once | none | none |
| Cell checkbox | none until saved; local draft per role | Leaving with a dirty draft asks the browser (`beforeunload`) | none |
| Reset to TrekLink default | none; sets the draft of that role to its `baselineKeys` | none | none |
| Save permissions (primary, top right) | auth 20 `PUT /api/organization/roles/:roleKey/permissions` once per changed role, in column order, each with the full `permissionKeys` list and the `version` read with that role as `expectedVersion` | Dialog titled with the count ("Change 2 roles?", or "Change ORG_OPERATOR: remove 1, add 2?"), the permissions granted and revoked per role, and the text "Holders are affected on their next request." | MSG03 toast "Permissions updated" |
| Discard draft | none | none | none |

Save is disabled while no cell differs from the saved set. A failure of one role does not stop the next, as on 7.2.

## States

| State | What the user sees |
|---|---|
| Loading | Skeleton in place of the grid |
| Error `VALIDATION_FAILED` (400) | Banner naming the role and the server message; that role's draft kept |
| Error `UNKNOWN_PERMISSION` (400) | Banner with the server message; the page reloads auth 19 because the catalog changed; the key leaves the draft |
| Error `PERMISSION_OUT_OF_CEILING` (400) | Banner with the role and the server message; the page reloads auth 19 because the ceiling changed under the client. The unavailable cells make it unreachable, so this is the backstop |
| Error `MANAGER_LOCKOUT` (409) | Dialog with the server message "Managers must keep the right to manage roles." The cell is locked, so this dialog is the backstop |
| Error `ORGANIZATION_NOT_ACTIVE` (409) | Banner with the organization's state; the page reloads and turns read-only |
| Error `STALE_VERSION` (409) | MSG36 dialog with Reload; Reload loads auth 19 again and keeps the draft of every cell that is still valid (D-057 rule 5) |
| Error `NOT_FOUND` (404) | Toast "Role not found." and the page reloads |
| Partial result | Roles that saved leave the draft and show their new set; roles that failed keep their draft; the toast names the roles saved and a banner lists each failure as "ROLE: message" |
| Error `UNAUTHENTICATED` (401) | One silent refresh, then `/sign-in` |
| Forbidden (403) | MSG26 full-page notice (an Org Operator, or a role whose permission was withdrawn while the page was open) |
| Success | MSG03 toast; the grid shows the saved sets; focus returns to the Save button, or to the page when every role saved and Save is disabled |

When a saved role is `ORG_MANAGER`, the signed-in Manager's own `['me']` is invalidated, because their permissions may have changed (REQ-EVT-10).

## Form fields (if any)

One step, no text fields. The control is a grid of checkboxes.

| Step | Field | Type | Required | Rule |
|---|---|---|---|---|
| 1 | One checkbox per role and permission inside the ceiling | checkbox, maps to `permissionKeys: string[]` of the role | yes (the array may be empty for `ORG_OPERATOR`, never for `ORG_MANAGER`) | Keys must exist in the catalog (`UNKNOWN_PERMISSION`) and lie inside the ceiling (`PERMISSION_OUT_OF_CEILING`); `organizationRole.manage.own` cannot be removed from `ORG_MANAGER` (`MANAGER_LOCKOUT`) |

## Mobile, accessibility, live data

- 768 px and wider: the grid of 7.2 in its own scroll box, with sticky header row and first column and scroll padding for both (2.4.11).
- Below 768 px: one role at a time from a select, with the same states and the shared draft, as on 7.2.
- A real `table` with a `caption` ("Permissions by role of your organization"), `th scope="col"` per role, `th scope="row"` per permission and `th scope="rowgroup"` per subject.
- Every checkbox is named "{permission key} for {role key}", plus "inherited from {role}" or "required for Manager", "own organization only", "customised" and "changed" where that applies. The name starts with the visible text (2.5.3). Each checkbox is a 44 px target (2.5.8).
- "Reset to TrekLink default" is a button inside the column header, named "Reset to TrekLink default for {role key}", so the name starts with the visible text (2.5.3).
- The change summary and the result of a save are announced from a status region that stays mounted (4.1.3).
- Both themes: semantic tokens only; the Customised and Changed marks meet 3:1 and 4.5:1 in Canopy and in Volt (`0-ui-standard.md` §5).
- WebSocket events: none on `/live`. A successful save invalidates `['organization-roles']`, and `['me']` when `ORG_MANAGER` was saved.

## Read-only view for TrekLink

TrekLink Staff and Admin read the roles of one organization on its detail page (`/t/organizations/:id`, screen 3.2) through `GET /api/organizations/:id/roles` (organizations api-design 33). The same grid renders with every cell disabled and no toolbar. Built on 2026-11-05 (TanNB, TK-190): `OrganizationRolesReadOnly` on `OrganizationDetailPage`, over the same `entities/organization-role` model. From 768 px the grid renders in its own scroll box. Below 768 px it shows one role at a time from a select, every box disabled, as on the editing page: at 360 px the sticky Permission column fills the 288 px box of the grid and no role cell would show (review of treklink-web#389).

## Checklist

Chapter 06 §7 (Screen Design Checklist) and §8 (UI and UX practices), ticked by the owner before review.

- [x] Route and roles match `design.md` §2 (after the route row of this change)
- [x] Data: every field names its source in auth api-design 19
- [x] Actions: endpoint, confirmation with diff per role, message for each control
- [x] States: one row per error code of auth 19 and 20, forbidden, partial result, success
- [x] Forms: 1 step, 1 control
- [x] Mobile: collapse rule stated
- [x] Accessibility: table semantics, cell names, sticky headers, status region
- [x] Live data: none, `['organization-roles']` and `['me']` invalidation stated
- [x] Traceability: UC-10, FR-AUTH-06, FR-AUTH-10, US-UC10
- [x] §8 items 1 to 8 applied
- [x] Wireframe checked by a member against the handbook gate (D-067), recorded in the body of treklink-web#310 (looked at by TanNB)
