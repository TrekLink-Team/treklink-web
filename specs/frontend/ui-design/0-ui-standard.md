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
| 2.5.8 Target size (minimum) | Every pointer target is at least 24 by 24 CSS px. TrekLink: 44 px for primary touch targets (buttons `md`, form controls, menu items, dialog and toast buttons, filter chip remove through an inset pseudo-element); 24 px is the floor only for dense table controls (row checkbox hit area 40 px, sort buttons 32 px); the pagination buttons and the rows-per-page select are 44 px. | `buttonStyles.ts`, `DataTable`, `Menu`, `Toolbar.FilterChip` | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum |
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
| Selection survives paging and filtering. When the API gives a total and the whole page is selected, the bulk bar offers "Select all N results"; the bulk action then acts on the filter, not on a list of ids. | `DataTable` `totalCount`, `onSelectAllResults` | https://carbondesignsystem.com/components/data-table/usage/ |
| From the first selection a bulk bar shows the count (also announced through a status region), verb-plus-noun actions ("Retire 3 devices", never "Apply") and Clear selection. | `BulkBar`, `DataTable` `bulkActions` | https://carbondesignsystem.com/components/data-table/usage/ |
| Row actions are disabled while the bulk bar shows, with the reason "Clear the selection to use row actions." as their description. | `DataTable` | TrekLink, after Carbon batch actions |
| Fewer than three row actions show inline; three or more go into one overflow menu button with `aria-haspopup="menu"`, `aria-expanded` and a name ("Actions for TL-0042"). | `DataTable` `rowActions`, `Menu` | https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/ |
| Sortable headers are buttons; only the sorted column carries `aria-sort`. The server sorts. | `DataTable` | https://www.w3.org/WAI/ARIA/apg/patterns/table/ |
| A row opens through a real link (`rowHref`) or button (`onRowActivate`) in its activation column, so Enter works; a click anywhere on the row is a pointer shortcut only, never the only path. | `DataTable` | https://www.w3.org/WAI/ARIA/apg/patterns/table/ |
| Pagination sits at the bottom of the table with the range, the page size and previous and next. | `Pagination` | https://carbondesignsystem.com/components/pagination/usage/ |
| An empty result replaces the table with an `EmptyState` holding one next step. Skeleton rows show while loading. | `DataTable`, `EmptyState`, `Skeleton` | https://carbondesignsystem.com/components/data-table/usage/ |

## 3. State changes

| Rule | Built in | Source |
|---|---|---|
| A status shows as a text tag with a glyph or shape, never colour alone. | `StatusBadge` | https://design-system.service.gov.uk/components/tag/ |
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

The hand-rolled menu of `AccountMenu.tsx` mixes the profile block into the menu and moves to `Menu`
with W29.
