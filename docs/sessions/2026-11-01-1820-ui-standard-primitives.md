# 2026-11-01 18:20 (UTC+7): UI standard (WCAG 2.2 AA) and shared primitives (task W28)

KhoaDD under D-078. Branch `feat/ui-standard-primitives`, cut from
`origin/dev` at `9be601d`. Frontend and specs only: no backend, migration, catalog, seed, router or
navigation file changed.

## What changed

- `specs/frontend/ui-design/0-ui-standard.md`: the standard (WCAG 2.2 AA, data tables, state changes,
  forms, dark mode), each rule with its source URL; linked from the ui-design README and `design.md` §7.
- `specs/frontend/requirements.md` REQ-UBI-04: WCAG 2.1 AA raised to 2.2 AA (leader request).
- `shared/ui`: new `Menu` and `StateChange` (`StateChangeMenu`, `StateChangeDialog`); `DataTable`
  rebuilt around selection (`rowLabel`, tri-state header, Shift-click range, `BulkBar`, select all N
  results), `rowActions` as `RowAction[]`, `aria-sort` on the sorted column only, keyboard activation
  through `rowHref` or `onRowActivate`; toast tones with two mounted live regions; `Dialog` `role` and
  `initialFocus`, `ConfirmDialog` `irreversible`; `bits.tsx` re-exports `Badge` and `Field` and renders
  `Pager` as `Pagination`; one focus ring (outline plus offset) across `shared/ui`; 44 px filter chip
  remove and ErrorState retry.
- `pages/DesignSystemPage.tsx`: the bulk bar, row menu, Menu, StateChange and toast tones.

## Checks

- Vitest: 87 files, 950 tests (base 83 files, 912). `incident-pages.test.tsx` now asks for "Next page",
  the name Pagination gives the button Pager used to call "Next".
- `npm run lint`: 0 errors, 1 warning that predates this branch (`CounterPaymentDialog.tsx:14`).
- `a11y.spec.ts` on a local Postgres 16 with the demo seed, `DEMO_CONTROLS_ENABLED=true`,
  `E2E_STUB_TILES=true`, Chromium 1243: 47 passed. A first run without the demo flag failed only on
  `/t/admin/demo` (access refused, not an axe violation).
- An ad-hoc axe pass (WCAG 2.0 to 2.2 A and AA tags) on `/dev/design-system` in both themes, with
  the bulk bar, an open row menu with its disabled item focused, the alert dialog and an error toast:
  0 violations after one fix (a `menu` owned wrapper divs; `aria-required-children`, critical).

## Open

Applying the standard to the pages (W29); an error summary component; `AccountMenu` onto `Menu`; a
single-pointer alternative to map panning (WCAG 2.5.7).
