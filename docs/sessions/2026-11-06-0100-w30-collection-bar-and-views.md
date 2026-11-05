# 2026-11-06 01:00 (UTC+7): W30, the CollectionView command bar and the collection views

KhoaDD under D-078, branch `fix/collection-bar-and-views` from `origin/dev` at `340036fe` (with #397,
#398, #399). Frontend and screen specs. Leader's staging walk of 2026-11-06 00:00, the addendum of 00:20
(build to the Claude Design canvas "Contract Home") and the correction of 00:30 (keep dev's chapter 06
§11 behaviour, take only the view shapes; Details list default; Grid and Small, Medium and Large cards).

## 1. The command bar floated over the rows

Cause, confirmed: the bar was `sticky` with `top: var(--tl-page-header-h)`. Since #397 a list inside a
`PageScrollBody` scrolls in that body, which already sits under the page header, so the bar stuck one
header height down inside the scroller, over the rows. Reproduced on `origin/dev` with the demo seed
(five returned devices added to RC-2026-0001 in the local database only): the bar covered rows on 5 of
24 sampled views (the counter's Returned devices, the contract Devices and History tabs, at 360 px).

Fix (`c8feb2d6`): the bar is one plain row above the items, never sticky; on a fit page it sits outside
the scrolling table box. `stickyTop`, the published `--tl-collection-bar-h` of the bar and its focus
guard went with it; the details pane sticks at the top of its own scroll container (`top-2`). No page
passed `stickyTop`.

## 2. The views

`e74d8136`: the List view (no column headers) is removed. Every CollectionView offers the Details list
(default from 600 px), Grid, Small cards, Medium cards and Large cards; below 600 px a collection opens
on Large cards. One card anatomy at four scales, from the canvas artboard "Large cards view (1280)":
checkbox, image tile, item name as an `h3`, subtitle, label and value block, divider, action slots
right-aligned with Show details at the inline end. The status badge stays the state menu and the
canvas's Change status button and Status change column are not built (§11 wins, 00:30 ruling). Device
lists (fleet, contract Devices tab, return counter) show the variant icon render from
`public/variants/` with the variant name and capabilities (`VariantTile`, `VariantSubtitle`); other
lists show their navigation icon. The page-level `views` prop is gone.

`a0184709`: chosen on a phone, the Details list of `/t/incidents` widened its grid column to the
table's width (the grid had no explicit column), so the bar and `#main` scrolled sideways; latent on
`dev`, where phones opened on List. The queue grid now has `grid-cols-1` and the CollectionView wrappers
take `min-w-0`. The `DeviceRef` asset tag link got a 24 px target (axe `target-size` beside History).

## Checks

- Frontend: typecheck clean; lint 0 errors (1 older warning, `CounterPaymentDialog.tsx`); vitest 132
  files, 1530 tests. New tests fail on the code before them: the view tests 10 of 55 on slice 1; the bar
  tests on `origin/dev` (sticky class and offset).
- Viewport and bar audit (headless Chromium, local Postgres 16, `seed:demo`): every route with a
  seeded id as Admin (34) and Org Manager (18), at 1440x900, 1280x720, 900x800, 360x740, 320x568 and
  318x236, Canopy and Volt: 636 views, run on `c8feb2d6` and again on `e74d8136`. Both: document scroll
  0, `#main` scroll 0 on views 480 px tall or more, sticky bars 0, bar over a row 0 (456 bars checked,
  288 with rows, each scrolled to 0, 25, 50, 75 and 100 %).
- Views matrix on `e74d8136`: each of the five views on `/t/fleet`, the contract Devices tab, the
  counter's Returned devices, `/t/admin/sync`, `/t/incidents`, `/t/admin/audit/sign-ins`,
  `/o/contracts`, `/o/members` and the contract History tab, at 1440, 1280, 900, 360 and 320, both
  themes: 450 views, 180 axe runs (WCAG 2.0 to 2.2 A and AA tags, `#main`). Offences: the two fixed in
  `a0184709`. Rerun after it on `/t/incidents` and the Devices tab at 1440, 900, 360 and 320, both
  themes: 80 views, 40 axe runs, 0 offences, 0 violations.
- Looked at by eye: Large cards on the fleet and the Devices tab at 1440 light (against the canvas
  artboard), Grid and Small cards on the fleet at 1440, the incident queue Details list at 360 before
  and after the fix, the Devices tab Large cards at 360 dark, the counter's Returned devices Large
  cards at 320 light.

## Not done or not verified

- The Field data sync ledger never scrolled on the local seed, so the reported overlap there was not
  reproduced; the shared cause is fixed.
- The Grid, Small and Medium artboards (canvas 7 to 10) were not available here; those views scale the
  Large card down as the 00:30 ruling describes.
- `docs/design/2026-11-03-collectionview-and-layout.md` still says the bar is sticky and lists the List
  view; chapter 06 is updated by the orchestrator.
- On Hardware variants the card tile is empty: each row's title already holds the variant render.
