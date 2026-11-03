# TrekLink System: how to build with it

TrekLink is a trekking safety and rental operations console (devices, rental contracts, trek groups,
live map, incidents). Every export below lives on `window.TrekLinkUI`.

## Setup

- Wrap the whole design in `TrekLinkRoot`. It is a router: `Breadcrumb`, `PageHeader` breadcrumbs and
  `DataTable` `rowHref` render links that throw without it.
- Light theme ("Canopy") is the default. For dark ("Volt") set `data-theme="dark"` on `<html>`; every
  semantic class below switches with it.
- Icons: the full `lucide-react` set is on the same global (`Plus`, `Download`, `Siren`, `Radio`...).
  `Badge` and `Menu` are the DS components; their icons are `BadgeIcon` and `MenuIcon`.
- Overlays (`Dialog`, `ConfirmDialog`, `Drawer`, `Toast`) are `position: fixed` and cover the viewport.

## Styling idiom: Tailwind with semantic names

Only classes the TrekLink app itself uses are compiled into `styles.css`. Arbitrary Tailwind classes
may not exist: use the names below, and inline `style` for one-off sizes or grids.

| Family | Classes |
|---|---|
| Surfaces | `bg-ground` (page), `bg-surface`, `bg-surface-raised`, `bg-sunken`, `bg-chrome` (selected, chips) |
| Text | `text-ink`, `text-ink-muted`, `text-brand`, `text-on-accent` |
| Brand | `bg-accent` (primary fill), `bg-spark` + `text-on-spark` (highlight chip) |
| Lines | `border-line`, `border-line-strong` |
| Status | `{text,bg,border}-status-{critical,attention,active,waiting,done,ended}-{fg,tint,line,strong}` |
| Type | `text-caption`, `text-body-sm`, `text-body`, `text-body-lg`, `text-title-sm`, `text-title`, `text-title-lg`, `text-display`, `text-kpi`, `text-label` (uppercase labels); `font-display` for headings, `font-mono` for codes like `TL-0042` |
| Shape | `rounded-badge`, `rounded-control`, `rounded-card`, `rounded-panel`, `rounded-sheet` |
| Depth | `shadow-raise`, `shadow-overlay`, `tl-glass` / `tl-glass-strong` (only over the map) |
| Width | `max-w-measure` (text), `max-w-page` |

Never use raw colours; never use the legacy `slate-*`, `blue-*`, `emerald-*` names.

## Rules the components encode

- One `Button variant="primary"` per screen; `ghost` inside toolbars; `danger` opens a `ConfirmDialog`.
- Lifecycle states use `StatusBadge` with a palette, never colour alone:
  `<StatusBadge entry={DEVICE_STATUS.RENTED} />`. Palettes: `DEVICE_STATUS`, `CONTRACT_STATUS`,
  `INVOICE_STATUS`, `ORGANIZATION_STATUS`, `MAINTENANCE_STATUS`, `DAMAGE_CHARGE_STATUS`, `SERVICE_CREDIT_STATUS`.
- Form controls go inside `Field` (label above, hint, error); the control's `id` equals the Field `id`.
- Lists are `DataTable` with an `empty` state; page tops are `PageHeader`, then `Toolbar`, then content.
- Money is VND with thousands separators and no decimals (`48,500,000 ₫`).

## Where the truth lives

Read `styles.css` (it imports `_ds_bundle.css` and `fonts/fonts.css`) before styling, and each
component's `<Name>.prompt.md` and `<Name>.d.ts` before using it.

## Example

```jsx
const { TrekLinkRoot, PageHeader, Button, Card, CardHeader, StatusBadge, DEVICE_STATUS, Plus } = window.TrekLinkUI;

<TrekLinkRoot>
  <div className="min-h-screen bg-ground p-6">
    <PageHeader title="Devices" meta="287 devices"
      primaryAction={<Button variant="primary" icon={<Plus className="h-4 w-4" />}>Register device</Button>} />
    <Card className="max-w-measure">
      <CardHeader title="TL-0042" description="TrekLink Node v2" />
      <StatusBadge entry={DEVICE_STATUS.RENTED} />
    </Card>
  </div>
</TrekLinkRoot>
```
