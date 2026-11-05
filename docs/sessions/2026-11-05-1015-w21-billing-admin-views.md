# 2026-11-05 10:15 (UTC+7): W21 billing document, handover signature, admin pages

KhoaDD under D-078, branch `fix/billing-admin-views` from `dev` at `4f91c8f`.

## Environment

- Postgres 16 from apt, a fresh cluster on port 5433, database `treklink_demo`; never a Neon host.
  `prisma migrate deploy` and `seed:demo` (55 row groups). 45 extra Staff sign-ins through the API so the
  sign-in events page has three pages.
- A cluster under the session scratchpad stopped when the harness reset that folder's permissions
  (`pg_control: Permission denied`); keep the data directory in a folder `postgres` owns.
- No MQTT broker: health reads `mqtt: down`, which none of the screens below use.
- Chromium from `/opt/pw-browsers/chromium`; the repository's Playwright looks for another build.

## Items

1. Invoice as a business document (billing 09 `seller`, buyer on `organization`, totals footer, print
   layout). Commits `2f4ed71`, `75afc3b` (nested print events).
2. Lessor box of the signed handover note: "Signed electronically by", name, time. `13b64f1`.
3. Actor picker on the change log, parameter cards below 768 px. `9efef27`.
4. Telemetry range limit from monitoring 03 `maxRangeDays` (leader ruling: a field in the answer). `8f8c31f`.
5. Sign-in events row action target size: 40 px targets, axe flags only a row scrolled under the sticky
   command bar; no change. `c047e29`.

## Findings

- Chromium fires its own `beforeprint` and `afterprint` inside a print already in progress; a print hook
  that saves the theme on every `beforeprint` loses it.
- `AccountPicker` searches TrekLink accounts only (auth 09); an organization member is chosen by a click
  on its name in a change-log row.
- In a `datetime-local` field the calendar button takes its own Tab stop inside the shadow tree, where the
  field matches neither `:focus` nor `:focus-visible` and Chromium ignores a rule on
  `::-webkit-calendar-picker-indicator`: only the browser's 1 px box shows. Every date field of the app;
  open, needs a custom picker or a ruling.
- When the map cannot load (this sandbox), `LiveMapWidget` keeps its zoom, layer and attribution controls
  in the Tab order under the "unavailable" overlay. Open for the live map owner.

## WCAG 2.2 AA visual pass (leader addition, 0-ui-standard.md)

Seven screens (`/o/invoices/:id`, `/t/billing` with an invoice open, `/t/admin/parameters`,
`/t/admin/audit/changes`, `/t/admin/audit/sign-ins`, `/t/devices/:id/telemetry`, `/o/devices/:id/telemetry`)
at 1440, 1280, 900, 360 and 320 px, light and dark: 70 visits. Each ran axe (WCAG 2.0 to 2.2 A and AA),
a sideways scroll check, a first-screen screenshot, a keyboard walk (ring and sticky-bar cover on every
focus) and a target size scan. Final pass: 0 axe findings, 0 overflow; the shots were read by eye as
contact sheets, every phone first screen and the 1440 Staff panel. Error states (parameter range,
change-log actor from the address, telemetry period) at 360 and 320 in both themes: each names the field
and the fix, axe clean. The invoice prints as one A4 page in the light theme from Volt.

Fixed in this pass: invoice facts and payment action on a phone's first screen, parties stacking in the
Staff panel, focus and scroll on opening an invoice; change-log filters folded below 640 px and address
filters checked before a read; 24 px row text buttons on the change log and sign-in events; 44 px Save and
Cancel in the parameter editor on phones; telemetry CSV in a More menu on phones.

Left as they are, with the reason: shell breadcrumb links (20 px, inline text, not these pages); the
`CollectionView` search field at 900 px (40 px toolbar control); checkboxes and map layer radios (inside
labels of 28 px or more).
