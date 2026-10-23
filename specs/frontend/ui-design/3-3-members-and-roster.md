# Members and roster

| | |
|---|---|
| Owner | TanNB |
| Task | `specs/frontend/tasks.md` 3.3 |
| Assigned, due | 2026-10-21, 2026-10-23 |
| Status | Ready for review (one open item, see below) |
| Routes | `/o/members`, `/o/roster` (two tabs of one page) |
| Roles | Org Manager: both tabs, full read and write. Org Operator: Roster tab only, read-only (`design.md` §2 note "roster and stations readable by Operators"). |
| Use case, FRs, story | UC-04, UC-05; FR-ORG-04, FR-ORG-05, FR-AUTH-07; US-UC04, US-UC05 |
| Requirements | REQ-UBI-02, REQ-UBI-04, REQ-EVT-07, REQ-EVT-08, REQ-STA-02, REQ-ERR-03, REQ-ERR-05 (`specs/organizations/requirements.md`) |
| Wireframe | ![Members and roster](3-3-members-and-roster.svg) |

Scope from the task: organizations api-design 12 to 19; invite, change role, deactivate (MSG for
`LAST_MANAGER`); `RosterCalendar` widget with overlap errors and `NO_PRIMARY` warnings (MSG22).

> **Open item for the leader**: api-design 12 (`GET /api/organizations/:id/members`) lists
> `Permission | Org Manager, Org Operator: own; TrekLink Staff`, which would let an Operator read the
> Members tab, while `design.md` §2 states only "roster and stations readable by Operators", naming
> Members separately as Manager-only administration. This screen follows `design.md`'s explicit role
> split (Operator sees Roster only) as the more deliberate, leader-written statement of intent, and
> hides the Members tab from Operator client-side. The two documents disagree and one should be
> corrected; flagged here rather than resolved unilaterally (D-052 rule 2, the pattern of D-057).

## Data

| Shown | Source (api-design file, property) |
|---|---|
| Members tab: id, email, fullName, role, invitationPending, deactivatedAt | organizations api-design 12, `GET /api/organizations/:id/members` |
| Roster tab: `RosterCalendar` shifts (id, startsAt, endsAt, primary, backup) | organizations api-design 16, `GET /api/organizations/:id/roster` `shifts[]` |
| Roster tab: `NO_PRIMARY` warning bands over gaps and windows with no primary | 16, `warnings[]` (MSG22) |

## Actions

| Control | Endpoint | Confirmation | Success message |
|---|---|---|---|
| Invite a member (Manager) | `POST /api/organizations/:id/members` (13) | none | "Invitation sent" (server `message`) |
| Change a member's role (Manager) | `PATCH /api/organizations/:id/members/:memberId` (14) | yes, "Change {fullName} to {role}?" | "Saved." (MSG03) |
| Deactivate a member (Manager) | `POST /api/organizations/:id/members/:memberId/deactivate` (15) | yes, "Deactivate {fullName}? They lose access and are cleared from every future shift." | "Member deactivated" (server `message`) |
| Add a shift (Manager) | `POST /api/organizations/:id/roster` (17) | none | "Saved." (MSG03); a `NO_BACKUP` or `NO_PRIMARY` warning in the response shows inline on the new row, non-blocking |
| Edit a shift (Manager) | `PATCH /api/organizations/:id/roster/:shiftId` (18) | none | "Saved." (MSG03) |
| Delete a future shift (Manager) | `DELETE /api/organizations/:id/roster/:shiftId` (19) | yes, "Delete this shift?" | "Shift deleted" (server `message`) |

## States

| State | What the user sees |
|---|---|
| Loading | Both tabs show skeleton rows independently; action buttons show their pending state at once |
| Empty | Members: "No results match your filters." (MSG01) does not apply, the Manager and at least one Manager always exist (REQ-UBI-02); an organization with only its founding Manager shows that one row, never a blank table. Roster: "No shifts in this range." plus an Add shift action |
| Error 400 `VALIDATION_FAILED` | MSG02 under the field that failed |
| Error 400 `MEMBER_NOT_ELIGIBLE` | No MSG; the server `message` ("Choose two different active members of your organization.") shown as a form-level banner on the shift dialog (chapter 06 §6.3) |
| Error 409 `CONFLICT_UNIQUE` | MSG10 under the invite form's email field |
| Error 409 `INVALID_STATE_TRANSITION` | MSG28, shown when inviting into a `CLOSED` or `REJECTED` organization |
| Error 409 `LAST_MANAGER` | MSG29 (Report 3 SRS line 461 names this code for UC-04's last-Manager guard); shown as a dialog on both change-role and deactivate |
| Error 409 `SHIFT_OVERLAP` | No MSG; the server `message` ("This shift overlaps another one.") shown as a form-level banner on the shift dialog |
| Error 409 `SHIFT_STARTED` | No MSG; the server `message` ("Shorten a started shift instead of deleting it.") shown as a dialog, Delete is disabled once `startsAt` has passed and a tooltip states the same |
| `NO_PRIMARY` warning (not an error, 200 with a `warnings[]` entry) | MSG22, an amber banner over the affected window on the roster calendar |
| Not found or forbidden | MSG26 |

## Form fields (if any)

| Step | Field | Type | Required | Rule |
|---|---|---|---|---|
| 1 Invite member (one step) | email | email | yes | valid email shape |
| 1 Invite member | fullName | text | yes | non-empty |
| 1 Invite member | phoneNumber | tel | no | — |
| 1 Invite member | role | select (MANAGER, OPERATOR) | yes | one of the two values |
| 1 Change role (one step) | role | select (MANAGER, OPERATOR) | yes | one of the two values |
| 1 Add or edit shift (one step) | startsAt | datetime | yes | before `endsAt` |
| 1 Add or edit shift | endsAt | datetime | yes | after `startsAt` |
| 1 Add or edit shift | primaryMemberId | select, active members of this organization | no | different from `backupMemberId` |
| 1 Add or edit shift | backupMemberId | select, active members of this organization | no | different from `primaryMemberId` |

## Mobile, accessibility, live data

- 360 px layout: not one of NFR-UI-01's mandatory screens; below 760 px the Members table collapses
  to one card per row (name, role, a row-end action menu) and the Roster calendar collapses to a
  single scrollable day list instead of a week grid.
- Tab order and focus after each action: Members and Roster tabs are reachable by arrow keys per
  chapter 06 §5 item 5 (composite control); after Invite, focus moves to the new row; after a shift
  dialog closes, focus returns to the Add shift control that opened it.
- WebSocket events and invalidated query keys: none. No `/live` event exists for a member or roster
  change; every mutation above invalidates `['organization', id, 'members']` or
  `['organization', id, 'roster', range]` on success through TanStack Query.

## Checklist

Chapter 06 §7 (Screen Design Checklist) and §8 (UI and UX practices), ticked by the owner before review.

- [x] Route and roles match `design.md` §2, with the Members/Operator discrepancy flagged above rather
  than silently picked.
- [x] Data: every field names its api-design source.
- [x] Actions: every button names its endpoint, confirmation and message.
- [x] States: one row per error code the six endpoints return, plus the `NO_PRIMARY` warning and the
  empty states for both tabs.
- [x] Forms: each dialog is one step of at most 4 fields.
- [x] Mobile: not mandatory; collapse behaviour stated for both tabs.
- [x] Accessibility: tab order (including the tab control itself) and post-action focus are stated.
- [x] Live data: stated as none, with the query keys invalidated instead.
- [x] Traceability: UC-04, UC-05, the FRs and US-UC04/05 are in the header table.
