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
| **Stage** on a card | demo 03 `POST /api/demo/scenarios/:id/stage` | `Dialog` "This deletes every row in the local database and stages {title}. Every other window must sign in again. If the stage fails, the database is left empty: stage again." with **Stage** and **Cancel** | Toast "{title} staged."; the window is signed in again as the seeded Admin from `session` |
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
| Success | Result panel above the role switcher and the cards, its heading focused |

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

## Sandbox test accounts box

Widget `TestAccountsBox` (`frontend/src/widgets/TestAccountsBox/`), D-088 amendment of 2026-11-01 and
D-089. Shown on the public root page `/` (PlansPage, after the page header and before the prices) and on
`/sign-in` beside the form. It reads demo api-design 05 (`GET /api/demo/accounts`, public, loaded only
when `DEMO_TEST_ACCOUNTS_ENABLED` is `true`) through `useDemoAccounts` in `entities/demo`, query key
`['demo', 'accounts']`, no retry.

| State | Shows |
|---|---|
| Loading, any error, 404 (flag off) or an empty list | Nothing: no card, no space |
| Accounts | A `Card` titled "Sandbox test accounts", the note "Fictitious demo data. Anyone with this page can sign in as any role." and one row per account |

Each row: the role label and the full name with the organization code (or "TrekLink"), a **Use** button
on the right, then the email and the password in a monospace font side by side (stacked below 640 px),
each with an icon button "Copy email for {role}" and "Copy password for {role}" (toast "Copied." or, when
the browser blocks the clipboard, "The browser blocked the clipboard. Select the text and copy it
yourself.").

- On `/sign-in`, **Use** fills the email and password fields and moves focus to the Sign in button.
- On `/`, **Use** navigates to `/sign-in` with route state `{ demoEmail }`; the sign-in page fills both
  fields from its own copy of the list once it has loaded. The password never enters the URL or the route
  state.

Every control is a `shared/ui` `Button` or `IconButton`, reachable by Tab in reading order; theme tokens
only, readable in both themes. `/sign-in` uses the wide public frame (`app/App.tsx`), so the box sits
beside the form from 1024 px and under it below; the form keeps its own width, so with no box the page
looks as before.

## Field simulation

Section "Field simulation" of `/t/admin/demo`, D-093 amendment and D-094 of 2026-11-02,
`specs/demo/requirements.md` §2.4 and design §9 (task 5.7). It renders while `GET /api/demo/simulation`
(demo api-design 06) answers, that is while `DEMO_SIMULATION_ENABLED` is `true` and the caller holds
`demo.simulate` (TrekLink Admin); on a 404 or 403 it renders nothing. It does not depend on
`DEMO_CONTROLS_ENABLED`: on the Vercel staging the page shows this section alone, with no scenario cards and no
role switcher, and the nav entry "Demo control" shows while either the status (demo 01) or the simulation
(demo 06) answers.

### Data

| Shown | Source (api-design file, property) |
|---|---|
| Notice "The field simulation runs only on a local database or the Vercel staging." (warning tone), every write disabled | demo 06 `databaseAllowed` false |
| Nodes table: asset tag with a "Simulated" badge, organization code, trail name, pattern and movement style stacked in one cell so the row actions stay in view ("Steady pace" for a node started before the styles), position (six decimals), battery %, last packet (relative time with the absolute time as its title), SOS state ("SOS since 10:42", "Fall since 10:42" or "None"), status | demo 06 `nodes[]`: `assetTag`, `organization.code`, `trailId` resolved through `trails[]`, `pattern`, `style`, `position`, `batteryPct`, `lastPacketAt`, `sosKind`, `sosSince`, `status` |
| Add node form: device select (asset tag, status, organization; a device with a running node is disabled), trail select (name, region, length in km), pattern select, movement style select (first option "From the asset tag", the default, then the eight styles of demo design §9.1; leader ruling 2026-11-06, which replaces the speed input: a style sets its own pace) | demo 06 `devices[]`, `trails[]`, `patterns`, `styles` |
| Attribution under the table: "Trails © OpenStreetMap contributors, ODbL." with each trail's way ids and read date in a disclosure | demo 06 `trails[].source` |

### Actions

| Control | Endpoint | Confirmation | Success message |
|---|---|---|---|
| **Add node** (form) | demo 07 `POST /api/demo/simulation/nodes` | none | Toast "{assetTag} runs on {trail}." |
| Row **Pattern** select, then **Apply** | demo 08 `PATCH /api/demo/simulation/nodes/:id` with `expectedVersion` | none | Toast "{assetTag} now {pattern}." |
| Row **Style** select, then **Apply** (leader ruling 2026-11-06) | demo 08 `PATCH /api/demo/simulation/nodes/:id` with `expectedVersion` and `style` | none | Toast "{assetTag} now moves as {style}." |
| Row **SOS** | demo 10 `POST .../events` `{ kind: SOS }` | `Dialog` "Send an SOS from {assetTag}? It opens a real incident, marked Simulated, and alerts the on-duty operator." **Send SOS**, **Cancel** | Toast "SOS sent from {assetTag}." |
| Row **Fall** | demo 10 `{ kind: FALL }` | The same `Dialog` with "a fall SOS" | Toast "Fall SOS sent from {assetTag}." |
| Row **Cancel SOS** (shown while `sosKind` is set) | demo 10 `{ kind: SOS_CANCEL }` | none | Toast "Beacons stopped. Resolve the incident as for a real device." |
| Row **Stop** | demo 09 `POST .../stop` with `expectedVersion` | `Dialog` "Stop {assetTag}? It sends nothing more and turns stale after the staleness threshold." **Stop node**, **Cancel** | Toast "{assetTag} stopped." |
| Quick button **SOS on a rented node** | 07 (when the first rented device has no running node, `WALK` on the first trail), then 10 `SOS` | The SOS `Dialog` | As for SOS |
| Quick button **A node goes silent** | 08 `SILENT` on the first running node, or 07 then 08 | none | Toast "{assetTag} is silent; it turns stale after the threshold." |
| Quick button **A node strays** | 08 `STRAY` on the first running node, or 07 then 08 | none | Toast "{assetTag} leaves the trail." |

The quick buttons pick the first rented device by asset tag; a person can do the same with the row actions.

### States

| State | What the user sees |
|---|---|
| Loading | A table skeleton |
| No nodes | `EmptyState` "No simulated nodes. Add one below." |
| A write running | The row's buttons and the form's submit are disabled, with `aria-busy` on the row |
| Error `DEMO_DATABASE_NOT_ALLOWED` (403) | Alert with the server message |
| Error `DEMO_NODE_RUNNING`, `INVALID_STATE_TRANSITION`, `STALE_VERSION` (409) | Alert with the server message; the list is read again |
| Error `VALIDATION_FAILED` (400), `NOT_FOUND` (404) on a write | Alert with the server message |
| 404 or 403 on demo 06 | The section is absent |

### Live data and accessibility

- Query key `['demo', 'simulation']`, refetched every 15 s while the page is open (design §9: on the Vercel
  staging each request may start a job tick, so the polling keeps the simulator running during a demo), and
  after each write.
- The "Simulated" badge is the `shared/ui` `Badge`, neutral tone, with the word, never colour alone.
- The table scrolls horizontally inside its card below 640 px; the row actions wrap. Every control is a
  `shared/ui` `Button` or a labelled select reachable by Tab; both dialogs return focus to the row button.

### Simulated badges elsewhere

| Where | Source |
|---|---|
| Live maps (`/t/map`, `/o/map`): the marker's popup and the device list row | monitoring api-design 02 `devices[].simulated` |
| Incident queue rows and the incident detail header | incidents api-design 01 and 02 `simulated` |

## W43 staging quick controls (2026-11-07)

This section supersedes staging's simulation-only presentation. Demo status reports quickEnabled and roleSwitchEnabled separately. Admin navigation remains the existing route and policy. The role switcher and destructive local scenarios are rendered only when local controls are enabled; staging uses the public Sandbox test accounts box to sign in.

The thin Demo control header stays outside PageScrollBody. The document fits dvh; only the named nested controls region scrolls. No extra banner consumes the first phone viewport. Cards stack at 320/360 px, two columns from 900 px. All primary buttons are 44 px; forms use shared Field, Input and Select with visible labels. Controls wrap without document overflow in either theme. At 400 percent zoom bars may release per 0-ui-standard.

Group quick cards by workflow: WF-01 organization registration and contract (Active organization, variant, quantity, target state); WF-02 Simulated walkers refresh; WF-03 SOS on a rented unit and next tier; WF-04 the existing balance/invoice links from a created contract; WF-05 loss/fault on a rented unit and contract term end. Each card has one submit button, a cause-specific error and a persistent live result line with record links. Disable unavailable actions with their reason. Refetch options after every command; retain partial-result links on error.

A Demo time controls disclosure contains profile toggle (shows Active/Normal and current version), chosen contract term end and chosen incident next tier, with version from the last options read. Each time control uses Dialog confirming its synthetic time change and affected record. The contract form discloses synthetic signature and manual provisioning before submission for ACTIVE/RETURN_DUE. Profile changes show 30-second tiers and a 5-minute reopen window, restore prior values on disable and explain stale versions as reload required. WF-02 and SOS results say Simulated. Mutations use entities/demo TanStack Query hooks and invalidate options/status/simulation. Test both themes at 1440, 1280, 900, 360, 320 px and 400 percent zoom, inspect screenshots and axe, keyboard focus, target sizes and document dimensions.

W43 gate clarification: neither the page nor its nav entry appears from a simulation response alone. The simulation control routes share the explicit control/environment gate in addition to their own flag.
