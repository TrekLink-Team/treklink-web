# Demo panel (`/demo/panel`) (added 2026-11-24, D-110)

| | |
|---|---|
| Owner | KhoaDD (D-078), TK-243 |
| Task | `specs/demo/tasks.md` 9.5 |
| Assigned, due | 2026-11-24, 2026-11-26 |
| Status | Ready for review |
| Routes | `/demo/panel`, public, outside the signed-in shell; linked from `/demo` ("Open the demo panel"). It lives in `specs/demo` because `specs/frontend` stays frozen (D-103, D-110 rule 6) |
| Roles | No account. The panel password, typed once per tab |
| Requirements | `specs/demo/requirements.md` §5, design §11, api-design 13 to 16 |
| Wireframe | none; the page follows the UI standard (`specs/frontend/ui-design/0-ui-standard.md`) |

## Layout

The page fits the viewport (`dvh`); the document never scrolls. A thin header holds the title "Demo panel",
the playback status and **Lock**. Below it the tabs **Panel operator**, **Presenter** and **Site clicker**;
the tab panel is the one scroll region (`tabindex="0"`, named after the tab). At 360 px the tabs scroll
sideways inside their strip and every card takes the full width.

Before the password is accepted the page shows only the password form: field **Panel password**
(`type="password"`, `autocomplete="off"`), **Open the panel**, and the note "The password stays in this tab
only. Closing or reloading the tab forgets it." The password is held in a module variable for the tab
(never `localStorage`, `sessionStorage`, a cookie or the URL) and sent as `X-Demo-Panel-Password`.

## Data

| Shown | Source |
|---|---|
| Playback flow, step n of m, status, next step time | demo 13 `playback` |
| Step list with done, current and failed marks, each with its window and screen | demo 13 `playback.steps[]` |
| Action groups Incidents, Contracts, Billing, Devices; each action's record picker | demo 13 `actions[]`, `options` |
| Last result: label, acted as, record links | demo 14 `label`, `actedAs`, `records[]` |
| Reseed availability and reason | demo 13 `reset.available`, `reset.reason`, `reset.nextAllowedAt` |

## Role views

| Tab | For | Shows |
|---|---|---|
| Panel operator | the panel operator | Playback controls (flow select, interval, **Start**, **Pause**, **Resume**, **Next step**, **Stop**); the action groups, each with a record select and one button per action; the last result; the reseed card |
| Presenter | the presenter | The current flow's steps as a numbered list with the current step highlighted, its talking line and the playback status; no write controls |
| Site clicker | the site clicker | For the current and next step: the window letter, role, page and the click to make, and the record links of the last result; no write controls |

## Actions

| Control | Endpoint | Confirmation | Success message |
|---|---|---|---|
| **Open the panel** | demo 13 | none | The tabs appear; the Panel operator tab is selected |
| An action button | demo 14 | none, except `contract-cancel`, `incident-false-alarm` and `incident-close`: `Dialog` naming the record | Live region "{label}: done as {acted as}." and the result card |
| **Start**, **Pause**, **Resume**, **Next step**, **Stop** | demo 15 | **Stop**: `Dialog` "Stop the playback of {flow}?" | Live region with the new status |
| **Reseed the demo database** | demo 16 | `Dialog` with the field **Type RESET DEMO DATA to confirm**; **Reseed** enabled only on an exact match | Live region "Demo data reseeded. Every window must sign in again." |
| **Lock** | none | none | The password is forgotten; the password form returns |

## States

| State | What the user sees |
|---|---|
| 401 `DEMO_PANEL_PASSWORD_INVALID` | Under the field: "The panel password is wrong. Check it with the leader." The password is forgotten |
| 429 `RATE_LIMITED` | Alert with the server message; **Open the panel** stays enabled |
| 404 | "The demo panel is off on this deployment." and a link back to `/demo` |
| Action error (any code) | Alert in the result card with the server message and any committed links |
| Reseed refused (403, 409, 429) | Alert in the reseed card with the server message; the card shows the reason from `reset.reason` before any click |
| Playback failed | The failed step marked, its error and links |
| Step skipped (amended 2026-11-25, D-110 rule 8, review of treklink-web#541) | The step reads Skipped in the Presenter list, "Skipped: <step>" in the Panel operator and Site clicker views |

## Accessibility and live data

- Every status change goes to one `aria-live="polite"` region under the header.
- Buttons are at least 44 px high; focus is never hidden under the header.
- Contrast and focus rings follow the theme tokens in both themes.
- While the page is open and unlocked it reads demo 13 every 5 s, so playback progress and new records show without a click. Query key `['demo', 'panel']`, never cached across a lock.
