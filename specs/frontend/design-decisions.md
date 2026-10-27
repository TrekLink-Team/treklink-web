# TrekLink frontend design decisions log

Decisions taken with the team lead for the frontend theme, styling and conventions. Each entry is
final unless a later entry replaces it. This file ships as a convention in the repository.

## DS-01 Scope: the theme is the base for the whole codebase

The work is the reusable styling foundation for the whole frontend: tokens, theme, component
primitives, app shell and conventions. Every later page builds on it, so it is built as a long-term
base, not a one-off look.

## DS-02 Two themes: light and dark

Both a light and a dark theme are first-class. Both are designed, tokenised and tested; neither is
derived automatically from the other. The user can choose either, and the default follows the
operating system (`prefers-color-scheme`).

## DS-03 Accessibility target: WCAG 2.2 level AA

Every pairing is computed, not assumed. Minimums: body text 4.5:1, large text 3:1, UI component
boundaries and graphics 3:1 (1.4.11), focus indicator visible and not obscured (2.4.7, 2.4.11),
target size at least 24 by 24 CSS px (2.5.8), no information by colour alone (1.4.1). Text on glass
is checked against the worst-case backdrop, not the average one.

## DS-04 Lineage: inherits TrekLink, more vibrant, green-led

The new system descends from the landing site's TrekLink style (dark ground, glass panels, textured
background, hard geometry) but is more vibrant and harmonised around green. The brass and brown of
the landing site are dropped. Green is the key colour in both themes.

## DS-05 60/30/10 colour rule

60 % neutral ground (green-tinted neutrals: page, cards, tables), 30 % secondary (green-tinted
chrome: header, sidebars, toolbar, selected rows), 10 % accent (primary actions, focus ring,
active navigation, key highlights). Status colours sit outside this budget.

## DS-06 A separate status colour system: "TrekLink System Colors"

Status and alert colours form their own system, separate from the brand palette. Status hues stay
outside the green band (roughly OKLCH hue 100 to 190), so an SOS or an overdue contract never reads
as decoration or as brand. Every status shows a text label as well as colour.

## DS-07 Surfaces: glass chrome, solid data

Header, both sidebars, toolbar and floating overlays use glass or liquid glass. Tables, forms and
long text sit on near-solid surfaces so their contrast never depends on what is behind them.
Neumorphic press and extrusion are used only on buttons, toggles and segmented controls.

## DS-08 Layout: header, two collapsible sidebars, toolbar, body

The core layout is a header, a left sidebar (navigation), a right sidebar (contextual panel), a
toolbar above the body, and the body. Both sidebars collapse. The exact content of the right
sidebar is decided later; its slot is part of the core layout.

## DS-09 Typefaces: replace Oswald

Oswald is not used system-wide. New serif, sans-serif and monospace families are chosen. Each must
be modern, legible, variable where possible, and cover English and Vietnamese (full diacritics).

## DS-10 Colour direction: green and blue harmony, one key per theme

Dark theme: Volt Trail (chartreuse-lime brand on a cool green-black ground, lime accent).
Light theme: Jade Canopy or Lagoon Ops (final pick open, see below). Blue joins the brand side as
atmosphere only: background glows, a slight blue lean in the chrome tint, and the dark theme's
highlight chip. Blue never marks a status on the brand side.

## DS-12 Status wheel v2: six tones, Done is a highlighted positive

Status hues are spread about 50 degrees apart, outside the brand green band:
Critical 27, Attention 70, Done 212 (cyan), Active 268 (cobalt), Waiting 318 (orchid), Ended
(grey). Critical and Attention are the centre of the product and carry the most visual weight.
Done is a good outcome and stays visible: a bright cyan, solid in dark mode, never grey. Grey is
reserved for Ended (retired, cancelled, false alarm): states the user can ignore. Every tone
always pairs colour with a glyph and a text label.

## D-10a Light key colour: "Canopy", hue 170

The light theme uses a green tuned halfway between Jade (163) and Lagoon (176): brand text
`#027258`, primary fill `#077e62` with white text (5.0:1), chrome tint `#c6f1e9`. Dark stays Volt:
brand `#7ecd06`, primary fill `#9ff440` with dark text (7.0:1). Every pairing was recomputed with
the palette script; text on glass is checked over the brightest glow (light 12.4:1 body, 5.2:1
muted; dark 11.4:1 and 5.3:1).

## D-12a Status badge hierarchy (locked with DS-12)

Weight follows importance. Critical and Done are solid fills in both themes (Critical because the
system exists to resolve it, Done because a good outcome should stand out). Attention, Active and
Waiting are tinted with a 1 px border in their own hue (3:1 against the surface), so a badge never
merges into the green chrome. Ended is a ghost outline in grey. In light mode Done is a deep cyan
fill `#077492` with white text (5.3:1), and the fill itself is 5.3:1 against the surface, so the
badge edge reads clearly. (Revised: the earlier bright fill `#00b2ca` had readable text but only
2.5:1 against the white surface, so the badge looked washed out.) In dark mode Done stays
`#09bfd9` with dark text (6.1:1, fill 7.9:1 on the surface).

## DS-13 Shell layout (approved 2026-10-27)

- Left panel: navigation between business modules, grouped (Operate, Business, Organization,
  Administration). Expanded on desktop, icon rail when collapsed or on tablet, drawer plus a
  bottom tab bar on phone (the team lead kept the tab bar).
- Right panel: the Info pane for whatever is selected in the body, like a file manager's details
  pane (properties, lifecycle, tabs for Activity and related items, actions at the foot). With
  nothing selected it shows a summary of the page. Docked from 1280 px; below that it slides over
  the body as a sheet, closed until the user asks (the team lead kept the overlay). Toggled from the
  toolbar's info button.
- Map pages have no right panel: the map spans the rest of the width. The incident queue floats
  inside the map; the toolbar's info button is shown disabled so the toolbar stays identical.
- Every page uses the same rows in the same order: alert banner, header, breadcrumb and title with
  the primary action top right, view tabs, toolbar, body.
- Toolbar: search and filters on the left, view tools on the right (refresh, columns, density,
  info). Selecting rows swaps the left side for the selection count and bulk actions; actions
  that do not apply stay visible but disabled, with the reason as a hint.
- Header: navigation toggle, mark, workspace (organization and code, or TrekLink), environment
  badge, Go to page (Ctrl K), live connection state, theme switch, account menu. See DS-16 for the
  items of the mockup that wait for an endpoint.
- The map keeps its current behaviour for the Hoàng Sa and Trường Sa overlay; no inset map is
  added (team lead, 2026-10-27).

## DS-11 Typefaces: hybrid

Plus Jakarta Sans for page titles, KPI values, empty states and the wordmark. Inter for every UI
and data string (tables, forms, navigation, body). Geist Mono for codes, IDs, coordinates and
timestamps. Fraunces is available as an optional serif for long-form reading only. All four ship a
Vietnamese subset and are variable fonts, verified in the Fontsource packages on 2026-10-27.

## DS-14 Fonts are self-hosted

Inter, Plus Jakarta Sans and Geist Mono load from the `@fontsource-variable` packages, bundled by
Vite, instead of a font CDN: no third-party request at runtime, and the Vietnamese subsets ship
with the app. Each family is one variable file per subset, selected by `unicode-range`.

## DS-15 Legacy colour names follow the theme

The first pages use Tailwind palette names (`bg-white`, `text-slate-600`, `bg-blue-700`). Instead
of editing every page, `tailwind.config.js` maps exactly the shades in use to theme variables,
covered by the contrast test. The layer is deprecated; pages drop it when next edited.

## DS-16 Header items that wait for an endpoint

The mockup showed a global record search, a notifications bell and a help button. The handoff allowed
no new API calls, so the shell ships "Go to page" (navigation search over the nav table, Ctrl K)
and leaves record search and notifications for the tasks that add their endpoints. The incident
banner already carries the alerts.

## DS-17 Workspace shown as text

An account belongs to one organization (`SessionUser.organization`), so the header shows the
workspace as text, not as a switcher. A switcher joins if multi-organization accounts are added.

## DS-18 The Info pane is opt-in per page

The shell shows the Info pane only when a page provides content with `useInfoPane`. Existing pages
do not yet, so they render without it; the design system page shows the behaviour.
