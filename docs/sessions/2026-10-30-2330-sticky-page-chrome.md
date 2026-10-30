# 2026-10-30 23:30, sticky page header and fixed action bar (dry run defect 6)

KhoaDD under D-078. Branch `fix/sticky-page-chrome` from `origin/dev` (c319812).

**Rule** (leader, dry run 2026-10-30): on every long page the title, breadcrumb and stepper stay at the
top and shrink when the content scrolls; Back, Next and the primary action stay at the bottom; only
the content scrolls. Recorded in `specs/frontend/design-system.md` §5.2 and `specs/frontend/design.md` §7.

**Built**: `shared/ui/PageChrome.tsx` with `StickyPageHeader` (IntersectionObserver sentinel, compact
after 24 px, takes the shell breadcrumb) and `PageActionBar` (sticky bottom, safe-area padding). The
shell turns their published heights into scroll-padding. `Dialog` keeps title and footer fixed.

**Findings, verified in headless Chromium**:
- Chrome does not scroll a focused control that is inside the scroll box but under a sticky bar, even
  with `scroll-padding`; a `focusin` listener that calls `scrollIntoView({ block: 'nearest' })` fixes it
  (that call honours scroll-padding).
- Reading the shrunk header height in a layout effect forces a layout in which Chrome's scroll
  anchoring corrects for the moved title, scrolls to the top and flips the header back. Scroll
  anchoring is off on the content area while a sticky header is mounted.

**Pages moved**: counter handover, counter screen 5.5 (`ReturnCounter`), contract request,
organization review, maintenance open and complete dialogs.
**Left as is**: maintenance estimate and decide dialogs (two or three fields, no scroll);
`ContractApprovalPage` (its `xl:sticky xl:top-4` side card still works; not in the defect list).

**Screenshots** (mocked API, 8 devices): before, Next at y 1388 of 800 (1280 px) and 3360 of 740
(360 px), title scrolled off; after, Next at 737 and 613, compact title at 75, every Tab stop clear.
