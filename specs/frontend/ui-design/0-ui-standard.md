# UI standard of the TrekLink web frontend (WCAG 2.2 AA)

> Written 2026-11-01 by KhoaDD under D-078, after the leader judged the UI below industry standard at
> the 2026-11-01 demo (list tables without checkboxes or bulk actions, state changes hard to reach,
> inconsistent practice). Binding for every screen of this folder and every component of
> `frontend/src/shared/ui`. The shared pieces it names are built (task 1.6 of `../tasks.md`) and were
> applied to the admin and list pages by W29 (task 1.7, open points listed there). Where a screen file disagrees with this standard, this
> standard wins and the screen file is corrected when next edited.
>
> Each rule names its source. "TrekLink" marks a project choice stricter than the source.

## 1. WCAG 2.2 level AA

The target is WCAG 2.2 AA in both themes (Canopy light, Volt dark), at 1440 px and at 320 CSS px.

| Criterion | Rule in TrekLink | Built in | Source |
|---|---|---|---|
| 2.4.11 Focus not obscured (minimum) | The sticky page header and action bar publish their height and the content area turns it into `scroll-padding`; a focused control is scrolled clear of both (design-system §5.2). A menu opens beside its button (below, or above when there is no room), never over it. A toast never covers the control that has focus: **open** (an error toast stays until dismissed and can sit over the phone action bar; W29). | `PageChrome.tsx`, `AppShell` | https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum |
| 2.5.8 Target size (minimum) | Every pointer target is at least 24 by 24 CSS px. TrekLink: 44 px for primary touch targets (buttons `md`, form controls, menu items, dialog and toast buttons, filter chip remove through an inset pseudo-element); 24 px is the floor only for dense table controls (row checkbox hit area 40 px, sort buttons 32 px); the pagination buttons and the rows-per-page select are 44 px. | `buttonStyles.ts`, `DataTable`, `Menu`, `Toolbar.FilterChip`; live map markers: a 24 px circular target per marker (`shared/ui/map/markers.ts`), close markers spread so targets stay 24 px apart (`shared/ui/map/spread.ts`, screen 9.1) | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum |
| 2.5.7 Dragging movements | Any drag (map pan, a future reorder) has a single-pointer alternative: buttons or a menu. | Leaflet zoom control (on by default in `LiveMapWidget`); map pan has no button alternative yet (open for W29) | https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements |
| 3.3.7 Redundant entry | A value the user already gave in the same process is prefilled or offered for selection, never asked twice (counter readings, contract dates). | per screen | https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry |
| 3.3.8 Accessible authentication (minimum) | Sign-in fields allow paste and password managers (`autocomplete="current-password"`, `one-time-code`); no puzzle or transcription test. | auth pages | https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum |
| 1.4.3 Contrast (minimum) | Text 4.5:1, large text 3:1, in both themes. | `tokens.test.ts` | https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum |
| 1.4.11 Non-text contrast | Control borders (`line-strong`), focus rings, badge edges and meaningful icons 3:1 against their background in both themes. | `tokens.test.ts` | https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast |
| 2.4.7 Focus visible | One ring everywhere: outline 2 px plus offset 2 px in `focus` (`styles.ts` `FOCUS`, the global `:focus-visible` rule). No ring-based or offset-less variant. | `styles.ts`, `index.css` | https://www.w3.org/WAI/WCAG22/Understanding/focus-visible |
| 2.5.3 Label in name | The accessible name starts with the visible text: "Change status of TL-0042" for a button reading "Change status", "Edit TL-0042" for a row button reading "Edit". | `Menu`, `DataTable` | https://www.w3.org/WAI/WCAG22/Understanding/label-in-name |
| 3.3.1 Error identification, 3.3.3 Error suggestion | An error names the field and says how to fix it: "Enter a reason for this change.", never "Invalid". | `Field`, `StateChangeDialog` | https://www.w3.org/WAI/WCAG22/Understanding/error-identification, https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion |
| 4.1.3 Status messages | Results that do not move focus are announced from a live region that stays mounted: the selection count, toasts (`status` for success, info and warning; `alert` for errors), loading. | `DataTable`, `Toast` | https://www.w3.org/WAI/WCAG22/Understanding/status-messages |
| 1.4.10 Reflow | Content works at 320 CSS px without two-dimensional scrolling, except data tables, which scroll inside their own box or switch to cards (`renderCard`). | `DataTable` | https://www.w3.org/WAI/WCAG22/Understanding/reflow |

## 2. Data tables

| Rule | Built in | Source |
|---|---|---|
| A native `table` with a `caption`; headers are `th scope="col"`. | `DataTable` | https://www.w3.org/WAI/ARIA/apg/patterns/table/ |
| One checkbox per row, named "Select {readable row name}" from `rowLabel` (an asset tag, a contract code), never an id. Hit area 40 px, the shared focus ring. | `DataTable` `rowLabel` | https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/ |
| The header checkbox is tri-state: checked, unchecked, or mixed (the native `indeterminate` property; ARIA in HTML forbids `aria-checked` on a native checkbox), named "Select all rows on this page". It acts on the current page only. | `DataTable` | https://www.w3.org/WAI/ARIA/apg/patterns/checkbox/ |
| Shift-click selects or clears the range from the last clicked row. | `DataTable` | https://carbondesignsystem.com/components/data-table/usage/ |
| Selection survives paging and filtering. When the API gives a total and the whole page is selected, the bulk bar offers "Select all N results"; the bulk action then acts on the filter, not on a list of ids. Superseded on CollectionView (D-096, leader 2026-11-03): select-all covers the current page only, and a search, filter or sort change clears the selection (chapter 06 §9.4). | `DataTable` `totalCount`, `onSelectAllResults`; `CollectionView` | https://carbondesignsystem.com/components/data-table/usage/ |
| From the first selection a bulk bar shows the count (also announced through a status region), verb-plus-noun actions ("Retire 3 devices", never "Apply") and Clear selection. | `BulkBar`, `DataTable` `bulkActions` | https://carbondesignsystem.com/components/data-table/usage/ |
| Row actions are disabled while the bulk bar shows, with the reason "Clear the selection to use row actions." as their description. | `DataTable` | TrekLink, after Carbon batch actions |
| Fewer than three row actions show inline; three or more go into one overflow menu button with `aria-haspopup="menu"`, `aria-expanded` and a name ("Actions for TL-0042"). | `DataTable` `rowActions`, `Menu` | https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/ |
| Sortable headers are buttons; only the sorted column carries `aria-sort`. The server sorts. The full rule, with the cycle, is §8. | `DataTable`, `CollectionView` | https://www.w3.org/WAI/ARIA/apg/patterns/table/ |
| A row opens through a real link (`rowHref`) or button (`onRowActivate`) in its activation column, so Enter works; a click anywhere on the row is a pointer shortcut only, never the only path. | `DataTable` | https://www.w3.org/WAI/ARIA/apg/patterns/table/ |
| Pagination sits at the bottom of the table with the range, the page size and previous and next. | `Pagination` | https://carbondesignsystem.com/components/pagination/usage/ |
| An empty result replaces the table with an `EmptyState` holding one next step. Skeleton rows show while loading. | `DataTable`, `EmptyState`, `Skeleton` | https://carbondesignsystem.com/components/data-table/usage/ |

## 3. State changes

| Rule | Built in | Source |
|---|---|---|
| A status shows as a text badge with a glyph or shape, never colour alone. Where the user may change the state from a list, the badge itself is the menu button (§8.2). | `StatusBadge`, `StatusBadgeMenu` | https://atlassian.design/components/lozenge/examples (lozenge as a dropdown trigger), https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/ |
| The change control is a menu of only the next states allowed for this record and user; the server re-checks every transition and answers `INVALID_STATE_TRANSITION` otherwise. No allowed state, no menu. | `StateChangeMenu` | https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/ |
| The confirmation is titled with the action and the object ("Retire device TL-0042?"), its confirm button repeats the action ("Retire device", never "OK" or "Yes"), and its body states the consequences. | `StateChangeDialog`, `ConfirmDialog` | https://carbondesignsystem.com/components/modal/usage/ |
| An irreversible change uses `alertdialog`; initial focus goes to the least destructive control (Cancel, or the reason field, since typing changes nothing); focus returns to the trigger on close. | `StateChangeDialog`, `ConfirmDialog irreversible`, `Dialog role` | https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/, https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ |
| An audited change has a labelled, required reason field, checked on submit. | `StateChangeDialog` `needsReason` | https://design-system.service.gov.uk/patterns/validation/ |
| The request carries `expectedVersion` from the loaded record. | `StateChangeDialog` | D-002 contract, optimistic `version` |
| Success shows a toast through the status region; an actionable toast stays until dismissed. | `Toast` | https://www.w3.org/WAI/WCAG22/Understanding/status-messages |
| On `STALE_VERSION` a persistent inline notice (MSG36) stays in the dialog, keeps what the user typed and offers Reload; it never closes the dialog on its own. | `StateChangeDialog` `onReload` | TrekLink, MSG36 |

## 4. Forms

| Rule | Source |
|---|---|
| The label sits above the input; a hint sits between the label and the input; a placeholder is never the label. | https://design-system.service.gov.uk/patterns/validation/ |
| Optional fields are marked "(optional)"; required fields carry the visible mark and "(required)" in the name (`Field`). | https://design-system.service.gov.uk/patterns/validation/ |
| One validation timing app-wide: on submit, as the app does today, unless a screen file says otherwise. | https://design-system.service.gov.uk/patterns/validation/ |
| A form with more than one error shows an error summary titled "There is a problem" at its top, with a link to each field, and moves focus to it. | https://design-system.service.gov.uk/components/error-summary/ |
| A submit button is never disabled without a visible reason; it stays enabled and validation explains what is missing. | https://design-system.service.gov.uk/patterns/validation/ |

Field-level errors are built (`Field`); the error summary component is not yet, and lands with the
first form that needs it in W29.

## 5. Dark mode

| Rule | Source |
|---|---|
| Semantic tokens only (`bg-surface`, `text-ink`, `border-line-strong`, status tokens); no raw hex or raw palette class. | design-system §2.1, `rawPalette.test.ts` |
| Contrast is re-tested per theme: every rule of §1 holds in Canopy and in Volt. | `tokens.test.ts` |
| No pure black surface (the only `#000000` token is the Volt scrim, always used with alpha); raised surfaces are lighter than the ground in Volt (`ground` `#06110b`, `surface` `#0d1c14`, `surface-raised` `#13241b`). Popovers such as `Menu` use `surface-raised`. | design-system §2.1 |

## 6. Shared primitives

| Need | Use | Not |
|---|---|---|
| Any menu | `Menu` (menu button pattern: Enter, Space and arrows open, arrows, Home, End and a letter move, Escape returns focus, roving tabindex, disabled items reachable with a reason) | A hand-rolled `role="menu"` |
| A list | `DataTable` with `rowLabel`, `bulkActions`, `rowActions`, `rowHref` or `onRowActivate`, `Pagination` | A page-local table with its own checkboxes |
| A lifecycle change | `StateChangeMenu` with the screen's allowed transitions | Buttons per state, `window.confirm` |
| A confirmation | `ConfirmDialog` (`irreversible` for alertdialog) or `StateChangeDialog` | "OK" and "Cancel" only |
| A bulk action | `BulkActionDialog`: the count in the title ("Retire 3 devices?"), one reason or required steps for every row, the single-row endpoint run in sequence (`runInSequence`), then a toast when all succeeded or a summary dialog listing each failed row with the server's message (W29) | A bulk endpoint the API does not have; a silent partial failure |
| Feedback after an action | `useToast().show(message, { tone, action })` | An alert for a success |

`AccountMenu` is a `Menu` since 2026-11-02: the profile block sits in its `header` slot (read-only text above
the items, no menuitem), and `ChangePasswordDialog` is a `Dialog` that asks in a `ConfirmDialog` before
discarding filled fields. No `window.confirm` is left in `src`.

## 7. Viewport (W24, leader 2026-11-05)

Binding UX rule of the project (leader, 2026-11-05, 13:05 and 13:45; chapter 06 §11.1 after
treklink-docs#169 and #170): a screen never scrolls by itself. Only nested elements that need it
scroll: a list, a table, the details pane, a long form body, a log. Everything of the main screen sits
within the viewport at every width. On wide pages (devices, incidents, contracts, invoices) only the
data table scrolls.

| Rule | Check | Built in |
|---|---|---|
| The document and `body` never scroll. The app shell is fixed to the dynamic viewport (`h-dvh`) at every width. | On every route, `document.scrollingElement`: `scrollHeight <= clientHeight + 1` and `scrollWidth <= clientWidth + 1`. | `AppShell`, `AuthLayout` |
| The content area (`#main`) is not a scroll region. Every page is a fit page: its root carries `data-fit-page` and `flex min-h-0 flex-1 flex-col` and takes exactly the content area, so the incident banner, the app header, the phone tab bar, the page header, the command bar, the bulk bar, the pager and the page action bar never scroll away. | On every route, `#main` and the document: `scrollHeight <= clientHeight + 1` and `scrollWidth <= clientWidth + 1`. | `AppShell`, every page root |
| The nested scroll region is named per page type. **List page** (devices, incidents, contracts, invoices, every CollectionView list): the table box scrolls inside itself with its header row pinned (`thead` sticky); on a phone the card or row list scrolls; the details pane scrolls inside itself. A CollectionView fills only as a direct child of a `data-fit-page` element (the page root, or a `TabPanel` with `fill`); elsewhere it keeps its natural height. **Detail page** (contract home, device, incident, invoice): the record body is a `PageScrollBody` between the header (with the sections row) and the action bar. **Form page** (contract request, counter handover): the form body is a `PageScrollBody` between the title or stepper and the action bar. **Signed-out page** (public layout, `AuthLayout`): the page root fills `main`; `/register` keeps its title and the Register button in the card and scrolls the fields between them, `/plans` keeps its title and actions and scrolls the plans and prices, `/sign-in` scrolls its body (the form and the test accounts) only when they do not fit. **Page with several lists** (parameters, sync status, prices, reports, health, telemetry, the organization overview, stock-take, the roster): the body under the header and toolbar is a `PageScrollBody`. **Full-bleed page**: below. | Scroll each nested region to its end: the `h1` and any `[data-page-actions]` bar stay inside the viewport and `#main` keeps `scrollTop` 0. | `CollectionView` (`cv-fill-root:` and `cv-fill:` variants), `TabPanel fill`, `PageScrollBody` |
| A block above a list that would leave the list no room folds on a short screen (below 1280 by 800 CSS px, the `roomy:` variant): the filter cards of the change log and the sign-in events and the Field Station software card of `/o/field-stations` become a closed disclosure (a button with `aria-expanded`, the state or a summary in its text); opened, the block scrolls inside itself at most 40 to 45 % of the viewport high. Under 640 CSS px high (and above the 400 % release) a page header drops its description. Leader ruling pending, applied as recommended from 18:15 (W24b). | Folded, `#main` keeps `scrollHeight <= clientHeight + 1` at 320 by 568 and 900 by 800. | `AuditLogPage`, `AuthEventsPage`, `FieldStationsPage` `ReleaseCard`, `PageHeader` |
| One scroll region per area and axis. No vertical scroll region inside another one that also scrolls (double scrollbars); a table scrolls sideways inside its own box only. A list and the open record beside it (the Staff incident queue, the billing invoice tab, the organization review) each scroll inside themselves; where they stack below 1024 or 1280 px, their shared body is the one region. | An overflowing scroll region with an overflowing vertical scroll region inside it is an offender. | `AppShell`, `DataTable`, `CollectionView` |
| A full-bleed page (live map `/o/map`, fleet map `/t/map`) fits the content area exactly: the map fills the remaining space, the device list scrolls inside itself (side panel from 1024 px, a panel under the map below that, screen 9.1). | `#main`: `scrollHeight <= clientHeight + 1` at every width. | `LiveMapPage` layout containers |
| No scroll jump on load, on selection or when a pane opens; no content hidden behind a sticky bar; every scroll region can be scrolled to its end. | Scroll each region to its end; the last item is fully visible above any sticky bar. | `StickyPageHeader` (height reserve), `scroll-padding` on `#main` |
| A visually hidden (`sr-only`) element is absolutely positioned: every scroll region and `main` is a positioned ancestor (`relative`), or the hidden element escapes the region and makes the document or `#main` scroll (found on `/register` and the map panel, W24). | No descendant of a region ends below the region when the region does not overflow. | `AppShell`, `AuthLayout`, `LiveMapPage` panel |
| A scroll region with no focusable child takes `tabindex="0"` and an accessible name, so a keyboard user can scroll it (WCAG 2.1.1). | Every overflowing region has a focusable descendant, or `tabindex="0"` plus `aria-label` or `aria-labelledby`. | `useScrollStop` (CollectionView item box, `PageScrollBody`), `ScrollStrip`, `LiveMapPage` device list |
| At 400 % zoom (about 318 by 236 CSS px) the fixed bars may release and the document scroll (WCAG 1.4.10 allows it; pinned bars would leave no room for content). TrekLink releases them below a viewport height of 480 CSS px. | At 318 by 236 the content is reachable by scrolling and nothing is clipped. | `AppShell` (`max-height` media query) |

The visual check of every screen change (UI quality gate, leader 2026-11-05) runs at 1440, 1280, 900,
360 and 320 CSS px and at 400 % zoom (318 by 236), in both themes, and measures the document and
`#main` as above. A route where `#main` still scrolls is listed as not done, with its reason, never
as compliant (W24b).

## CollectionView details (D-096, 2026-11-04)

Added by KhoaDD with the CollectionView rollout (chapter 06 §9 and §10, `docs/design/2026-11-03-collectionview-and-layout.md`):

| Rule | Built in |
|---|---|
| A badge holds one or two words; a date, an amount or a time goes after it as muted text ("Revoked" then the date). | `Badge` and `StatusBadge` `after` |
| A list of one or two records with nothing narrowed hides its command bar and its checkboxes; its item actions stay. A list whose default filter narrows it (open incidents, active members, the Requested queue) keeps the bar. | `CollectionView`, `hideCommandBar` |
| A row that does not fit scrolls sideways with fading edges and arrow buttons that stay out of the tab order; a strip with no focusable item takes a name and a tab stop while it overflows. Exception (W20B, 2026-11-05): the contract home sections, the return counter steps and the lifecycle strip wrap onto more rows instead, so every tab stays in view at 360 px and no fading edge covers a word. The handover steps of `CounterPage` are a grid and do not scroll. | `ScrollStrip`, `Tabs`, the Details table; wrapping: `ContractActionBar`, `ReturnCounter`, `LifecycleCard` |
| A page with several related lists names one `CollectionPaneHost`; one details pane sits beside all of them. A page with a richer record view of its own opens it from Show details. | `CollectionPaneHost`, `onShowDetails` |


## 8. Sorting, the status control and item actions (chapter 06 §11, 2026-11-05)

Added by KhoaDD under D-078 for W25, after the leader's staging walk (chapter 06 §11.2 to §11.4)
and the revision of treklink-docs#170.

### 8.1 Sort from the column header (§11.2)

| Rule | Built in |
|---|---|
| Every sortable column header is a button. A click cycles ascending, descending, then the list's default order. A column that is itself the default order (the received time of the sync ledger) toggles only its two directions. | `CollectionView` `defaultSort`, `nextSort` |
| Only the sorted column carries `aria-sort`; an arrow shows its direction. An unsorted sortable column shows a neutral two-way icon of a different shape, so the arrow of the sorted one stands out. | `CollectionView`, `DataTable` |
| The change is announced in the collection's live region ("Sorted by Received, ascending", "Sorted by Default order") and clears the selection. | `CollectionView` |
| A sort change returns a paged list to page 1. | the page's `onQueryChange` |
| The Sort dropdown of the command bar offers the same orders, plus Default order, for the phone and card views. | `CollectionView` |
| A server-paged list marks a column sortable only when its endpoint takes a sort for it. It never sorts one page on the client. On 2026-11-05 only the sync ledger's `order` exists (gateway-sync api-design 03); the other server-paged lists have no sortable column until their endpoints take a sort. | page field definitions |

### 8.2 The status is the state-change control (§11.3)

| Rule | Built in |
|---|---|
| A list has no separate Status change column. The status cell shows the status badge. | `CollectionView` `status` |
| When the user may change the item's state, the badge is the menu button: `aria-haspopup="menu"`, `aria-expanded`, the visible status text, a chevron, and an accessible name that starts with that text ("Active, change status of TL-0042", WCAG 2.5.3). | `StatusBadgeMenu` |
| The interactive badge is its own variant: a visible edge of at least 3:1 against the row, the chevron, and a target of at least 24 by 24 CSS px (2.5.8). A plain badge stays smaller, because it is not a target. | `StatusBadgeMenu` |
| The menu opens on only the allowed transitions; destructive ones come last after a separator; choosing one opens the confirmation dialog of §3. Escape returns focus to the badge. | `StatusBadgeMenu`, `Menu` |
| Without an allowed transition the badge has no chevron and is not a button. | `CollectionView` |
| While a selection exists the badge menu is disabled; the Change status menu of the command bar acts on the selection. | `CollectionView` |
| On phones the badge menu stays on the row; the row's Actions dropdown holds no "Change status:" items. | `CollectionView` |

### 8.3 Per-item actions keep their place (§11.4)

| Rule | Built in |
|---|---|
| The actions column is right-aligned. Slots are fixed per list and fill from the inline end by permanence: Show details is last in tab order at the inline end; when the list has three or more other action slots, they all sit in one overflow menu ("More actions for TL-0042") in the slot next to it; with one or two, they show as icon buttons to its left, in the page's list order. A page adds a new action at the start of its list, so it joins at the inline start. | `CollectionView` `itemActions` |
| An action unavailable in an item's current state keeps its slot, disabled with its reason (`unavailableReason`, or "Not available for this {noun} now." when the page gives none). An action no shown item may take, because the role never has it, is absent for the whole list. | `CollectionAction` `allowed`, `unavailableReason` |
| Two actions that never apply to the same item (Deactivate, Reactivate) share one slot, so the row shows the one its item may take. | `CollectionAction` `slot` |
| A missing action leaves no gap: the slots are the same on every row of the list. | `CollectionView` |

### 8.4 Viewport and zoom (chapter 06 §10, revised by treklink-docs#170)

| Rule | Built in |
|---|---|
| The document does not scroll: `scrollHeight <= clientHeight + 1` and `scrollWidth <= clientWidth + 1` on `document.scrollingElement`. The shell uses `dvh` at every width. `#main` does not scroll either; the nested scroll region of each page type is named in §7. | `AppShell` (W24, W24b) |
| A scroll region with no focusable child takes `tabindex="0"` and an accessible name. | `ScrollStrip`, table boxes |
| At 400 % zoom (about 318 by 236 CSS px) the fixed bars may release and the document may scroll. The visual check includes this case. | `AppShell` (W24) |
| Select-all uses the native `indeterminate` property, never `aria-checked`. | `DataTable`, `CollectionView` |
