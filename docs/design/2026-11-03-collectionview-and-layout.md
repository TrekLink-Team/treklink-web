# Contract home and device screens: conventions to build to (2026-11-03)

The text of treklink-docs#158 (decision D-096), chapter 06 §9 CollectionView and §10 page layout, plus the leader rulings. It is the convention source until that PR merges into treklink-docs. The visual reference is the Claude Design canvas "Contract Home" (https://claude.ai/artifact/RxCRxRvQPbY3jN4RS29wWY), a style reference only: business logic comes from the module specs.

---

## 9. CollectionView: One Module Renders Every List of Records (D-096)

Every list of records (devices, contracts, invoices, members, maintenance jobs, audit entries) renders through one shared module, `CollectionView`, in `shared/ui/collection-view/`. It is a library component: it knows nothing about a module, an endpoint or the server's result set. A page supplies the data, the fields and the actions; a page never builds its own table, card grid, selection logic or toolbar. §4 Pattern A is the Details view of this module. Page layout around it is §10.

### 9.1 What a page supplies

| Input | Content |
|---|---|
| `items` | The current page of a TanStack Query result, paged by the server (§8.4) |
| `fields` | Key, label, renderer, `sortable`, `hideWithPane` (§10.8), and which fields the compact views show |
| `itemName` | The text that names one item in accessible names and confirmations ("TL-0042") |
| `itemActions` | Plain per-item actions: icon, label, handler, permission |
| `transitions` | The allowed state transitions per item, from the module spec's state machine (D-030), filtered by the caller's CASL abilities |
| `bulkActions` | Actions that apply to a selection |
| `views`, `defaultView` | The views this collection offers |
| `details` | The fields, image slot and links the details pane shows (§9.8) |
| `emptyState` | Message and call to action (§4 Pattern A) |

### 9.2 Views

| View | Layout | Markup |
|---|---|---|
| Details | Table, one column per field | Native `<table>`, `<caption>` with the collection name, `<th scope="col">` |
| List | One line per item | `<ul>` of `<li>` |
| Grid | Dense tiles | `<ul>` of `<li>` |
| Small, Medium, Large cards | Cards of three sizes | `<ul>` of `<li>`, each card titled by a heading with the item name |

The Details view is a native table. It becomes an ARIA `grid` only if the full grid keyboard model is built.

The view switcher is one split button, never a row of icon buttons (§10.2): the icon button shows the current view and switches to the next one on click (its name says both, "View: Details list. Switch to List"); the chevron button beside it opens the menu of all views. Each menu item carries the view icon and name, and the current one says "(current)" in its text, so the state is not shown by an icon alone (1.4.1). Filter and Sort follow the same pattern ("Show: <filter>", "Sort: <order>"). Switching view keeps the selection, the search, the filter and the sort.

### 9.3 Command bar

Exactly one row above the items at 1280 px (52 px high), sticky at the top of the collection. A second row is not allowed: what does not fit becomes a dropdown (§10.2). Left to right:

1. **Select-all checkbox**, tri-state (§9.4).
2. **Commands**: with no selection, the collection commands (Register device, Export); with a selection, the bulk actions, named verb plus count ("Check in 3 units").
3. **Selection count**: "3 selected" and a Clear selection button, shown only while items are selected.
4. **Search** field with a visible label or a programmatic name ("Search devices"); a placeholder is never the only label (§3).
5. **Show (filter), Sort, View** dropdowns and the Details pane toggle (`aria-pressed`), right-aligned. The result count is in the Show dropdown text and in the collection's live region; while a search is active a short visible "N match" appears next to the field.

Command buttons may show a short visible label ("Live map") when their accessible name is longer ("Show 3 units on live map"); the visible label appears inside the name (2.5.3).

- The bar is a `role="group"` with an `aria-label`, not a `role="toolbar"` unless Arrow-key navigation is built across all its controls (4.1.2).
- The select-all checkbox, the Clear selection button and the search field are tab stops of their own; the search field stays outside any toolbar because Left and Right Arrow edit its text.
- A list with nothing to filter, sort or switch (one or two records, such as a contract's invoices) hides its command bar; its item actions stay.
- At phone width the bar stays one row (§10.5).

### 9.4 Selection

1. Every item has a checkbox named "Select <itemName>".
2. Click or Space toggles one item and sets the range anchor. Shift+click and Shift+Space select every item from the anchor to this one.
3. The select-all checkbox selects **the items on the current page only**, never the server's matches across pages: the module holds no knowledge of the result set beyond the page it was given (leader, 2026-11-03). It shows checked, unchecked or mixed (`aria-checked="mixed"`).
4. **A search, filter or sort change clears the selection** and the live region says "Selection cleared" (leader, 2026-11-03), so a bulk action never acts on items the user can no longer see. A view change keeps it (§9.2).
5. Escape clears the selection when no tooltip, menu or dialog is open. Escape always closes the innermost open layer first: tooltip, then menu, then dialog, then selection.
6. Bulk actions are named verb plus count plus noun ("Check in 3 units", "Retire 2 devices"). The accessible name is the same text.
7. Selection never requires dragging: no drag-to-select, and no drag reorder without an equivalent button (2.5.7).

### 9.5 Per-item actions and tooltips

Per-item actions are visible on every item in every view; they are never revealed on hover only. Show details (an Info icon) is the first action of every item (§9.8).

A plain action is an icon button:

- Its tooltip text is the verb ("Edit"). Its accessible name starts with the same text and adds the item ("Edit TL-0042"), so the name contains the visible label (2.5.3).
- The tooltip appears on pointer hover **and** on keyboard focus, stays while the pointer moves onto it, stays until hover and focus leave, and closes on Escape without moving focus (1.4.13). It is `role="tooltip"`.
- The native `title` attribute alone is not acceptable: it does not show on keyboard focus or touch and cannot be dismissed. Do not combine `title` with this tooltip.

### 9.6 State transitions

A state-machine transition (Active to Inactive, In Field to Return Due) is chosen from a Change status dropdown on the item:

1. A menu button (`aria-haspopup="menu"`, `aria-expanded`) whose visible text includes the current status as text (§8.3).
2. The menu lists only the transitions allowed from the current state for this user. Transitions that are not allowed are absent.
3. Destructive transitions come last, after a separator, named as verbs ("Retire device").
4. Menu keyboard: Enter, Space or Down Arrow opens and focuses the first item; Up and Down Arrow move; Home and End jump; Escape closes and returns focus to the menu button.
5. Choosing a transition opens a confirmation dialog (§8.1): the title names the object and the change ("Mark TL-0042 inactive?"), the confirm button repeats the verb, and initial focus is on Cancel for a destructive transition. On close, focus returns to the menu button, or to the next item if the item has left the result set.
6. In the bulk commands, the transition menu lists only transitions allowed for every selected item.

### 9.7 Accessibility contract

| Requirement | WCAG 2.2 |
|---|---|
| Toggle buttons expose `aria-pressed`; menus, menu buttons, checkboxes and dialogs expose role, name and state | 4.1.2 Name, Role, Value |
| Dropdowns are menu buttons: Enter, Space and Down Arrow open, Arrow keys move, Escape closes and returns focus to the button | 2.1.1 Keyboard |
| Primary controls are at least 44 by 44 CSS px; every other target at least 24 by 24 (§5 item 8) | 2.5.8 Target Size (Minimum) |
| A sortable column header is a `<button>` inside the `<th>`; the sorted column carries `aria-sort="ascending"` or `"descending"`, the others carry none | 1.3.1, 4.1.2 |
| Selection count, result count, sort and page changes are announced through one polite live region per collection, present in the DOM before its first message ("3 selected", "57 devices, showing 1 to 20", "Sorted by Last seen, descending"); search announcements are debounced | 4.1.3 Status Messages |
| Focus is visible (§5 item 6) and never hidden behind the sticky command bar or the incident banner: the scroll container sets `scroll-padding-top` to their combined height | 2.4.7, 2.4.11 Focus Not Obscured (Minimum) |
| Status is shown as text in every view, never by colour alone; text on a coloured badge meets 4.5:1 | 1.4.1, 1.4.3 |
| Tooltips follow §9.5 | 1.4.13 |
| At 320 CSS px, every view reflows without horizontal page scroll; the Details view scrolls inside its own region with the hints of §10.6 | 1.4.10 Reflow |

### 9.8 Details pane

One shared pane in `CollectionView`. Every item offers Show details (first in its actions, and first in the phone Actions menu), and the command bar has a Details pane toggle with `aria-pressed`. The pane shows the item's fields, its image slot where the record has one, every item action as a labelled button with any unavailable reason as text, the Change status dropdown, and a link to the full page. Where it sits on each width is §10.8.

---

## 10. Page Layout (D-096)

These rules apply to every working page, not only to lists.

### 10.1 Vertical space first

Vertical space decides how much content a person sees at once, so it outranks every other layout concern on a working page.

1. Page chrome above the first item (header, lifecycle, action bar, tabs, command bar) is measured and kept to the minimum; each block states its height in the design.
2. A control set that would wrap to a second line becomes a dropdown or moves into a More menu; it never adds a row (§10.2).
3. One sticky bar per scroll context where possible. When two are needed (page action bar and collection command bar), the page sets `scroll-padding-top` to their combined height so a focused item is never hidden under them (2.4.11).
4. Density never breaks a WCAG floor: targets stay at least 24 by 24 px and primary controls 44 px (§5 item 8); text stays at the type scale; reflow at 320 CSS px still works (1.4.10).

### 10.2 Dropdowns instead of a second row

Control sets that would take a second row become dropdowns. First application: the six view icons became one split View button (§9.2), and the command bar fits one row.

### 10.3 Dropdown buttons show a chevron

Every menu button (More actions, Change status, Show, Sort, the View chevron) shows a chevron-down icon to the right of its label as the hint that it opens a list. The icon is decorative (`aria-hidden`); the button keeps `aria-haspopup="menu"` and `aria-expanded`, opens on Enter, Space and Down Arrow, and closes on Escape with focus back on the button. Plain command buttons and icon buttons carry no chevron, so the chevron always means "opens a list". `Menu` in `shared/ui` draws the chevron itself, and `StateChangeMenu` takes it too, so pages do not repeat a workaround.

### 10.4 Compact record pages

Page chrome on record pages (contracts first) is compact: breadcrumb, title, status and deadline in about 60 px; the lifecycle strip and Next step in one card of about 44 to 80 px; tabs and the record's actions share one sticky row. Plain actions in command bars and on items are icon buttons with an accessible name and the tooltip of §9.5; state-machine transitions are a Change status dropdown (§9.6).

### 10.5 Phone layout (360 px)

On record pages: tabs pinned at the top in one row (they scroll sideways when they do not fit, §10.6); the page's actions sit in a bar pinned to the bottom, primary action widest, More actions beside it, a disabled action's reason on its own line above; the lifecycle collapses to one line ("Step 3 of 7: Active, since 10 Nov") with a disclosure that opens the full list; figures shown as stat cards on desktop become one compact definition list. The page sets `scroll-padding-top` and `scroll-padding-bottom` to the pinned bars' heights so a focused control is never hidden under them (2.4.11).

In `CollectionView` at phone width the command bar keeps one row (the select-all checkbox, a Search icon button that opens the field in place, a Sort dropdown that also holds the Show filters, the split View button); with a selection it shows the count and one Actions dropdown holding the bulk actions and status changes; each item's icon actions and Change status collapse into one Actions dropdown, status changes prefixed "Change status:", destructive ones last; the default view is List.

### 10.6 Sideways scroll strips

1. Any strip that scrolls sideways (tabs on a phone, a wide Details table, a chip or step row) shows, on each side that has more content, a fading edge from the surface colour and an arrow button (chevron, 32 by 44 px) that scrolls about 70 % of the visible width. The hints appear and disappear with the scroll position. The selected tab is scrolled into view on load. Scrolling is instant when the user asks for reduced motion (2.3.3).
2. The arrows are pointer aids, kept out of the tab order and hidden from screen readers: keyboard users reach every item with Tab or Arrow keys and the focused item scrolls into view (2.1.1, 1.4.10).
3. A strip that holds no focusable item (the lifecycle strip, a stepper) takes `tabindex="0"` and an accessible name while it overflows, so keyboard users can scroll it (2.1.1); it leaves the tab order when everything fits.
4. Every scroll strip is `position: relative`, so absolutely positioned descendants such as visually hidden text stay inside it; without that they widened the 360 px page and broke reflow (1.4.10).

### 10.7 Target size

Checkboxes are 24 by 24 px inside a 36 to 44 px label; a standalone link (an asset tag, an invoice number, Back to overview) is `inline-flex` with a 24 px minimum height (2.5.8). Links inside a sentence are exempt.

### 10.8 Details pane placement

The pane of §9.8 adapts to the window: from 1100 px it is a non-modal `aside` pushed aside beside the list (focus moves to its heading; Escape or the close button closes it); from 600 px the design system's `Drawer` from the right, over the page; below 600 px the same `Drawer` as a bottom sheet. Both drawers trap focus and return it on close.

While the pane is pushed aside, rows never scroll sideways and show no scroll hints: columns the pane already shows are marked `hideWithPane` and leave the table, and the Status change column leaves too, because the pane holds that dropdown. A `hideWithPane` column also leaves when a laptop-width list column is narrower than 1100 px (a CSS container query, so it needs no component state). When a page has several related lists (Money: Invoices and Payments), the page names one container as `paneHost`: the pane sits beside all of them and every list in it fits the narrower width.
