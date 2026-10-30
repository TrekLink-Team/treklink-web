# 2026-10-30 screen 3.3 members and roster (D-078 takeover)

- Built `/o/members` and `/o/roster` against `specs/frontend/ui-design/3-3-members-and-roster.md`, frontend only.
- The member list (organizations 12) and the roster (16) return a plain array and `{ shifts, warnings }`, not `{ items, limit }`; the pages follow the controllers on dev.
- No organizations endpoint resends an invitation. `POST /api/auth/password/forgot` sends a SET_PASSWORD code to an account that never set a password (`password-flows.service.ts` `forgot`, D-059 rule 6), so the page uses it. Asked the leader whether a dedicated endpoint is wanted.
- The wireframe's dates are illustrative: 20 Oct 2026 is a Tuesday. The tests use Mon 19 Oct.
- The 360 px member cards keep their actions behind an Actions button (aria-expanded); no shared menu component exists yet.
