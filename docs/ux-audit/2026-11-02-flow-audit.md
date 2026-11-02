# Flow-level UI/UX audit of the TrekLink web app (UX-1)

> 2026-11-02, read-only audit for KhoaDD on `origin/dev` at `5f0c416`; no product code changed. Input for
> conventions on elements, flows and layouts, against `specs/frontend/ui-design/0-ui-standard.md`.

## 1. Method and what ran

- **Stack ran locally.** Postgres 16 (local cluster), `npm ci`, `prisma:deploy`, `seed:demo`, backend and
  frontend dev servers, an in-process MQTT broker. No gateway. Basemap tiles are blocked in this
  sandbox, so the map canvas shows its "map is unavailable" panel; map findings come from the list pane
  and the code.
- **Route walk.** A Playwright script signed in as each seeded role and opened 44 routes at 1280 px and
  390 px (88 page views): screenshot, headings, visible actions, horizontal overflow and an axe-core run
  with the `wcag22aa` tag set (the repository's own a11y spec stops at 2.1).
- **Journey drive.** MF-01 was driven in the browser: the Manager requested 5 units, Staff approved in the
  queue panel, the counter opened on step 1. Steps 2 to 4 of the handover were not driven (the
  appointment is three days ahead).
- **Code and spec reading** for every other step (`frontend/src`, `specs/frontend`).
- **Not available:** the docs root `../treklink-docs/_docs/` is not cloned in this sandbox, so the
  conventions, decision register and firmware ground truth were not read; nothing here cites them.

Criteria cite the W3C Understanding page `https://www.w3.org/WAI/WCAG22/Understanding/<slug>`; "NN-n" is
heuristic n of https://www.nngroup.com/articles/ten-usability-heuristics/. Carbon
(https://carbondesignsystem.com), GOV.UK (https://design-system.service.gov.uk) and Material list-detail
(https://m3.material.io/foundations/layout/canonical-layouts/list-detail) are named by component.

## 2. Journeys walked

| Journey | Roles | How |
|---|---|---|
| MF-01 request, hold and deposit, approval, counter handover | Manager, Staff | Browser to counter step 1, code for steps 2 to 4 |
| MF-05 notice, return, inspection, close | Manager, Staff | Seeded Active and Defaulted contracts in the browser (counter check-in, close card); code for the rest |
| Asset management | Staff, Admin | Browser (fleet, device, maintenance, loss cases), code for dialogs |
| Contracts and their devices across contracts | Manager, Operator, Staff | Browser, four contracts |
| Live map, incidents (MF-03, MF-04) | Operator, Manager, Staff | Browser list panes, code; no SOS raised |
| Administration | Admin | Browser, first render of each page |

## 3. Findings

Severity: **B** blocks a task, **S** slows it, **C** cosmetic. Numbers are stable IDs; a gap is a finding merged into another row.

| # | Journey, step | Route, source | What the user sees | Why it is a problem | Criterion or practice | Sev | Fix pattern |
|---|---|---|---|---|---|---|---|
| F1 | MF-01, request step 1 | `/o/contracts/new`, `ContractRequestPage.tsx` | "The minimum order is 5 devices." appears only after Next | A constraint known in advance is revealed as an error | 3.3.2 `labels-or-instructions`; GOV.UK text input hint | S | State limits as a hint under the label |
| F2 | MF-01, request step 1 | same | The variant `select` lists a variant with 2 in stock against a minimum of 5; the option text is cut off at 1280 px, so the stock figure is hidden | The user can choose an impossible option and cannot read why | NN-5 error prevention | S | Variant picker as cards (image, specs, price, stock); unavailable cards disabled with the reason |
| F3 | MF-01, request sent | same, then `/o/contracts/:id` | The confirmation says the 1,125,000 VND deposit is due before the hold ends (03 Nov, 07:36); the Balance card shows Due now 0 VND, because the holding-fee line of INV-2026-000003 is due 05 Nov | The deposit's due date falls after the hold expires; the Manager is told two things | NN-1; 3.3.4 `error-prevention-legal-financial-data` | B | Deposit line due at hold expiry; header shows "Deposit due X by T" with Pay |
| F4 | MF-01, waiting for approval | `/o/contracts/:id` | The only action on a Requested contract is a red "Cancel contract"; paying goes through Invoices, then the invoice, then the payment page | No primary action for the one thing the user must do; destructive action is the most prominent | Carbon button usage (one primary, danger only for the destructive choice) | S | Next-step primary action ("Pay deposit") |
| F5 | MF-01, contract list | `/o/contracts`, `ContractsPage.tsx` | Requested row: Next date 05 Dec 2026 (term end), while the hold expires 03 Nov; the only row action is Cancel contract | The urgent deadline is not the one shown | NN-1 | S | "Next date" is the next deadline by state |
| F6 | MF-01, approval | `/t/contracts`, `ContractApprovalPage.tsx:455` | Tabs Requested, Approved, All; Active, Ending and Returned contracts only under All | The list is an approval queue, not a contract register | Carbon data table filtering | S | Status filter with counts, approval queue as a saved filter |
| F7 | MF-01, approval | same, panel | The panel shows prices and the appointment, not whether the deposit is paid nor which units are held; with the panel open the table's Status column is clipped | The decision lacks its key input; status is off-screen | NN-6 recognition over recall | S | Panel shows payment state and held units |
| F8 | MF-01 and MF-05 | `/t/contracts` panel, `/t/contracts/:id`, `/t/counter/:id` | One contract has three surfaces with different headers (breadcrumb on detail, none on counter) and different wording ("Holding fee 50 %" vs "50 % of a term") | The user re-orients on every hop | 3.2.4 `consistent-identification`; Material list-detail | S | One contract home with tabs; counter as a mode of it |
| F9 | MF-01, counter step 1 | `/t/counter/:id`, `CounterPage.tsx` | "Write channel key version 1 to each unit, then record it"; battery typed by hand | Provisioning and readings are transcribed, not read from the unit | NN-5 | S | Device read (function gap G3) |
| F11 | Contracts, devices | `/o|t/contracts/:id`, `ContractDetailPage.tsx:298` | The asset tag is text; the only link is "History" (telemetry), and only after handover | No path from a contract's unit to the unit | Material list-detail; NN-3 | S | Asset tag links to the device home |
| F12 | Contracts, devices | same, `:446` | Two search boxes above the device table with an icon and no visible label or placeholder | Sighted users cannot tell tag search from holder search | 3.3.2 `labels-or-instructions` | S | Visible label or naming placeholder |
| F13 | Contracts, lifecycle | same, `:353`, `:491` | Status is one badge; History is a list of "Requested to Approved" lines, shown only to Staff and Manager | The user cannot see where the contract is in its lifecycle or what comes next | Carbon progress indicator; GOV.UK task list | S | Lifecycle stepper plus next-step callout |
| F14 | MF-05, mid-term | `/t/contracts/:id` (Active) | "Open the counter" is the primary button; the counter then says "A running monthly contract cannot return devices. Give notice first." | The primary action leads to a dead end | NN-5 | S | Offer only actions possible now, or disabled with the reason |
| F15 | MF-05, close | `/t/contracts/:id` Close card and the counter's Close tab | Close lives in two places; "Report TL-0009 lost" appears in the Close card, the counter check-in and the device row | Same action in three places, with different labels | NN-4 consistency | S | One action bar per entity |
| F17 | Detail pages | 1280 and 390 px | Breadcrumb plus a "Back to contracts" link; counter has no breadcrumb | Two back paths | APG breadcrumb | C | Breadcrumb only |
| F18 | Assets, fleet | `/t/fleet`, `FleetPage.tsx:336` | No contract or organization column; a Rented unit does not say where it is | The fleet cannot answer "who has it" | Carbon data table | S | Holder column linking to the contract |
| F19 | Assets, device detail | `/t/devices/:id`, `DeviceDetailPage.tsx:186` | No image; variant shown as `treklink-v3` where the contract says "TrekLink v3 (GPS, SOS button)"; no specs; dates mix "02/07/2026" and "02 Sept 2026" | The physical object is not described | 3.2.4 `consistent-identification` | S | Device header with image, variant name and spec sheet (G1) |
| F20 | Assets, history | same, `:135`, `:290` | History text such as "IN_INTAKE to AVAILABLE"; rows are not links (screen 4.2 requires them); only page 1 is fetched, no pager | Raw enums; no route to the contract or record behind an event | design-system §6 ("Show a raw enum": don't) | S | Timeline with labels and links, paged |
| F21 | Assets, device detail | same, `:201` | The current contract appears only inside a history line; the spec's static map of the last position is plain coordinates | Key relations are buried | NN-6 | S | "Currently on RC-..." fact with link; map thumbnail |
| F23 | Assets, lifecycle | same, `:236` | A row of buttons per state; Retire only from Maintenance, so an Available unit goes through Open maintenance first; the retire error reads "Please fill in this field." | Not `StateChangeMenu` (standard §6); a hidden prerequisite; the error does not name the field | 3.3.1 `error-identification`; standard §3 | S | `StateChangeMenu` listing every transition, unavailable ones with the reason |
| F24 | Assets, maintenance | `/t/maintenance`, `MaintenancePage.tsx:657` | A record opens in a drawer; the device page's "Open maintenance" fact links to the list, not the record | Third detail pattern; the link loses context | Material list-detail | S | Deep link to the record |
| F25 | Assets, org view | `/o/devices/:id` | "You do not have access to this." Org roles have no device page, only telemetry | Org Manager cannot see a unit's details | NN-1 | S | Org-scoped device page (G5) |
| F26 | Navigation | `/t/stock-take`, `/t/admin/variants`, any unknown URL; `router.tsx:171` | "You do not have access to this." (on `/o/incidents/:id`, with a useless "Try again") | A not-found or unbuilt page reads as a permission refusal | GOV.UK page not found pattern; NN-9 | S | Separate not-found, no-permission and failed states |
| F27 | MF-03, Staff incidents | `/t/incidents`, `StaffIncidentsPage.tsx:313` | The table sits in about 490 px at 1280 px and wraps "INC-2026-000001" over three lines; detail opens in a panel, while Org users get `/o/incidents/:id` | Same entity, two detail patterns; no linkable Staff incident URL | Material list-detail | S | One incident home per audience, linkable |
| F29 | MF-04, live map | `/o/map`, `/t/map`, `LiveMapPage.tsx:132` | Device rows' accessible name leaves out battery and the Stale badge (known, allowlisted 2026-11-01); rows link to an open incident only, never to the device or contract | Label mismatch; dead end | 2.5.3 `label-in-name` | S | Name starts with visible text; row links |
| F30 | MF-04, map | `LiveMapWidget` | Pan has no button alternative (open in the standard) | Dragging only | 2.5.7 `dragging-movements` | S | Pan buttons |
| F31 | Admin, sync | `/t/admin/sync` at 390 px | axe `scrollable-region-focusable` (serious) on `.overflow-auto` | A scroll box cannot be reached by keyboard | 2.1.1 `keyboard` | S | `tabindex="0"` and a name on the scroll region |
| F32 | Org, field stations | `/o/field-stations` at 390 px | axe `label-content-name-mismatch`: visible "Create station", name "Create Field Station" | Voice control users cannot say what they see | 2.5.3 `label-in-name` | S | Name starts with the visible text |
| F33 | Admin, parameters | `/t/admin/parameters` | 60 parameters on one page in 8 groups, each with Edit and History, no search | Finding one key means scrolling | Carbon data table search | S | Search and group filter |

## 4. Patterns, root causes and proposed conventions

### P1. One entity, many surfaces, no home
**Instances:** F8, F11, F24, F25, F27. Contract: queue panel, detail page, counter page. Incident: page for
Org, panel for Staff. Device: Staff page, telemetry page, maintenance drawer, nothing for Org.
**Root cause:** `ui-design/README.md` assigns one file per page task and splits screens into owner lanes
by route (contracts to LongLP, devices to KhoaDD, incidents to HoangTK). No document owns an entity
across screens, so each lane drew its own detail surface from its own endpoints.
**Convention:** *One entity, one home.* Each core entity (contract, device, incident, organization, loss
case, maintenance record, invoice) has one canonical detail route per audience, laid out as header plus
tabs (Overview, Devices, Money, History, Documents). Work surfaces (approval, counter, inspection) are
tabs or modes of that home. Every mention of the entity is a link to it. An `entity-*.md` file per
entity lists its home, tabs and inbound links.

### P2. Lifecycle shown as a word
**Instances:** F13, F14, F20, F23. Badge plus a text history; devices show raw enums.
**Root cause:** the component catalog (design-system §6) offers `Stepper` only "for multi-step forms";
it is used by no product page (the counter and request pages hand-roll their own). The screen template
(Data, Actions, States, Form fields, Mobile, Checklist) has no section for the lifecycle.
**Convention:** *Lifecycle header.* Every stateful entity shows its main path as a progress indicator
(done, current, next) with exits such as Cancelled or Defaulted as a branch marker, a "Next step" callout
naming who acts, and a history timeline with human labels and links to the record behind each event.

### P3. No primary action, or the wrong one
**Instances:** F4, F5, F14, F15, F23; a red Swap button on every counter row.
**Root cause:** each screen's Actions table lists endpoints with "Shown when", so a page renders every
allowed action as its own button in a rail; nothing selects the one action that moves the flow.
**Convention:** *One action bar per entity.* Exactly one primary action, derived from state and role
(the next step); other transitions in `StateChangeMenu`; destructive actions last and never the only
visible action. An action is shown only when it can succeed now, or shown disabled with its reason.

### P4. Devices rendered differently in every context
**Instances:** F11, F18, F19, F21, F29; invoice lines say "5 x treklink-v3". Text tag in the contract, code plus firmware in the fleet,
holder on the map, bare tag at the counter.
**Root cause:** no shared device reference component; each page formats the fields its endpoint returns,
and the endpoints return different device shapes (`ContractDevice` has no variant, battery or status).
**Convention:** *Device reference and device card.* One `DeviceRef` (tag, variant name, status, link)
used inline, one `DeviceCard` (adds image, battery, last seen, holder) used in lists of units; every API
that lists units returns the same device summary.

### P5. Physical assets without media or specs
**Instances:** F2, F19; the request, counter and device pages never show what the unit looks like.
**Root cause:** `HardwareVariant` (`backend/prisma/schema.prisma:621`) has no image or specification
fields; screen 4.1 (hardware variants admin) is not built (`navigation.ts`, `built: false`); no screen
template asks for media.
**Convention:** *Every physical asset type has an image and a spec sheet* (GOV.UK summary list), shown
wherever a unit is chosen, handed over, inspected or viewed.

### P6. Not found, no access and failure look the same
**Instances:** F25, F26.
**Root cause:** the router's `*` route renders `NoAccessPage`; `ErrorState` always offers retry.
**Convention:** three states with distinct copy and next steps: not found (links home), no permission
(names the role needed), failed (retry). Unbuilt nav entries stay hidden, and their URLs answer not found.

### P7. The standard is written but not applied
**Instances:** F20, F21, F23; contract status uses `Badge` (`ContractDetailPage.tsx:353`) where devices use `StatusBadge`. `StateChangeMenu` is used by one product page
(`OrganizationReviewPage.tsx`); screen 4.2 asks for history links and a map thumbnail that are not built.
**Root cause:** "the screen file is corrected when next edited" migrates only what is touched, and no
test checks a page against the pattern.
**Convention:** a conformance list per pattern in `tasks.md`, and an e2e assertion per pattern (for
example "every detail page has one primary action", "every asset tag is a link").

### P8. Constraints and labels hidden
**Instances:** F1, F2, F12, F32.
**Root cause:** the shared toolbar search allows a screen-reader-only label; validation rules live in the
API design, not in the screen's form table.
**Convention:** every filter and field has a visible label; every known limit appears as a hint before
input.

## 5. Function gaps (not layout)

| # | Gap | Evidence | Spec that should own it |
|---|---|---|---|
| G1 | Device images and hardware specs | No fields on `HardwareVariant`; variants admin unbuilt | `specs/devices` (variant model, api-design 01), screen 4.1 |
| G2 | A path to a unit's settings per firmware | `firmwareVersion` is a free-text field (`DeviceDetailPage.tsx:86`); no firmware release or settings profile exists | `specs/devices` new requirement; needs the firmware ground truth, not read here |
| G3 | Meshtastic protobuf read (device docking, D-080, treklink-web#126) | Registration takes the node number by hand (`docs/demo/2026-11-01-demo-script.md:440`); counter provisioning and battery are typed | `specs/devices` with `specs/gateway-sync`; frontend 4.2 and 5.4 |
| G4 | Release of a single device | `release()` is internal to devices (`specs/devices/design.md:194`); Staff release units only by cancelling or rejecting the whole contract, or by a swap at the counter | `specs/rentals` api-design (new), `specs/devices` |
| G5 | Org view of a device | No `/o/devices/:id` route | `specs/frontend/design.md` §2, devices api-design 07 (org-scoped read) |
| G6 | Device's current contract and holder in the devices API | `Device` and `DeviceDetail` (`entities/device/api.ts:23`) carry no contract reference | devices api-design 06 and 07 |
| G7 | Staff incident detail route | Only `/o/incidents/:id` exists | screen 8.2 |
| G8 | Stock-take | Screen 4.5 specified; route `built: false` | screen 4.5 |
| G9 | Reports | Screen 9.4 specified; route `built: false` | screen 9.4 |
| G10 | Form error summary | Standard §4 says not yet built | `0-ui-standard.md` §4 |

## 6. What could not be checked

- MF-01 counter steps 2 to 4 (payment, note preview, signature) in the browser; the deposit figure of F3
  against the billing data.
- MF-05 end to end (notice, term end, check-in, reset, inspection, close): needs the term-end demo
  script; seen only as seeded Active and Defaulted states.
- MF-03 SOS flow: no gateway ran and no SOS was raised; incident detail seen only as a refusal.
- Map canvas (tiles blocked), dark mode, 320 px, screen reader and keyboard passes.
- Admin pages beyond first render (roles grid editing, bulk actions, audit filters).
- The conventions and decision register in `treklink-docs`, not present in this sandbox.
