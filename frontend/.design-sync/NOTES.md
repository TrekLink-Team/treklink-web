# design-sync notes (treklink-web/frontend)

## Projects
- This config syncs `src/shared/ui` to the Claude Design project "TrekLink Web UI" (projectId in config.json).
- The landing site `TrekLink-Team.github.io` (Astro + Tailwind 4, no React) is a SEPARATE Claude Design
  project ("TrekLink Landing", styles-only: tokens, fonts, CSS). Same TrekLink product, different UI
  language; never merge the two projects. Requested by the user on 2026-11-03.

## Build
- The frontend is an app with no dist/. `node .design-sync/build-pkg.mjs` (cfg.buildCmd) packages
  `src/shared/ui` into `.ds-pkg/` (esbuild ESM + tsc .d.ts + Tailwind-compiled CSS with @fontsource
  fonts). Run it before the converter on every sync; the converter reads `--entry .ds-pkg/dist/index.js`.
- Install from the treklink-web root lockfile: `npm ci --workspace frontend --include-workspace-root=false`.
  `--node-modules ../node_modules` (hoisted workspace root).
- Render check uses system Chrome: `DS_CHROMIUM_PATH=/usr/bin/google-chrome`, with `playwright@<root
  playwright-core version>` installed into `.ds-sync/` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.
- The Tailwind build scans all of `src/`, so the shipped CSS holds every class the app uses, not
  arbitrary Tailwind classes.

## Known render warns
- `[FONT_MISSING] "Inter", "Geist Mono", "Plus Jakarta Sans"`: these are the second entries of the
  Tailwind font stacks. The first entries ("Inter Variable", "Plus Jakarta Sans Variable",
  "Geist Mono Variable") ship as @font-face and were confirmed loaded in a rendered card.

## Previews (authoring learnings)
- Import components from `'@treklink/ui'` and icons from `'lucide-react'` (icons size via `className="h-4 w-4"`).
- Every card renders inside `TrekLinkRoot` (cfg.provider, `.design-sync/root.tsx`, a MemoryRouter), so
  `rowHref`, Breadcrumb and PageHeader links work. No other context is needed for the solo set.
- Use TrekLink domain content: rental contracts (`CT-2026-0142`), devices (`TL-0001`, "TrekLink Node v2",
  "TrekLink Gateway"), routes (Fansipan, Tà Xùa, Lảo Thẩn), stations (Sa Pa), Vietnamese names.
- Generic components (DataTable<Row,K>) need `columns={COLUMNS as never}` or an explicit type argument;
  the emitted `.d.ts` references `Column`, `RowNoun`, `SortState` without declaring them.
- Overlays use `cardMode: single` and page-width pieces `cardMode: column` (cfg.overrides). Config
  overrides did not clear existing grades.
- lucide-react exports `Badge` and `Menu` icons that collide with the DS components; the DS wins on
  `window.TrekLinkUI`. Use `BadgeIcon` / `MenuIcon` for the icons.
- Fixed / unusual frames: Toast and Drawer are `position: fixed`; their previews wrap them in a sized
  frame with `transform: translateZ(0)` so the frame is the containing block. Menus have no open prop;
  `previews/_openOnMount.tsx` clicks the real trigger once after mount.
- The Tailwind build ships only classes the app uses (`w-80`, `table-fixed`, `grid-cols-3`,
  `bg-chrome-strong`, `h-toolbar` are absent). Previews use inline `style` for one-off sizes.
- `cfg.dtsPropsFor.PageChromeProvider`: it is a React context Provider; the extractor emitted only
  `children`, which would make the design agent omit the required `value`.
- `[EXPORT_COLLISION]` lucide `Badge`/`Menu`: expected, DS components win (see conventions header).

## Card layouts (cfg.overrides)
- `single`: Dialog, ConfirmDialog, Drawer, StateChangeDialog, BulkActionDialog, Toast, Menu, StateChangeMenu.
- `column`: PageHeader, StickyPageHeader, PageActionBar, PageChromeProvider, Toolbar, MapWorkspace,
  BulkBar, MapPanel, Pagination, Stepper (the last three from `[GRID_OVERFLOW]`).

## Grading workflow on this machine
- RAM: 15 GB box shared with other sessions. No subagents for this sync; every Chrome run goes through
  `../../docs/heavy.sh` (capstone `ignore/khoa/docs/heavy.sh`) with `TK_MIN_AVAIL_KB=1500000`.
- Review sheets are mostly whitespace; `.design-sync/.cache/tile.py` (gitignored scratch) trimmed and
  stacked them for grading. Always check a raw sheet before failing a card on a tiled view.

## Re-sync risks
- `build-pkg.mjs` compiles `src/app/styles/index.css` with the repo Tailwind config. A class added to a
  preview but used nowhere in `src/` will not exist; a class the app stops using disappears from designs.
- The bundle includes all of `lucide-react` (about 600 KB of the ~1.4 MB bundle). A lucide upgrade can
  rename icons the conventions header names (`Plus`, `Siren`, `Radio`, `BadgeIcon`, `MenuIcon`).
- Previews hard-code domain data (status palette keys, route names). A renamed `DEVICE_STATUS` key or
  a changed `StateTransition`/`BulkActionDialog` API breaks those cards; the build log shows
  `! preview build failed` and the card drops to the floor.
- `.design-sync/root.tsx` pins MemoryRouter from the app's `react-router-dom` (v7). A router major bump
  needs a check that `TrekLinkRoot` still renders.
- The emitted `.d.ts` for generic components (DataTable, Tabs, RadioGroup) references `Column`,
  `TabItem`, `RadioOption` without declaring them; the `.prompt.md` examples carry the shapes.
- Not partially verified: dark theme ("Volt") cards were never captured; all grading was light theme.
