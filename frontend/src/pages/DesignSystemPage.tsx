import React, { useMemo, useState } from 'react';
import {
  Copy,
  Download,
  FileText,
  Filter,
  MoreHorizontal,
  Pencil,
  Wrench,
  Plus,
  RefreshCw,
  Siren,
  Trash2,
  Users,
} from 'lucide-react';
import { ApiError } from '../shared/api/apiClient';
import { ALL_NAV } from '../shared/config/navigation';
import { formatVnd } from '../shared/lib/format';
import { useTheme, type ThemePreference } from '../shared/lib/theme';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  ConfidenceBadge,
  ConfirmDialog,
  CONTRACT_STATUS,
  DataTable,
  DEVICE_STATUS,
  Dialog,
  Drawer,
  EmptyState,
  Field,
  FilterChip,
  IconButton,
  INCIDENT_STATE,
  Input,
  INVOICE_STATUS,
  MapLegend,
  MapPanel,
  Menu,
  PageHeader,
  Pagination,
  RadioGroup,
  Select,
  Skeleton,
  SkeletonText,
  StatCard,
  StateChangeMenu,
  StatusBadge,
  Stepper,
  Switch,
  TabPanel,
  Tabs,
  Textarea,
  TONE_CLASSES,
  Toolbar,
  ToolbarSearch,
  useToast,
  type Column,
  type ContractStatus,
  type RowAction,
  type SortState,
  type StateTransition,
  type StatusEntry,
  type StatusTone,
} from '../shared/ui';
import { InfoPaneToggle, useInfoPane, useOpenInfoPane } from '../widgets/AppShell';

// /dev/design-system: every component and state of the TrekLink System, in the current theme.
// Registered in development builds only (app/router.tsx). The rows below are sample data for the
// showcase; no figure here comes from an endpoint.

interface SampleContract {
  id: string;
  code: string;
  route: string;
  devices: number;
  depositVnd: number;
  status: ContractStatus;
}

const SAMPLE: SampleContract[] = [
  { id: 'c1', code: 'CT-2026-0142', route: 'Fansipan summit, 3 days via Trạm Tôn', devices: 24, depositVnd: 12_000_000, status: 'ACTIVE' },
  { id: 'c2', code: 'CT-2026-0139', route: 'Tà Xùa dinosaur ridge', devices: 12, depositVnd: 6_000_000, status: 'REQUESTED' },
  { id: 'c3', code: 'CT-2026-0131', route: 'Bạch Mộc Lương Tử through Lai Châu and the Sin Suối Hồ approach', devices: 18, depositVnd: 9_000_000, status: 'RETURN_DUE' },
  { id: 'c4', code: 'CT-2026-0127', route: 'Lảo Thẩn, Y Tý', devices: 8, depositVnd: 4_000_000, status: 'OVERDUE' },
  { id: 'c5', code: 'CT-2026-0118', route: 'Kỳ Quan San', devices: 16, depositVnd: 8_000_000, status: 'CLOSED' },
  { id: 'c6', code: 'CT-2026-0109', route: 'Putaleng summit', devices: 14, depositVnd: 7_000_000, status: 'CANCELLED' },
];

type DemoDeviceState = 'AVAILABLE' | 'MAINTENANCE' | 'RETIRED';

// Sample transitions of the state change showcase; a page takes its own from the module spec.
const DEVICE_TRANSITIONS: Record<DemoDeviceState, StateTransition<DemoDeviceState>[]> = {
  AVAILABLE: [
    { target: 'MAINTENANCE', label: 'Send to maintenance', successMessage: 'TL-0042 sent to maintenance.' },
    {
      target: 'RETIRED',
      label: 'Retire device',
      destructive: true,
      needsReason: true,
      description: 'The device leaves the fleet for good and cannot be rented again. This cannot be undone.',
      successMessage: 'TL-0042 retired.',
    },
  ],
  MAINTENANCE: [{ target: 'AVAILABLE', label: 'Return to service', successMessage: 'TL-0042 is available again.' }],
  RETIRED: [],
};

const Section: React.FC<{ id: string; title: string; description?: string; children: React.ReactNode }> = ({
  id,
  title,
  description,
  children,
}) => (
  <Card aria-labelledby={id} className="mb-5">
    <CardHeader id={id} title={title} description={description} />
    {children}
  </Card>
);

const Swatch: React.FC<{ name: string; className: string; text?: string; note?: string }> = ({ name, className, text = 'text-ink', note }) => (
  <div className="flex flex-col gap-1">
    <div className={`flex h-14 items-end rounded-control border border-line p-2 text-caption font-bold ${className} ${text}`}>Aa</div>
    <span className="text-body-sm font-semibold text-ink">{name}</span>
    {note && <span className="text-caption text-ink-muted">{note}</span>}
  </div>
);

const TONES: StatusTone[] = ['critical', 'attention', 'active', 'waiting', 'done', 'ended'];

const Palette: React.FC<{ title: string; palette: Record<string, StatusEntry> }> = ({ title, palette }) => (
  <div className="flex flex-col gap-2">
    <h3 className="text-body font-bold text-ink">{title}</h3>
    <div className="flex flex-wrap gap-2">
      {Object.entries(palette).map(([key, entry]) => (
        <span key={key} className="flex flex-col items-start gap-1">
          <StatusBadge entry={entry} />
          <code className="font-mono text-caption text-ink-muted">{key}</code>
        </span>
      ))}
    </div>
  </div>
);

export const DesignSystemPage: React.FC = () => {
  const preference = useTheme((state) => state.preference);
  const setPreference = useTheme((state) => state.setPreference);
  const showToast = useToast((state) => state.show);
  const openInfo = useOpenInfoPane();

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allResults, setAllResults] = useState(false);
  const [deviceState, setDeviceState] = useState<DemoDeviceState>('AVAILABLE');
  const [deviceVersion, setDeviceVersion] = useState(3);
  const [conflictNext, setConflictNext] = useState(false);
  const [active, setActive] = useState<string>('c1');
  const [sort, setSort] = useState<SortState<'code' | 'devices'>>({ key: 'code', direction: 'desc' });
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<'all' | 'active' | 'due'>('all');
  const [dialog, setDialog] = useState<null | 'dialog' | 'confirm' | 'left' | 'right' | 'bottom'>(null);
  const [step, setStep] = useState(1);
  const [plan, setPlan] = useState<'MONTHLY' | 'DAY' | undefined>('MONTHLY');
  const [notify, setNotify] = useState(true);
  const [loading, setLoading] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = SAMPLE.filter((row) => !q || `${row.code} ${row.route}`.toLowerCase().includes(q));
    const sorted = [...filtered].sort((a, b) =>
      sort.key === 'devices' ? a.devices - b.devices : a.code.localeCompare(b.code),
    );
    return sort.direction === 'asc' ? sorted : sorted.reverse();
  }, [query, sort]);

  const activeRow = SAMPLE.find((row) => row.id === active);
  const info = useMemo(
    () =>
      activeRow
        ? {
            title: activeRow.code,
            icon: <FileText />,
            body: (
              <div className="flex flex-col gap-4">
                <StatusBadge entry={CONTRACT_STATUS[activeRow.status]} />
                <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-body">
                  <dt className="text-ink-muted">Route</dt>
                  <dd className="font-semibold">{activeRow.route}</dd>
                  <dt className="text-ink-muted">Devices</dt>
                  <dd className="font-semibold">{activeRow.devices}</dd>
                  <dt className="text-ink-muted">Deposit</dt>
                  <dd className="font-semibold tabular-nums">{formatVnd(activeRow.depositVnd)}</dd>
                </dl>
                <p className="text-body-sm text-ink-muted">Sample data of the design system page.</p>
              </div>
            ),
            footer: (
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1">
                  Open contract
                </Button>
                <Button>Edit</Button>
              </div>
            ),
          }
        : null,
    [activeRow],
  );
  useInfoPane(info);

  const columns: Column<SampleContract, 'code' | 'route' | 'devices' | 'deposit' | 'status'>[] = [
    { key: 'code', header: 'Contract', sortable: true, width: '9.5rem', cell: (row) => <span className="font-mono text-body-sm font-semibold text-brand">{row.code}</span> },
    { key: 'route', header: 'Route', truncate: (row) => row.route, cell: (row) => row.route },
    { key: 'devices', header: 'Devices', sortable: true, align: 'end', width: '6rem', cell: (row) => row.devices },
    { key: 'deposit', header: 'Deposit', align: 'end', width: '9rem', hideOnMobile: true, cell: (row) => formatVnd(row.depositVnd) },
    { key: 'status', header: 'Status', width: '10rem', cell: (row) => <StatusBadge entry={CONTRACT_STATUS[row.status]} /> },
  ];

  const rowActions = (row: SampleContract): RowAction[] => [
    { key: 'open', label: 'Open', icon: <FileText />, onSelect: () => { setActive(row.id); openInfo(); } },
    { key: 'edit', label: 'Edit', icon: <Pencil />, onSelect: () => undefined },
    { key: 'copy', label: 'Duplicate', icon: <Copy />, onSelect: () => undefined },
    {
      key: 'cancel',
      label: 'Cancel contract',
      destructive: true,
      disabled: row.status === 'CLOSED' || row.status === 'CANCELLED',
      disabledReason: 'A closed or cancelled contract cannot be cancelled.',
      onSelect: () => setDialog('confirm'),
    },
  ];

  const transitions = DEVICE_TRANSITIONS[deviceState];

  return (
    <section aria-labelledby="ds-title">
      <PageHeader
        id="ds-title"
        title="Design system"
        breadcrumb={[{ label: 'Developer' }, { label: 'Design system' }]}
        meta="TrekLink System, Canopy and Volt"
        description="Every component and state in the current theme. Switch the theme to check both. Development builds only."
        actions={<Button icon={<Download aria-hidden="true" className="h-4 w-4" />}>Export</Button>}
        primaryAction={
          <Button variant="primary" icon={<Plus aria-hidden="true" className="h-4 w-4" />}>
            Primary action
          </Button>
        }
      />

      <Section id="ds-theme" title="Theme" description="The preference is stored per browser; System follows the operating system.">
        <RadioGroup<ThemePreference>
          name="ds-theme-choice"
          legend="Theme"
          layout="row"
          value={preference}
          onChange={setPreference}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light (Canopy)' },
            { value: 'dark', label: 'Dark (Volt)' },
          ]}
        />
      </Section>

      <Section id="ds-colour" title="Colour: 60 / 30 / 10" description="Ground and surfaces 60 %, green chrome 30 %, accent 10 %. Status colours sit outside the budget.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <Swatch name="ground" className="bg-ground" note="60 %" />
          <Swatch name="surface" className="bg-surface" note="60 %, data" />
          <Swatch name="sunken" className="bg-sunken" note="table head, wells" />
          <Swatch name="chrome" className="bg-chrome" note="30 %, selection" />
          <Swatch name="accent" className="bg-accent" text="text-on-accent" note="10 %, primary" />
          <Swatch name="spark" className="bg-spark" text="text-on-spark" note="10 %, active nav" />
          <Swatch name="brand" className="bg-surface" text="text-brand" note="brand text, links" />
          <Swatch name="ink" className="bg-surface" note="body text" />
          <Swatch name="ink-muted" className="bg-surface" text="text-ink-muted" note="secondary text" />
          <Swatch name="line-strong" className="border-2 border-line-strong bg-surface" note="control edges 3:1" />
          <Swatch name="inverse" className="bg-inverse" text="text-ink-inverse" note="toast" />
          <Swatch name="focus" className="bg-surface outline outline-2 outline-offset-2 outline-focus" note="focus ring" />
        </div>
        <h3 className="mb-2 mt-6 text-body font-bold text-ink">TrekLink System Colors (status)</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {TONES.map((tone) => (
            <div key={tone} className="flex flex-col gap-2 rounded-control border border-line p-3">
              <Badge tone={tone}>{tone}</Badge>
              <span className={`rounded-badge border px-2 py-1 text-caption ${TONE_CLASSES[tone]}`}>badge recipe</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="ds-type" title="Typography" description="Plus Jakarta Sans for titles and figures, Inter for interface and data, Geist Mono for codes.">
        <div className="flex flex-col gap-3">
          <p className="font-display text-display text-ink">Display 32 · Hợp đồng thuê thiết bị</p>
          <p className="font-display text-title-lg text-ink">Title large 26 · Contracts</p>
          <p className="font-display text-title text-ink">Title 22 · Incident queue</p>
          <p className="font-display text-title-sm text-ink">Title small 18 · Devices</p>
          <p className="text-body-lg text-ink">Body large 16 · Trưởng đoàn xác nhận bàn giao 24 thiết bị.</p>
          <p className="text-body text-ink">Body 14 · The operator acknowledges the SOS and the incident moves to Responding.</p>
          <p className="text-body-sm text-ink-muted">Body small 13 · Updated 08:14, Asia/Ho_Chi_Minh</p>
          <p className="text-label uppercase text-ink-muted">Label 11 · Status</p>
          <p className="font-mono text-body-sm text-ink">Mono 13 · TL-0417 · 21.30171, 103.77525 · 06:42:15</p>
          <p className="font-display text-kpi tabular-nums text-ink">12.000.000 VND</p>
        </div>
      </Section>

      <Section id="ds-buttons" title="Buttons" description="One primary per screen. Danger confirms first and names the object.">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary">Primary</Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" icon={<Trash2 aria-hidden="true" className="h-4 w-4" />}>
              Retire device
            </Button>
            <Button variant="primary" loading={loading} loadingLabel="Saving" onClick={() => { setLoading(true); window.setTimeout(() => setLoading(false), 1500); }}>
              Save, shows loading
            </Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm">Small 36</Button>
            <Button variant="primary" size="md">Medium 44</Button>
            <Button variant="primary" size="lg">Large 48</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <IconButton label="Refresh" icon={<RefreshCw />} />
            <IconButton label="Filters" icon={<Filter />} variant="secondary" />
            <IconButton label="Notifications" icon={<Siren />} badge={3} />
            <IconButton label="Details panel" icon={<FileText />} pressed />
            <IconButton label="Add" icon={<Plus />} variant="primary" />
          </div>
        </div>
      </Section>

      <Section id="ds-forms" title="Forms" description="Labels above fields, required mark, hint and error linked to the control. At most 4 steps of 6 fields.">
        <Stepper
          className="mb-5"
          current={step}
          steps={[{ label: 'Plan' }, { label: 'Devices' }, { label: 'Dates' }, { label: 'Review' }]}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Field id="ds-org" label="Organization name" required hint="As on the business registration.">
            <Input id="ds-org" defaultValue="Sơn Trà Trekking" aria-describedby="ds-org-hint" />
          </Field>
          <Field id="ds-qty" label="Devices" required error="Enter a number from 1 to 200.">
            <Input id="ds-qty" defaultValue="0" invalid aria-describedby="ds-qty-error" inputMode="numeric" />
          </Field>
          <Field id="ds-variant" label="Hardware variant">
            <Select id="ds-variant" defaultValue="v3">
              <option value="v3">Handset v3</option>
              <option value="v2">Handset v2</option>
            </Select>
          </Field>
          <Field id="ds-note" label="Note for TrekLink staff" hint="Optional.">
            <Textarea id="ds-note" rows={3} aria-describedby="ds-note-hint" />
          </Field>
          <RadioGroup
            name="ds-plan"
            legend="Plan"
            required
            value={plan}
            onChange={setPlan}
            options={[
              { value: 'MONTHLY', label: 'Monthly', description: 'Billed per device per month.' },
              { value: 'DAY', label: 'Day plan', description: 'For trips of up to 14 days.' },
            ]}
          />
          <div className="flex flex-col">
            <Checkbox label="I accept the rental terms" description="Required before the request is sent." defaultChecked />
            <Switch label="Email me when the request is decided" checked={notify} onChange={setNotify} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</Button>
          <Button variant="primary" onClick={() => setStep((value) => Math.min(3, value + 1))}>Continue</Button>
        </div>
      </Section>

      <Section id="ds-status" title="Status palettes" description="Every enum of the schema on 2026-10-27, with its human label and tone.">
        <div className="flex flex-col gap-5">
          <Palette title="Device" palette={DEVICE_STATUS} />
          <Palette title="Contract" palette={CONTRACT_STATUS} />
          <Palette title="Invoice" palette={INVOICE_STATUS} />
          <Palette title="Incident" palette={INCIDENT_STATE} />
          <div className="flex flex-col gap-2">
            <h3 className="text-body font-bold text-ink">Incident confidence</h3>
            <div className="flex gap-2">
              <ConfidenceBadge confidence="CONFIRMED" />
              <ConfidenceBadge confidence="SUSPECTED" />
            </div>
          </div>
        </div>
      </Section>

      <Section id="ds-data" title="Data table (Pattern A)" description="Toolbar above, sortable columns, server paging, sticky header, truncation with the full value on hover or focus. Select rows (Shift-click for a range) for the bulk bar; with every row of the page selected it offers all 42 results. Four row actions make a menu, and row actions are disabled while the bulk bar shows. The contract code opens the Info pane by keyboard; a click anywhere on the row does the same.">
        <Tabs
          label="Contract views"
          idPrefix="ds-tabs"
          value={tab}
          onChange={setTab}
          items={[
            { key: 'all', label: 'All', count: 42 },
            { key: 'active', label: 'Active', count: 12 },
            { key: 'due', label: 'Return due', count: 4 },
          ]}
          className="mb-3"
        />
        <TabPanel idPrefix="ds-tabs" tabKey={tab}>
          <Toolbar
            label="Contract tools"
            start={
              <>
                <ToolbarSearch id="ds-search" label="Search contracts" placeholder="Search by code or route" value={query} onChange={setQuery} />
                <Button size="sm" icon={<Filter aria-hidden="true" className="h-4 w-4" />}>
                  Filters
                </Button>
                <FilterChip label="Period: Oct 2026" onRemove={() => undefined} />
              </>
            }
            end={
              <>
                <IconButton label="Refresh" icon={<RefreshCw />} size="sm" />
                <InfoPaneToggle />
              </>
            }
          />
          <DataTable
            caption="Sample contracts"
            columns={columns}
            rows={rows}
            rowId={(row) => row.id}
            sort={sort}
            onSortChange={(next) => setSort(next as SortState<'code' | 'devices'>)}
            rowLabel={(row) => row.code}
            noun={{ one: 'contract', other: 'contracts' }}
            selectedIds={selected}
            onSelectionChange={setSelected}
            totalCount={42}
            allResultsSelected={allResults}
            onSelectAllResults={setAllResults}
            bulkActions={({ ids, allResults: all }) => {
              const count = all ? 42 : ids.size;
              return (
                <>
                  <Button size="sm" icon={<Download aria-hidden="true" className="h-4 w-4" />}>
                    Export {count} {count === 1 ? 'contract' : 'contracts'}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setDialog('confirm')}>
                    Cancel {count} {count === 1 ? 'contract' : 'contracts'}
                  </Button>
                </>
              );
            }}
            activeRowId={active}
            onRowActivate={(row) => {
              setActive(row.id);
              openInfo();
            }}
            rowActions={rowActions}
            empty={{ title: 'No contract matches', description: 'Clear the search or the filters to see every contract.', action: <Button onClick={() => setQuery('')}>Clear search</Button> }}
            renderCard={(row) => (
              <button type="button" className="flex w-full flex-col gap-1 text-left" onClick={() => { setActive(row.id); openInfo(); }}>
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-body-sm font-semibold text-brand">{row.code}</span>
                  <StatusBadge entry={CONTRACT_STATUS[row.status]} />
                </span>
                <span className="truncate font-semibold">{row.route}</span>
                <span className="text-body-sm text-ink-muted">{row.devices} devices · {formatVnd(row.depositVnd)}</span>
              </button>
            )}
            footer={<Pagination pageNumber={page} totalPages={5} totalItems={42} pageSize={10} onPage={setPage} onPageSize={() => undefined} />}
          />
        </TabPanel>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <DataTable caption="Loading" columns={columns} rows={undefined} rowId={(row) => row.id} loading empty={{ title: '' }} />
          <DataTable
            caption="Empty"
            columns={columns}
            rows={[]}
            rowId={(row) => row.id}
            empty={{ title: 'No contracts yet', description: 'Request your first rental; TrekLink staff answer within a working day.', action: <Button variant="primary">Request a contract</Button> }}
          />
        </div>
      </Section>

      <Section id="ds-feedback" title="Feedback" description="Inline alerts, the toast in four tones (success, info and warning announced politely, error assertively; an error or an action stays until dismissed), skeletons and empty states.">
        <div className="flex flex-col gap-3">
          <Alert tone="info" title="Maintenance window">Handsets sync firmware between 22:00 and 23:00.</Alert>
          <Alert tone="success" title="Payment recorded">Invoice INV-2026-0088 is paid.</Alert>
          <Alert tone="warning" title="Return due tomorrow" action={<Button size="sm">See devices</Button>}>18 devices of CT-2026-0131 are due at Sin Suối Hồ station.</Alert>
          <Alert tone="error" title="Could not save" onDismiss={() => undefined}>The server refused the change. Try again.</Alert>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => showToast('Saved.')}>Success toast</Button>
            <Button onClick={() => showToast('Firmware sync starts at 22:00.', { tone: 'info' })}>Info toast</Button>
            <Button onClick={() => showToast('Return due tomorrow for 18 devices.', { tone: 'warning' })}>Warning toast</Button>
            <Button onClick={() => showToast('The payment could not be recorded.', { tone: 'error' })}>Error toast, stays</Button>
            <Button onClick={() => showToast('Device TL-0042 retired.', { action: { label: 'Open device', onClick: () => undefined } })}>
              Toast with an action, stays
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-control border border-line p-4">
              <Skeleton className="h-6 w-1/2" />
              <SkeletonText lines={3} />
            </div>
            <div className="rounded-control border border-line">
              <EmptyState icon={<Users />} title="No members yet" description="Invite the operators who watch the map." action={<Button variant="primary">Invite member</Button>} />
            </div>
          </div>
        </div>
      </Section>

      <Section id="ds-menu" title="Menu" description="Menu button pattern: Enter, Space or the arrows open it, the arrows, Home, End and a letter move, Escape closes and returns focus. A disabled item stays reachable and reads its reason.">
        <div className="flex flex-wrap items-center gap-3">
          <Menu
            label="Export"
            triggerClassName="h-11 border border-line-strong bg-surface px-4 text-body"
            items={[
              { key: 'csv', label: 'Export as CSV', icon: <Download />, onSelect: () => showToast('CSV export started.', { tone: 'info' }) },
              { key: 'pdf', label: 'Export as PDF', icon: <FileText />, onSelect: () => showToast('PDF export started.', { tone: 'info' }) },
              { key: 'xlsx', label: 'Export as Excel', disabled: true, disabledReason: 'Excel export is not available yet.', onSelect: () => undefined },
            ]}
          />
          <Menu
            label="More actions for TL-0042"
            title="More actions"
            trigger={<MoreHorizontal aria-hidden="true" className="h-5 w-5" />}
            items={[
              { key: 'edit', label: 'Edit device', icon: <Pencil />, onSelect: () => undefined },
              { key: 'service', label: 'Open maintenance', icon: <Wrench />, onSelect: () => undefined },
              { key: 'retire', label: 'Retire device', icon: <Trash2 />, destructive: true, onSelect: () => undefined },
            ]}
          />
          <Menu label="Disabled menu" disabled items={[{ key: 'x', label: 'Nothing', onSelect: () => undefined }]} />
        </div>
      </Section>

      <Section id="ds-state" title="State change" description="Only the allowed next states, a dialog named after the action, a required reason for audited changes, expectedVersion on the request, a toast after success, and a persistent conflict notice that keeps the reason.">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-body-sm font-semibold">TL-0042</span>
          <StatusBadge entry={DEVICE_STATUS[deviceState]} />
          <span className="text-body-sm text-ink-muted">version {deviceVersion}</span>
          <StateChangeMenu<DemoDeviceState>
            subject="TL-0042"
            transitions={transitions}
            version={deviceVersion}
            onReload={() => {
              setDeviceVersion((value) => value + 1);
              setConflictNext(false);
            }}
            onSubmit={async ({ target, expectedVersion }) => {
              await new Promise((resolve) => window.setTimeout(resolve, 400));
              if (conflictNext || expectedVersion !== deviceVersion) {
                throw new ApiError(409, 'STALE_VERSION', 'Version mismatch');
              }
              setDeviceState(target);
              setDeviceVersion((value) => value + 1);
            }}
          />
          <Switch label="Next request answers STALE_VERSION" checked={conflictNext} onChange={setConflictNext} />
          <Button size="sm" variant="ghost" onClick={() => { setDeviceState('AVAILABLE'); setDeviceVersion(3); }}>
            Reset sample
          </Button>
        </div>
      </Section>

      <Section id="ds-kpi" title="Stat cards" description="Sample figures for layout only.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Devices out" value="86" hint="Sample" icon={<FileText />} />
          <StatCard label="Open incidents" value="3" hint="1 confirmed SOS" tone="critical" icon={<Siren />} />
          <StatCard label="Return due" value="4" hint="Next 48 hours" tone="attention" icon={<FileText />} />
          <StatCard label="Balance due" value={formatVnd(14_500_000)} hint="Sample" icon={<FileText />} />
        </div>
      </Section>

      <Section id="ds-overlays" title="Overlays" description="Escape closes and focus returns to the button. The incident banner stays above all of them.">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog('dialog')}>Dialog</Button>
          <Button variant="danger" onClick={() => setDialog('confirm')}>Confirm dialog</Button>
          <Button onClick={() => setDialog('left')}>Drawer left</Button>
          <Button onClick={() => setDialog('right')}>Drawer right</Button>
          <Button onClick={() => setDialog('bottom')}>Bottom sheet</Button>
        </div>
        {dialog === 'dialog' && (
          <Dialog
            titleId="ds-dialog"
            title="Record counter payment"
            description="Cash received at the counter for INV-2026-0088."
            onClose={() => setDialog(null)}
            showClose
            footer={
              <>
                <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
                <Button variant="primary" onClick={() => setDialog(null)}>Record payment</Button>
              </>
            }
          >
            <Field id="ds-amount" label="Amount (VND)" required>
              <Input id="ds-amount" inputMode="numeric" defaultValue="4.000.000" />
            </Field>
          </Dialog>
        )}
        {dialog === 'confirm' && (
          <ConfirmDialog
            titleId="ds-confirm"
            title="Cancel contract CT-2026-0139?"
            description="The reservation of 12 devices is released. This cannot be undone."
            confirmLabel="Cancel contract"
            cancelLabel="Keep contract"
            destructive
            onConfirm={() => setDialog(null)}
            onCancel={() => setDialog(null)}
          />
        )}
        {(dialog === 'left' || dialog === 'right' || dialog === 'bottom') && (
          <Drawer titleId="ds-drawer" title={`Drawer from the ${dialog}`} side={dialog} onClose={() => setDialog(null)}>
            <p className="text-body text-ink-muted">Drawers carry navigation on small screens, the Info pane below 1280 px and bottom sheets on phones.</p>
          </Drawer>
        )}
      </Section>

      <Section id="ds-map" title="Map chrome" description="Markers change shape per state. Glass panels float over the map; the attribution and the sovereignty overlay are never covered.">
        <div className="relative h-80 overflow-hidden rounded-panel border border-line bg-[#dfe8cc]">
          <svg aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox="0 0 600 320" preserveAspectRatio="none">
            <path d="M0 260 C 120 200, 220 240, 320 180 S 480 120, 600 140" fill="none" stroke="rgba(130,100,60,0.45)" strokeWidth="1.4" />
            <path d="M0 290 C 130 230, 240 270, 340 210 S 500 150, 600 170" fill="none" stroke="rgba(130,100,60,0.45)" strokeWidth="1.4" />
            <path d="M40 280 C 120 240, 200 200, 260 160 S 330 110, 360 90" fill="none" stroke="#2f5f00" strokeWidth="3" strokeDasharray="8 6" />
          </svg>
          <span role="img" aria-label="TL-0402, Fresh" className="tl-marker tl-marker--fresh absolute left-[22%] top-[62%]" />
          <span role="img" aria-label="TL-0409, Needs attention" className="tl-marker tl-marker--attention absolute left-[34%] top-[50%]" />
          <span className="absolute left-[48%] top-[40%] flex items-center" role="img" aria-label="TL-0388, Stale, last seen 14 min ago">
            <span className="tl-marker tl-marker--stale" />
            <span aria-hidden="true" className="tl-marker-label">14 min</span>
          </span>
          <span className="absolute left-[58%] top-[28%] flex items-center" role="img" aria-label="TL-0417, SOS">
            <span className="tl-marker tl-marker--sos" />
            <span aria-hidden="true" className="tl-marker-label !bg-[#d0151d]">SOS · TL-0417</span>
          </span>
          <MapPanel title="Incident queue" className="absolute right-3 top-3 w-72" count={<Badge tone="critical">3 open</Badge>}>
            <ul className="divide-y divide-line">
              <li className="flex items-center gap-2 px-4 py-3">
                <ConfidenceBadge confidence="CONFIRMED" />
                <span className="font-mono text-body-sm font-semibold">TL-0417</span>
                <span className="ml-auto text-caption text-ink-muted">2 min</span>
              </li>
              <li className="flex items-center gap-2 px-4 py-3">
                <ConfidenceBadge confidence="SUSPECTED" />
                <span className="font-mono text-body-sm font-semibold">TL-0409</span>
                <span className="ml-auto text-caption text-ink-muted">9 min</span>
              </li>
            </ul>
          </MapPanel>
          <MapLegend className="absolute bottom-3 left-3" states={['fresh', 'attention', 'stale', 'sos']} />
          <span className="absolute bottom-0 right-0 rounded-tl-md bg-surface/90 px-2 py-0.5 text-[11px] text-ink">© OpenStreetMap contributors</span>
        </div>
      </Section>

      <Section id="ds-nav" title="Navigation table" description="shared/config/navigation.ts. Entries with built: false stay hidden in the shell.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ALL_NAV.map((group) => (
            <div key={group.id} className="rounded-control border border-line p-3">
              <p className="mb-2 text-label uppercase text-ink-muted">{group.id.startsWith('o-') ? 'Organization' : 'TrekLink'} · {group.label}</p>
              <ul className="flex flex-col gap-1.5">
                {group.entries.map((entry) => {
                  const Icon = entry.icon;
                  return (
                    <li key={entry.route} className="flex items-center gap-2 text-body-sm">
                      <Icon aria-hidden="true" className="h-4 w-4 text-brand" />
                      <span className="font-semibold">{entry.label}</span>
                      <code className="font-mono text-caption text-ink-muted">{entry.route}</code>
                      <Badge tone={entry.built ? 'done' : 'ended'} className="ml-auto">
                        {entry.built ? 'Built' : 'Hidden'}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </Section>
    </section>
  );
};
