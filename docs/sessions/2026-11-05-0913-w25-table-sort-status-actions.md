# 2026-11-05 W25: header sort, status badge control, action slots

KhoaDD's agent under D-078, branch `fix/table-sort-status-actions` from `origin/dev`.

## Done

- Spec: `specs/frontend/ui-design/0-ui-standard.md` §8 (chapter 06 §11.2 to §11.4 and the
  treklink-docs#170 revision); §3 badge source moved from GOV.UK Tag to the Atlassian lozenge
  dropdown trigger plus the APG menu button. `specs/frontend/design.md` does not describe the
  CollectionView columns, so it is unchanged.
- Sort: `shared/ui/sortCycle.ts` (`nextSort`, `ariaSortOf`), used by `DataTable` and
  `CollectionView` (`defaultSort`, Default order in the Sort dropdown, chevrons icon when unsorted).
  The sync ledger declares received time as its default order; the organization list sorts by name
  and registration date while its one page of 100 holds the whole result.
- Status: `collection-view/StatusBadgeMenu.tsx`, `CollectionView` `status` replaces `statusOf`.
  Measured on the demo seed: interactive badge 28 px high, 86 to 118 px wide.
- Actions: fixed slots, Show details last; three or more slots share one overflow menu; `slot`
  shares a slot between Deactivate and Reactivate (Accounts, Variants).

## Findings

- Only `gateway-sync` api-design 03 takes a sort (`order`). Every other list endpoint has paging
  only, so their columns stay unsortable (question to the leader).
- At 318 by 236 CSS px (400 % zoom) the shell keeps its fixed bars and leaves almost no room for
  content. The revised rule lets the bars release there; that is `AppShell`, owned by W24.

## Visual check (local Postgres, demo seed, Chromium)

Devices (Admin, two devices set to Maintenance and Retired in the local database only), Incidents
(Staff and organization), Contracts, Invoices (Staff and organization), Maintenance, Loss cases
(Staff and organization), Organizations (Admin, All tab) at 1440, 1280, 900, 360, 320 and 318 by 236,
Canopy and Volt: the document never scrolled (`scrollHeight <= clientHeight + 1`, same for width) on
any of them; axe (WCAG 2.0 to 2.2 A and AA) found no violation at 1440 and 360 in either theme.
Looked at: Incidents 1440 light and 360 dark, Devices 1440 both themes, 320 light, 318 by 236 dark,
the open badge menu (dark) and the focus ring after Escape (light).
