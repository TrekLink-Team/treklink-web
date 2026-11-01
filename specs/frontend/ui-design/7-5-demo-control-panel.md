# Demo control (`/t/admin/demo`)

| | |
|---|---|
| Owner | KhoaDD (D-078) |
| Task | `specs/demo/tasks.md` 3.1 |
| Assigned, due | 2026-11-01, 2026-11-01 |
| Status | Ready for review |
| Routes | `/t/admin/demo`; nav entry "Demo control" in Administration, shown only while `GET /api/demo/status` answers `enabled: true`. Also an account-menu item, "Switch role", for every signed-in user while demo mode is on. From `specs/frontend/design.md` §2. |
| Roles | TrekLink Admin for the page. The account-menu switcher: every signed-in role. |
| Use case, FRs, story | D-088; `specs/demo/requirements.md` REQ-EVT-01 to REQ-EVT-04 |
| Wireframe | none; cards in the grid of screen 7.4 |

## Data

| Shown | Source (api-design file, property) |
|---|---|
| Red notice "Demo controls run only against a local database." | demo 01 `databaseLocal` false |
| Last staged scenario and time | demo 01 `lastStaged.scenarioId`, `lastStaged.at` |
| Card: title, flow tag, summary, unavailable reason | demo 02 `items[].title`, `flow`, `summary`, `available`, `unavailableReason` |
| Result: records as links, first steps as a numbered list | demo 03 `records[].label`, `code`, `path`; `firstSteps[]` |

## Actions

| Control | Endpoint | Confirmation | Success message |
|---|---|---|---|
| **Stage** on a card | demo 03 `POST /api/demo/scenarios/:id/stage` | `Dialog` "This deletes every row in the local database and stages {title}. Every window must sign in again." with **Stage** and **Cancel** | Toast "{title} staged."; the window is signed in again as the seeded Admin from `session` |
| Role buttons Admin, Staff, Manager, Operator (page and account menu) | demo 04 `POST /api/demo/switch-role` | none | The session is replaced and the window opens the role's landing page |

## States

| State | What the user sees |
|---|---|
| Loading | Card skeletons |
| Staging | The chosen card shows "Staging. This takes up to a minute."; every Stage and role button is disabled |
| `databaseLocal` false | The red notice; every action disabled |
| Error `DEMO_DATABASE_NOT_LOCAL`, `DEMO_DISABLED` (403) | Alert with the server message |
| Error `DEMO_BUSY`, `DEMO_SCENARIO_UNAVAILABLE`, `DEMO_SEED_NOT_CONFIGURED` (409) | Alert with the server message |
| Error 404 on status | Demo mode is off: no nav entry, no menu item; the page shows MSG26 |
| Success | Result panel under the cards |

## Mobile, accessibility, live data

- 360 px: cards stack in one column; role buttons wrap.
- The dialog takes focus on open and returns it to the card's Stage button on close. The result panel heading takes focus after a stage.
- Query keys: `['demo', 'status']`, `['demo', 'scenarios']`. A stage or switch replaces the session; every cached query is cleared.

## Checklist

- [x] Route and roles match `design.md` §2
- [x] Data: every field names its source
- [x] Actions: endpoint, confirmation and message for each control
- [x] States: one row per error code of demo 01 to 04
- [x] Theme tokens only; readable in both themes
