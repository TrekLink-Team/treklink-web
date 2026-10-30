# TrekLink System: design system of the web frontend

> Scope: `treklink-web` frontend, every page and widget. Binding rules are in
> [`treklink-docs/_docs/01-conventions/17-design-system-conventions.md`](treklink-docs/_docs/01-conventions/17-design-system-conventions.md);
> the decisions behind them are in [`design-decisions.md`](design-decisions.md).
> Status: handed back 2026-10-27 for review by the team lead.

## 1. Chosen direction and why

The TrekLink System descends from the landing site's TrekLink style (dark ground, glass panels over
texture, hard geometry) and changes three things the team lead asked for:

| Change | Reason |
|---|---|
| Two first-class themes: **Canopy** (light) and **Volt** (dark) | Light mode is required; operators work both in offices and outdoors. The default follows the operating system. |
| Green-led, harmonised with blue, more vibrant; brass and brown dropped | Team lead preference (DS-04, DS-10). Blue joins only as atmosphere: backdrop glows, a slight lean in the chrome tint, the dark highlight chip. |
| A separate status system, **TrekLink System Colors** | A status must never read as decoration, so no status uses the brand green band (DS-06, DS-12). |

Canopy uses a jade-teal key at OKLCH hue 170, halfway between the Jade and Lagoon candidates, tuned so
that the cyan Done tone stays apart from the brand. Volt uses a chartreuse-lime key on a cool
green-black ground. Oswald was dropped for system UI (DS-09): Plus Jakarta Sans carries titles and
figures, Inter carries interface and data, Geist Mono carries codes. All three are variable fonts
with a Vietnamese subset, self-hosted through Fontsource.

The candidates, the status wheel and the layout mockups the team lead reviewed are on the design
canvas "TrekLink System: colour directions" (claude.ai artifact, private to the team lead).

## 2. Colour: the 60 / 30 / 10 rule

| Share | Tokens | Where |
|---|---|---|
| 60 % | `ground`, `surface`, `sunken` | Page ground, cards, tables, forms (solid, so data contrast never depends on what is behind) |
| 30 % | `chrome`, glass over `surface` | Header, both sidebars, toolbar, selected rows, chips |
| 10 % | `accent`, `spark`, `brand`, `focus` | The one primary button, active navigation, links, focus ring |

Status colours sit outside this budget and appear only where a state is shown.

### 2.1 Semantic tokens

Defined once in `src/app/styles/tokens.css` as RGB channels, exposed to Tailwind in
`tailwind.config.js`: `bg-surface`, `text-ink`, `border-line-strong`, `bg-accent/80`.

| Token | Role | Canopy (light) | Volt (dark) |
|---|---|---|---|
| `ground` | Page ground (60 %) | `#effaf7` | `#06110b` |
| `surface` | Cards, tables, fields (60 %) | `#fafffe` | `#0d1c14` |
| `surface-raised` | Popovers on surface | `#ffffff` | `#13241b` |
| `sunken` | Table header, wells | `#e1f1ee` | `#030c07` |
| `chrome` | Chrome tint, selected rows (30 %) | `#c6f1e9` | `#122d19` |
| `chrome-strong` | Hover on chrome | `#a8e6d8` | `#1b3d23` |
| `ink` | Body and headings | `#152c28` | `#dcebe2` |
| `ink-muted` | Secondary text, placeholders | `#4e6662` | `#8fa498` |
| `ink-inverse` | Text on inverse | `#fafffe` | `#0d1c14` |
| `inverse` | Toast, tooltip | `#152c28` | `#dcebe2` |
| `line` | Decorative dividers | `#cadcd8` | `#25382e` |
| `line-strong` | Control edges (3:1) | `#7c9590` | `#5e6e64` |
| `brand` | Brand text, links | `#027258` | `#7ecd06` |
| `accent` | Primary fill (10 %) | `#077e62` | `#9ff440` |
| `accent-hover` | Primary hover | `#046b53` | `#b2ff6a` |
| `accent-pressed` | Primary pressed | `#035b46` | `#92de40` |
| `on-accent` | Text on accent | `#ffffff` | `#364b31` |
| `spark` | Active navigation, highlight chip (10 %) | `#b6f259` | `#004458` |
| `on-spark` | Text on spark | `#394d1a` | `#86ddfe` |
| `focus` | Focus ring | `#06775d` | `#9ff440` |
| `glow` | Backdrop glow | `#54d8b1` | `#23690d` |
| `glow-2` | Backdrop glow, blue | `#81cffc` | `#00537c` |
| `scrim` | Modal scrim (with alpha) | `#081613` | `#000000` |

### 2.2 TrekLink System Colors (status)

Six tones about 50 degrees apart on the hue wheel, outside the brand band (about hue 120 to 180):
Critical 27, Attention 70, Done 212, Active 268, Waiting 318, Ended grey.

| Tone | Part | Canopy (light) | Volt (dark) |
|---|---|---|---|
| critical | `tint` | `#fee7e4` | `#481b17` |
| critical | `fg` | `#cc151d` | `#ff655a` |
| critical | `line` | `#f84c45` | `#ff7f73` |
| critical | `strong` | `#cc151d` | `#ff7f73` |
| critical | `on-strong` | `#ffffff` | `#3a211e` |
| attention | `tint` | `#ffe9d1` | `#3f2501` |
| attention | `fg` | `#915b02` | `#d5890a` |
| attention | `line` | `#c17b05` | `#ea9602` |
| attention | `strong` | `#915b02` | `#ea9602` |
| attention | `on-strong` | `#ffffff` | `#382714` |
| active | `tint` | `#e5edff` | `#1c294e` |
| active | `fg` | `#415fcb` | `#7195fe` |
| active | `line` | `#6184f3` | `#87a7fe` |
| active | `strong` | `#415fcb` | `#87a7fe` |
| active | `on-strong` | `#ffffff` | `#232b40` |
| waiting | `tint` | `#f8e5ff` | `#391f42` |
| waiting | `fg` | `#8e4aa2` | `#c37dd9` |
| waiting | `line` | `#b56fca` | `#d28ae8` |
| waiting | `strong` | `#8e4aa2` | `#d28ae8` |
| waiting | `on-strong` | `#ffffff` | `#312236` |
| done | `tint` | `#bcf3ff` | `#003740` |
| done | `fg` | `#036f7f` | `#0db1c9` |
| done | `line` | `#0598ad` | `#09bfd9` |
| done | `strong` | `#077492` | `#09bfd9` |
| done | `on-strong` | `#ffffff` | `#123339` |
| ended | `tint` | `#f3ebe5` | `#302a25` |
| ended | `fg` | `#6c6560` | `#a09993` |
| ended | `line` | `#918984` | `#b1a9a3` |
| ended | `strong` | `#6c6560` | `#b1a9a3` |
| ended | `on-strong` | `#ffffff` | `#3c2818` |

Weight follows importance (D-12a):

| Treatment | Tones | Recipe |
|---|---|---|
| Solid fill | Critical, Done | `strong` fill, `on-strong` text, 1 px `fg` edge |
| Tint with border | Attention, Active, Waiting | `tint` fill, `fg` text, 1 px `line` border |
| Ghost outline | Ended | transparent, `fg` text, `line-strong` border |

Every badge carries a glyph (▲ ! ● ◷ ✓ ×, hidden from screen readers) and the human label, so the
state never depends on colour (convention 06 §8.3, WCAG 1.4.1).

### 2.3 Status palettes per lifecycle

Source: `src/shared/ui/status.ts`, enums of `backend/prisma/schema.prisma` on 2026-10-27.

| Lifecycle | Critical | Attention | Active | Waiting | Done | Ended |
|---|---|---|---|---|---|---|
| Device | Lost | Maintenance | Rented | In intake, Reserved, Returned (to inspect) | Available | Retired, Disposed |
| Contract | Overdue, Defaulted | Ending, Return due | Active | Requested, Approved | Returned, Closed | Rejected, Cancelled |
| Invoice | | Partly paid | Issued | | Paid | |
| Incident | Unrouted, Escalated | Notifying backup, Notifying manager, Reported to authority | Acknowledged, Responding | Detected, Notifying primary | Resolved, Closed | False alarm |

Incident confidence: **Confirmed** is a solid critical badge; **Suspected** is a dashed critical
outline with a question mark, so the two differ in shape and weight.

Live markers on the map keep fixed colours in both themes because the basemap tiles are light:
fresh is a blue circle with a white ring, attention an amber circle, stale a grey dashed circle with
the last-seen time beside it, SOS a red diamond with a pulsing ring (static under reduced motion).

### 2.4 Contrast, checked by a test

`src/app/styles/tokens.test.ts` reads `tokens.css` and fails `npm test` when any allowed pairing
drops below WCAG 2.2 AA: 4.5:1 for text, 3:1 for control edges, focus ring and status marks. Text
on glass is checked against the glass recipe over the brightest backdrop glow, with the sheen.

| Pair | Canopy | Volt | Needs |
|---|---|---|---|
| `ink` on `ground` | 13.84 | 15.58 | 4.5:1 |
| `ink` on `surface` | 14.62 | 14.27 | 4.5:1 |
| `ink` on `chrome` | 12.06 | 12.03 | 4.5:1 |
| `ink-muted` on `surface` | 6.12 | 6.65 | 4.5:1 |
| `ink-muted` on `chrome` | 5.05 | 5.60 | 4.5:1 |
| `brand` on `surface` | 5.86 | 8.90 | 4.5:1 |
| `on-accent` on `accent` | 5.04 | 7.02 | 4.5:1 |
| `on-spark` on `spark` | 7.04 | 7.01 | 4.5:1 |
| `ink-inverse` on `inverse` | 14.62 | 14.27 | 4.5:1 |
| `line-strong` on `surface` | 3.17 | 3.26 | 3:1 |
| `focus` on `surface` | 5.47 | 12.98 | 3:1 |
| critical text on tint | 4.81 | 5.03 | 4.5:1 |
| critical text on solid | 5.69 | 6.03 | 4.5:1 |
| attention text on tint | 4.82 | 5.02 | 4.5:1 |
| attention text on solid | 5.67 | 6.03 | 4.5:1 |
| active text on tint | 4.80 | 5.03 | 4.5:1 |
| active text on solid | 5.64 | 6.03 | 4.5:1 |
| waiting text on tint | 4.83 | 5.01 | 4.5:1 |
| waiting text on solid | 5.75 | 6.05 | 4.5:1 |
| done text on tint | 4.86 | 5.03 | 4.5:1 |
| done text on solid | 5.35 | 6.07 | 4.5:1 |
| ended text on tint | 4.86 | 5.04 | 4.5:1 |
| ended text on solid | 5.73 | 6.01 | 4.5:1 |

## 3. Type

| Style | Class | Family, size / line | Use |
|---|---|---|---|
| Display | `text-display` | Plus Jakarta Sans 32 / 40, 800 | Empty-state heroes, auth |
| Title large | `text-title-lg` | Plus Jakarta Sans 26 / 32, 800 | Page title (h1) |
| Title | `text-title` | Plus Jakarta Sans 22 / 28, 800 | Dialog title |
| Title small | `text-title-sm` | Plus Jakarta Sans 18 / 24, 700 | Card and section titles |
| KPI | `text-kpi` | Plus Jakarta Sans 28 / 34, 800, tabular | StatCard figure |
| Body large | `text-body-lg` | Inter 16 / 24 | Lead paragraphs |
| Body | `text-body` | Inter 14 / 22 | Default for UI and tables |
| Body small | `text-body-sm` | Inter 13 / 20 | Hints, secondary lines |
| Caption | `text-caption` | Inter 12 / 16 | Badges, meta |
| Label | `text-label uppercase` | Inter 11 / 16, 800, tracked 0.12em | Table headers, group labels |
| Mono | `font-mono` | Geist Mono | Codes, device IDs, coordinates, timestamps |

Prose stops at `max-w-measure` (62ch). Tailwind's `text-xs` to `text-2xl` stay for the first pages.

## 4. Space, shape, elevation, layers

| Family | Tokens |
|---|---|
| Spacing | Tailwind 4 px scale; shell sizes `h-header` 56, `w-nav` 232, `w-rail` 64, `w-info` 340, `min-h-tabbar` 64, `min-h-toolbar` 52 |
| Radius | `rounded-badge` 6, `rounded-control` 9 (buttons, fields), `rounded-card` 12, `rounded-panel` 14 (cards, panels), `rounded-sheet` 18 (dialogs, drawers) |
| Elevation | `shadow-raise` (secondary controls, cards), `shadow-press` (primary), `shadow-glass` (chrome), `shadow-overlay` (dialogs), `shadow-sheet` |
| Surfaces | `.tl-glass` (chrome), `.tl-glass-strong` (sheets), `.tl-backdrop` (page glows), `.tl-press` and `.tl-raise` (neumorphic controls) |
| Layers | `z-map` 0, `z-raised` 10, `z-sidebar` 30, `z-header` 40, `z-drawer` 50, `z-dialog` 60, `z-toast` 70, `z-banner` 80 |
| Motion | `duration-tl` 200 ms, `ease-tl`; everything drops to 0.01 ms under `prefers-reduced-motion` |

Glass falls back to the opaque surface under `prefers-reduced-transparency`, `prefers-contrast: more`
and in browsers without `backdrop-filter`. The Leaflet map is an isolated stacking context, so its
internal z-index of up to 1000 never rises over the shell.

## 5. App shell

```
+--------------------------------------------------------------------------+
| Incident banner (z-banner, never covered; overlays start below it)       |
+--------------------------------------------------------------------------+
| [=] Mark  Workspace CODE  [Sandbox]      [ Go to page  Ctrl K ]  Live ☾ AB |
+----------+-------------------------------------------------+-------------+
| Modules  | Breadcrumb (from the nav table)                 | Info pane   |
| (groups) | Title, meta                     [Sec] [Primary] | (selected   |
|          | View tabs                                       |  record)    |
|          | Toolbar: search, filters | view tools, (i)      |             |
|          | Body: solid data                                |             |
+----------+-------------------------------------------------+-------------+
```

| Width | Left panel | Right panel | Extra |
|---|---|---|---|
| 1280 px and up | Sidebar 232 px, collapsible to the 64 px rail (remembered) | Info pane docked, 340 px | |
| 1024 to 1279 px | Sidebar, collapsible | Info opens as a sheet over the body | |
| 768 to 1023 px | Icon rail; full drawer from the menu button | Sheet | |
| Below 768 px (360 px design width) | Drawer from the menu button or More | Sheet | Bottom tab bar with up to four modules and More |

Map routes (`fullBleed` in the nav table) drop the content padding and never show the Info pane;
`MapWorkspace` puts the incident queue beside the map from 1024 px and below it on smaller screens.

The Info pane works like a file manager's details pane: a page calls
`useInfoPane({ title, body, footer })` with the current selection, or a page summary, and the shell
places it. A row click calls `useOpenInfoPane()`. Below 1280 px the sheet stays closed until asked.

Header contents, left to right: navigation toggle, mark, workspace (organization name and code, or
TrekLink with Staff or Admin), environment badge (`VITE_APP_ENV`, unset means sandbox, production
hides it), Go to page (Ctrl K or /, searches page names and ignores Vietnamese diacritics), live
connection state (Live, Reconnecting, Offline), theme switch, account menu.

### 5.1 Adding a page to the navigation

1. Add the route in `app/router.tsx` with its guard.
2. In `shared/config/navigation.ts`, set `built: true` on its entry (or add the entry: route, label,
   lucide icon, roles, `fullBleed` for maps, `tabBar` order for the phone bar).
3. The sidebar, drawer, tab bar, breadcrumb and Go to page pick it up.

### 5.2 Sticky page chrome on long pages

Leader rule of 2026-10-30 (dry run defect 6): on every long page the title, breadcrumb and stepper stay
at the top and shrink when the content scrolls; the action bar (Back, Next, the primary action) stays
at the bottom; only the content scrolls.

```
+--------------------------------------------------+
| Breadcrumb                     (sticky, top 0)   |
| Title, meta              [badge]                 |  full height at rest,
| Description (hidden when compact)                |  compact after 24 px
| Stepper or step tabs                             |
+--------------------------------------------------+
| Content: the only part that scrolls              |
|                                                  |
+--------------------------------------------------+
| [Back]                  [Secondary] [Primary]    |  sticky, bottom 0,
+--------------------------------------------------+  above the phone tab bar
```

- `StickyPageHeader` wraps the `PageHeader` or `PageTitle`, a back link and the `Stepper` (or the step
  `Tabs`). It takes the shell's breadcrumb into itself while mounted. A one-pixel sentinel above it is
  watched by an `IntersectionObserver`; once it is `COMPACT_AFTER_PX` (24 px) out of view the region
  sets `data-compact="true"`, gets the `.tl-glass-strong` surface, and the shared components shrink
  through the `group/chrome` variants: title `text-title-sm`, description hidden, smaller step markers.
  Page-specific lines take `COMPACT_HIDDEN`. There is no scroll handler.
- While compact, a bottom margin on the header takes up the height it gave back, so the content does
  not jump and the page height stays the same; scroll anchoring is off in the content area while the
  header is mounted, because the anchoring correction otherwise flipped the header straight back to
  full height. The sentinel is absolutely placed, so the header is one item in a `gap` layout.
- `PageActionBar` is the last child of the page section, which is `flex flex-1 flex-col`: `start` holds
  Back, the children hold Next or the primary action, primary last. It is `sticky bottom-0` with
  `mt-auto`, so it sits at the bottom of the content area even when the content is short, and adds
  `env(safe-area-inset-bottom)` to its bottom padding. A submit button for a form in the content takes
  `form="<form id>"`.
- Both publish their height on the content area as `--tl-page-header-h` and `--tl-page-actions-h`. The
  shell turns them into `scroll-padding`, and a focus listener scrolls a control out from under either
  edge, so keyboard focus never lands under the header or the bar. A sticky side panel offsets its top
  with `top-[calc(var(--tl-page-header-h,0px)+1rem)]`.
- `Dialog`: the title and the `footer` stay in place and only the body scrolls. Long forms put their
  buttons in `footer`.
- Checked at 1280 and 360 px, in both themes, with the side navigation and the phone tab bar.

## 6. Components (`src/shared/ui`)

| Component | Use | Do | Don't |
|---|---|---|---|
| `Button` | Actions. `primary`, `secondary`, `ghost`, `danger`; `sm` 36, `md` 44, `lg` 48; `loading` | One primary per screen; `loading` while the server answers | Use a Button to navigate; use `buttonClasses` on a Link |
| `IconButton` | Icon-only actions | Always pass `label` (name and tooltip); `pressed` for toggles; `badge` for counts | Put text inside |
| `Field` | Label, hint, error, required mark | Labels above fields; link `aria-describedby` with `describedBy()` | Use the placeholder as the label |
| `Input`, `Select`, `Textarea` | Native controls in the system style | `invalid` with an error message | Build custom selects |
| `Checkbox`, `RadioGroup`, `Switch` | Choices | Switch for settings that apply at once; RadioGroup in a fieldset | Switch inside a form that needs Submit |
| `Badge`, `StatusBadge`, `ConfidenceBadge` | Labels and states | `StatusBadge entry={CONTRACT_STATUS[s]}` | Show a raw enum or colour alone |
| `Card`, `CardHeader` | Group one subject | Solid surface for data | Glass on data |
| `PageHeader`, `Breadcrumb` | Title, trail, primary action top right | Pass `breadcrumb` only outside the nav table | Two primary actions |
| `Tabs`, `TabPanel` | View switches inside a page | Counts in tabs; arrow keys work | Use tabs for navigation between modules |
| `Toolbar`, `ToolbarSearch`, `FilterChip` | Function bar above the body | Search and filters left, view tools right; `selection` for bulk actions | Move it between pages |
| `DataTable`, `Truncated`, `Pagination` | Pattern A lists | Server sort and paging; `rowActions` at the end; `renderCard` for phones; empty state with a next step | Client-sort a server page |
| `Dialog`, `ConfirmDialog` | Modal tasks and confirmations | Name the object: "Retire device TL-0042?"; Cancel first | Stack dialogs |
| `Drawer` | Navigation, Info sheet, bottom sheet | Escape and scrim close | Hold a long form |
| `Toast` (`useToast().show`) | Short success messages | One at a time | Errors that need action (use `Alert`) |
| `Alert` | Inline info, success, warning, error | One fixing action | Page-wide incident alerts (AlertBanner owns those) |
| `Stepper` | Multi-step forms | At most 4 steps of 6 fields | More steps |
| `StickyPageHeader`, `PageActionBar` | Long and multi-step pages (§5.2) | Title, breadcrumb and stepper in the header; Back left, primary right in the bar | Own sticky or fixed positioning on a page |
| `StatCard` | Dashboard KPIs | Real endpoint figures, formatted VND | Placeholder numbers in production |
| `EmptyState`, `Skeleton`, `SkeletonText` | Empty and loading | Explain the next step | A blank table |
| `MapLegend`, `MapPanel`, `MapWorkspace`, `markerIcon` | Map chrome | Shapes per state; queue beside the map | Cover the attribution or the sovereignty overlay |

The first pages keep importing `styles.ts` (`PRIMARY_BUTTON`, `INPUT`, `CARD`, `TABLE`, `TH`, `TD`,
`TAB`, ...) and `bits.tsx` (`Badge`, `PageTitle`, `Loading`, `Empty`, `ErrorState`, `Pager`,
`Field`, `Fact`). Both keep their names and props and now render the system.

## 7. Legacy compatibility layer

Pages written before the system used Tailwind colour names such as `bg-white`, `text-slate-600`,
`bg-blue-700`, `bg-emerald-50`. `tailwind.config.js` remaps a fixed list of shades (`white`, `slate`,
`blue`, `emerald`, `red`, `rose`, `amber`, `indigo`) to theme variables. A shade outside that list
keeps Tailwind's fixed value in both themes: `text-emerald-900` on the remapped `bg-emerald-50` was
dark text on a dark fill in Volt (dry run defect 2, 2026-10-30). The sweep of 2026-10-30 moved
`src/pages`, `src/widgets`, `src/features` and `src/entities` to the semantic names, `Alert` and
`Badge`, and `src/app/styles/rawPalette.test.ts` now fails `npm test` on any raw palette class in
those folders. The layer stays deprecated and remains only for `src/shared/ui`, which drops it when
next edited (convention 17 §4).

## 8. Verification

| Check | How |
|---|---|
| Contrast of every allowed pairing, both themes | `npm test` (tokens.test.ts) |
| No raw Tailwind palette class in pages, widgets, features, entities | `npm test` (rawPalette.test.ts) |
| Navigation per role, breadcrumb, Info pane rules, Tabs keys, ConfirmDialog focus | `npm test` (navigation.test.ts, components.test.tsx, AppShell.test.tsx) |
| axe-core, WCAG 2.0 to 2.2 A and AA rules | Run on contracts, billing, map, sign-in and the design system page, both themes, 1440 and 360 px: no violations (HANDBACK.md) |
| The design system page | `npm run dev`, then `/dev/design-system` (development builds only) |
