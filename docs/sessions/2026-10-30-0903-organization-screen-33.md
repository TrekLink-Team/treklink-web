# 2026-10-30 organization screen 3.3, members and roster (D-078 takeover)

Handoff for `feat/organization-screen-33`, branched from `origin/dev` at `2d99717`. Frontend only; no backend, migration, catalog, error-code or seed change.

## Commits

- `028deea` feat: add member and roster hooks for screen 3.3
- `f33d27d` feat: build the members and roster pages of screen 3.3
- `8eb7cd5` test: cover the members and roster pages
- `2af5831` docs: tick frontend task 3.3 and state the resend invitation action
- `de0704b` feat: put the member card actions behind an Actions button on phones
- this file, `docs: ...`

## Built

- `/o/members` (`MembersPage`, Org Manager): list with "(you)", role and status, "Show deactivated"; invite (Operator by default; `CONFLICT_UNIQUE` under Email); change role; deactivate with an optional reason (`LAST_MANAGER` and `NOT_FOUND` keep the dialog open with the server message, `NOT_FOUND` refetches); resend invitation on `invitationPending` rows. On phones each card keeps its actions behind an Actions button.
- `/o/roster` (`RosterPage`, read by Operator and Manager): Monday-to-Monday week in the viewer's timezone, MSG22 banner and amber cells per `NO_PRIMARY` window, Previous and Next. Manager only: add, edit, delete. A started shift edits Ends only, not before now, and cannot be deleted. `SHIFT_OVERLAP` under Starts, `MEMBER_NOT_ELIGIBLE` under Backup, `SHIFT_STARTED` and `NOT_FOUND` as an Alert with a refetch. A deactivation also invalidates `['org-roster', orgId]`.
- New: `frontend/src/entities/organization/members.ts`, `roster.ts`, `frontend/src/widgets/RosterCalendar/`.

## Checks (2026-10-30)

- `npm --prefix frontend run lint`: no problems.
- `npm --prefix frontend run typecheck`: no errors.
- `npx vitest run` in `frontend`: 32 files, 431 tests passed (12 in `MembersPage.test.tsx`, 11 in `RosterPage.test.tsx`).
- Backend checks not run: no backend file changed.

## Spec changes

- `specs/frontend/tasks.md` 3.3 ticked with a Done line; open: TanNB's review.
- `specs/frontend/ui-design/3-3-members-and-roster.md`: Actions table gains the Resend invitation row.

## Shared files touched

`frontend/src/app/router.tsx` (two routes), `frontend/src/shared/config/navigation.ts` (members and roster `built: true`), and the tests that pin the built routes: `navigation.test.ts`, `AppShell.test.tsx`.

## Notes

- The member list (organizations 12) returns a plain array and the roster (16) returns `{ shifts, warnings }`, not `{ items, limit }`; the pages follow the controllers on dev.
- The wireframe dates are illustrative: 20 Oct 2026 is a Tuesday. The tests use Mon 19 Oct.

## Open decision: resend invitation

No organizations endpoint resends an invitation. The page calls `POST /api/auth/password/forgot` with the member's email: an account that never set a password is sent a new SET_PASSWORD code (`password-flows.service.ts` `forgot`, D-059 rule 6). Inside the resend cooldown nothing is sent and the answer is the same.

1. **Keep it as built (recommended).** No backend change; the auth rule already covers it.
2. Add a dedicated resend endpoint in the organizations module, with its own audit entry and a visible cooldown error.
3. Remove the button until a ruling.

## Not done

- TanNB's review of the pages.
- The leader's ruling on the open decision above.

## Demo (seeded `manager@treklink.local`, password from `SEED_MANAGER_PASSWORD`)

1. Members, Invite member: an email and a full name, keep Operator, Send invitation. The row shows "Invitation pending".
2. Roster, Add shift: Starts and Ends, an active member as Primary, Save shift.
3. Open a started shift: only Ends is editable; move it later, Save shift.
4. Members, Deactivate on a member, Deactivate. A toast confirms and the row leaves the list.
