# Roles and permissions (`/t/admin/roles`)

| | |
|---|---|
| Owner | TanNB (built by LongNN, handed over by the leader on 2026-11-02 with the RBAC framework, treklink-web#304) |
| Task | `specs/frontend/tasks.md` 7.2 |
| Assigned, due | 2026-10-21, 2026-10-23; grid rework assigned 2026-11-02, due 2026-11-05 |
| Status | Grid rework in progress |
| Routes | `/t/admin/roles` (`specs/frontend/design.md` §2) |
| Roles | TrekLink Admin: view and edit. TrekLink Staff and organization roles: no access (MSG26). |
| Use case, FRs, story | UC-10; FR-AUTH-06, FR-AUTH-10; US-UC10 |
| Requirements | `specs/auth/requirements.md` REQ-UBI-05, REQ-EVT-08 |
| Wireframe | ![Roles and permissions](7-2-roles-and-permissions.svg) |
| UI standard | `0-ui-standard.md` (WCAG 2.2 AA, dark mode, shared primitives) |

Scope from the task: auth api-design 15, 16 and 18. The per-organization grid of treklink-web#304 part 2 is
specified separately (`specs/auth`, `specs/organizations`) and reuses the grid component built here.

## Layout

One matrix replaces the role list and the one-role checklist. Permissions are the rows, grouped by `subject`;
every role is a column, in the order ADMIN, STAFF, ORG_MANAGER, ORG_OPERATOR; each cell is one checkbox.
The two platform roles and the two organization roles share the grid, so a permission is compared across roles
in one glance. Below 768 px the grid gives way to one role at a time (see Mobile).

## Data

| Shown | Source (api-design file, property) |
|---|---|
| Column header per role: role key, account type, "System role" tag, permission count | auth 15 `result[].key`, `accountType`, `isSystem`, `permissionKeys.length` |
| Row header per permission: key, then description | auth 18 `result[].key`, `description` |
| Group rows, one per `subject`, subjects and the permissions inside each in alphabetical order | auth 18 `result[].subject` |
| Cell state: ticked when the role's `permissionKeys` (auth 15) holds the key, or the draft does | auth 15 `result[].permissionKeys` |
| Cell for a permission of the other account type: no checkbox, the text "Not available" (a platform permission is never granted to an organization role, D-057 rule 2) | auth 18 `result[].accountType` against auth 15 `result[].accountType` |
| Scope text in a cell, "Own organization only" when `scope` is `own`; nothing for `any`. The raw CASL conditions are not returned and not shown | auth 18 `result[].scope` |
| Inherited cell: on ADMIN a permission that STAFF holds, on ORG_MANAGER one that ORG_OPERATOR holds, shown ticked and read-only with the text "From STAFF" or "From ORG_OPERATOR". It follows the draft of the lower role, so unticking the lower role frees the cell | rule in `specs/auth/requirements.md` REQ-UBI-05 and `INHERITED_ROLES` of the backend; the stored `permissionKeys` of the upper role are not changed by it |
| Locked cell: a `protected` permission on ADMIN is ticked, read-only, with the text "Required for Admin" | auth 18 `result[].protected` |
| Changed cell: a cell that differs from the saved set carries a visible mark and the words "Changed" for a screen reader, never colour alone | draft against auth 15 |
| Change summary beside the buttons: "3 changes in 2 roles", or "No changes", in a status region | the draft |

## Actions

| Control | Endpoint | Confirmation | Success message |
|---|---|---|---|
| Page load | auth 15 `GET /api/roles` and auth 18 `GET /api/permissions`, both loaded once | none | none |
| Cell checkbox | none until saved; local draft per role | Leaving with a dirty draft asks the browser (`beforeunload`) | none |
| Save permissions (primary, top right) | auth 16 `PUT /api/roles/:id/permissions` once per changed role, in sequence, each with the full `permissionKeys` list of that role. Unchanged roles are not written | Dialog titled with the count ("Change 2 roles?", or "Change ORG_OPERATOR: remove 1, add 2?" for one role) and, per role, the permissions granted and revoked. "Holders are affected on their next request." | MSG03 toast when every role saved |
| Discard draft | none | none | none |

Save is disabled while no cell differs from the saved set and shows its pending state at once (§8 item 5).
A failure of one role does not stop the next: every changed role is tried, and the result is reported per role
(States).

## States

| State | What the user sees |
|---|---|
| Loading | Skeleton in place of the grid |
| Empty | A role that holds nothing shows its column unticked; nothing else changes. MSG01 is not used: the grid is not a search result |
| Error `VALIDATION_FAILED` (400) | Banner naming the role and the server message; that role's draft kept |
| Error `UNKNOWN_PERMISSION` (400) | Banner with the role and the server message "Unknown permission: {key}."; the cells of that key are marked invalid and the page reloads `['roles']` and `['permissions']` because the catalog changed under the client |
| Error `PERMISSION_SCOPE_MISMATCH` (400) | Banner with the role and the server message. A "Not available" cell makes it unreachable, so this is the backstop and nothing else is done for it |
| Error `ADMIN_LOCKOUT` (409) | Dialog MSG38 "The Admin role must keep role management." The `role.manage` cell on ADMIN is locked, so this dialog is the backstop |
| Error `NOT_FOUND` (404) | Toast "Role not found." and the lists reload; the draft of that role is dropped |
| Partial result | Roles that saved leave the draft and show their new set; roles that failed keep their draft; the toast names the roles saved ("Permissions updated for ADMIN, STAFF") and the banner lists each failure as "ROLE: message" |
| Error `UNAUTHENTICATED` (401) | One silent refresh, then `/sign-in` |
| Not found or forbidden (403) | MSG26 full-page notice |
| Success | MSG03 toast; the grid shows the saved sets; focus returns to the Save button |

`STALE_VERSION` does not apply to this endpoint: auth api-design 16 carries no `expectedVersion` and the server
keeps the last write. Two Admins editing at once overwrite each other for a role. This is recorded as an open
point for the leader (treklink-web#304), not worked around in the client.

## Form fields (if any)

One step, no text fields. The control is a grid of checkboxes.

| Step | Field | Type | Required | Rule |
|---|---|---|---|---|
| 1 | One checkbox per role and permission of the same account type | checkbox, maps to `permissionKeys: string[]` of the role | yes (the array may be empty only for roles other than ADMIN) | Keys must exist in the catalog (`UNKNOWN_PERMISSION`) and match the role's account type (`PERMISSION_SCOPE_MISMATCH`); a `protected` permission such as `role.manage` cannot be removed from ADMIN (`ADMIN_LOCKOUT`) |

## Mobile, accessibility, live data

- 768 px and wider: the grid, inside its own scroll box (`0-ui-standard.md` §1, 1.4.10). The header row and the
  first column are sticky, so the role and the permission stay visible while the other axis scrolls.
- Below 768 px: not an operator screen. A role select at the top, and the permissions of that role as one
  checkbox per row under it, grouped by `subject`, with the same states (locked, inherited, scope text). A
  draft is shared with the grid, so resizing loses nothing. Changing the role keeps the draft.
- A real `table` with a `caption` ("Permissions by role"), `th scope="col"` per role, `th scope="row"` per
  permission and `th scope="rowgroup"` per subject.
- Every checkbox is named "{permission key} for {role key}", plus "inherited from {role}" or "required for
  Admin" where that applies. The name starts with the visible text (WCAG 2.5.3). Each checkbox is a 44 px
  target (2.5.8) and takes the shared focus ring (2.4.7). Tab moves through the cells; Space toggles. A
  focused cell is scrolled clear of the sticky header and first column (2.4.11).
- The change summary and the result of a save are announced from a status region that stays mounted (4.1.3).
- Both themes: semantic tokens only, the changed mark and the locked and inherited text meet 3:1 and 4.5:1 in
  Canopy and in Volt (`0-ui-standard.md` §5).
- WebSocket events and invalidated query keys: none on `/live`. A successful save invalidates `['roles']`
  (`['permissions']` is static for the session). Because a role change applies "on the next request"
  (REQ-EVT-08), the signed-in Admin's own `['me']` is also invalidated when a saved role is one they hold.

## Checklist

Chapter 06 §7 (Screen Design Checklist) and §8 (UI and UX practices), ticked by the owner before review.

- [x] Route and roles match `design.md` §2
- [x] Data: every field names its source; the cell universe comes from auth 18 against `accountType`
- [x] Actions: endpoint, confirmation with diff per role, message for each control
- [x] States: one row per error code of auth 15 and 16, forbidden, partial result, success
- [x] Forms: 1 step, 1 control
- [x] Mobile: collapse rule stated
- [x] Accessibility: table semantics, cell names, sticky headers, status region
- [x] Live data: none, `['roles']` and `['me']` invalidation stated
- [x] Traceability: UC-10, FR-AUTH-06, FR-AUTH-10, US-UC10
- [x] §8 items 1 to 8 applied
- [ ] Wireframe re-checked against the built page (D-067), see the pull request
