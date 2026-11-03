import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../app/providers/useAuth';
import {
  recordReset,
  registerDevice,
  retireDevice,
  useDevices,
  useDeviceStatusCounts,
  useVariants,
  type Device,
} from '../entities/device/api';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../shared/api/apiClient';
import { DEVICE_STATUS, type DeviceStatus } from '../shared/ui/status';
import { StatusBadge } from '../shared/ui/Badge';
import { Button } from '../shared/ui/Button';
import { Dialog } from '../shared/ui/Dialog';
import { Field, Input, Select } from '../shared/ui/Field';
import { messageOf } from '../shared/ui/errors';
import { ErrorState } from '../shared/ui/bits';
import { Pagination } from '../shared/ui/DataTable';
import { PageHeader } from '../shared/ui/PageHeader';
import { cn } from '../shared/ui/cn';
import { ScrollStrip } from '../shared/ui/ScrollStrip';
import {
  CollectionView,
  type CollectionBulkAction,
  type CollectionField,
  type CollectionTransition,
} from '../shared/ui/collection-view';
import { formatDateTime, formatDay } from '../shared/lib/format';
import { useDebounced } from '../shared/lib/useDebounced';
import { useToast } from '../shared/ui/toastStore';
import { hasAnyRole } from '../shared/lib/permissions';
import { BulkActionDialog } from '../shared/ui/BulkAction';
import type { BulkItem } from '../shared/ui/bulkSequence';
import { StateChangeDialog, type StateTransition } from '../shared/ui/StateChange';
import { DisposeDialog, IntakeDialog, ResetDialog } from '../widgets/DeviceActions/DeviceDialogs';
import { VariantCard } from '../entities/variant/VariantCard';
import { VariantImage } from '../entities/variant/VariantImage';
import { ALERT, ERROR_TEXT, LINK, WARNING } from '../shared/ui/styles';
import { ClipboardCheck, RotateCcw } from 'lucide-react';
import { intakeDockMessage } from '../features/device-connector/actions/messages';
import { useDocking } from '../features/device-connector/actions/useDocking';
import { VARIANT_CODE_BY_PIO_ENV, firmwareBuildDiffers } from '../shared/config/docking';

const SEARCH_DEBOUNCE_MS = 300;

const STATUSES: DeviceStatus[] = [
  'IN_INTAKE',
  'AVAILABLE',
  'RESERVED',
  'RENTED',
  'RETURNED',
  'MAINTENANCE',
  'LOST',
  'RETIRED',
  'DISPOSED',
];

const MSG01 = 'No results match your filters.';
const MSG03 = 'Saved.';

interface RegisterForm {
  assetTag: string;
  nodeNum: string;
  hardwareVariantId: string;
  firmwareVersion: string;
  acquiredAt: string;
}

const EMPTY_FORM: RegisterForm = {
  assetTag: '',
  nodeNum: '',
  hardwareVariantId: '',
  firmwareVersion: '',
  acquiredAt: '',
};

// The register dialog of screen 4.2 (devices api-design 05). The firmware version is prefilled from
// the variant's baseline the first time a variant is chosen. Read from unit (devices design 8.3) fills
// the node number and the variant from a docked unit and shows the firmware it reports; typing stays
// possible, and uniqueness is still the server's (REQ-ERR-01).
const RegisterDialog: React.FC<{ onDone: (device: Device) => void; onCancel: () => void }> = ({
  onDone,
  onCancel,
}) => {
  const { data: variants } = useVariants();
  const [form, setForm] = useState<RegisterForm>(EMPTY_FORM);
  const [touchedFirmware, setTouchedFirmware] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const docking = useDocking();
  const [reported, setReported] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const readFromUnit = async () => {
    setReadError(null);
    const read = await docking.readUnit();
    if (!read.ok) {
      setReadError(intakeDockMessage(read));
      return;
    }
    const code = read.unit.pioEnv ? VARIANT_CODE_BY_PIO_ENV[read.unit.pioEnv] : undefined;
    const variant = variants?.find((item) => item.isActive && item.code === code);
    setForm((prev) => ({
      ...prev,
      nodeNum: String(read.unit.nodeNum),
      ...(variant
        ? {
            hardwareVariantId: variant.id,
            firmwareVersion: touchedFirmware ? prev.firmwareVersion : variant.firmwareBaseline,
          }
        : {}),
    }));
    setReported(read.unit.firmwareVersion);
  };

  const pickVariant = (hardwareVariantId: string) => {
    const variant = variants?.find((item) => item.id === hardwareVariantId);
    setForm((prev) => ({
      ...prev,
      hardwareVariantId,
      firmwareVersion: touchedFirmware ? prev.firmwareVersion : (variant?.firmwareBaseline ?? ''),
    }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!form.assetTag.trim()) next.assetTag = 'Please fill in this field.';
    if (!form.nodeNum.trim()) next.nodeNum = 'Please fill in this field.';
    if (!form.hardwareVariantId) next.hardwareVariantId = 'Please fill in this field.';
    if (!form.firmwareVersion.trim()) next.firmwareVersion = 'Please fill in this field.';
    if (!form.acquiredAt) next.acquiredAt = 'Please fill in this field.';
    else if (form.acquiredAt > today) next.acquiredAt = 'Acquired on cannot be in the future.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setPending(true);
    setFailure(null);
    try {
      const device = await registerDevice(form);
      onDone(device);
    } catch (error) {
      setPending(false);
      if (error instanceof ApiError && error.errorCode === 'CONFLICT_UNIQUE') {
        setFailure(error.message);
      } else setFailure(messageOf(error));
    }
  };

  return (
    <Dialog titleId="register-title" title="Register device" onClose={onCancel} size="md">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-control border border-line p-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={!docking.supported}
              loading={docking.busy}
              onClick={() => void readFromUnit()}
            >
              Read from unit
            </Button>
            <span className="text-body-sm text-ink-muted">
              {docking.supported
                ? 'Plug the unit in over USB and choose its port.'
                : 'Reading from a unit needs Chrome or Edge on a desktop. You can type the node number.'}
            </span>
          </div>
          {readError && (
            <p role="alert" className={ERROR_TEXT}>
              {readError}
            </p>
          )}
        </div>
        <Field id="register-assetTag" label="Asset tag" required error={errors.assetTag}>
          <Input
            id="register-assetTag"
            value={form.assetTag}
            invalid={Boolean(errors.assetTag)}
            onChange={(event) => setForm((prev) => ({ ...prev, assetTag: event.target.value }))}
          />
        </Field>
        <Field id="register-nodeNum" label="Node number" required error={errors.nodeNum}>
          <Input
            id="register-nodeNum"
            value={form.nodeNum}
            invalid={Boolean(errors.nodeNum)}
            onChange={(event) => setForm((prev) => ({ ...prev, nodeNum: event.target.value }))}
          />
        </Field>
        <Field
          id="register-variant"
          label="Hardware variant"
          required
          error={errors.hardwareVariantId}
        >
          <Select
            id="register-variant"
            value={form.hardwareVariantId}
            invalid={Boolean(errors.hardwareVariantId)}
            onChange={(event) => pickVariant(event.target.value)}
          >
            <option value="">Select a variant</option>
            {(variants ?? [])
              .filter((variant) => variant.isActive)
              .map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.code}
                </option>
              ))}
          </Select>
        </Field>
        <Field
          id="register-firmware"
          label="Firmware version"
          required
          error={errors.firmwareVersion}
        >
          <Input
            id="register-firmware"
            value={form.firmwareVersion}
            invalid={Boolean(errors.firmwareVersion)}
            onChange={(event) => {
              setTouchedFirmware(true);
              setForm((prev) => ({ ...prev, firmwareVersion: event.target.value }));
            }}
          />
        </Field>
        {reported &&
          (firmwareBuildDiffers(reported, form.firmwareVersion) ? (
            <p role="status" className={WARNING}>
              The unit reports {reported}.
            </p>
          ) : (
            <p className="-mt-2 text-body-sm text-ink-muted">The unit reports {reported}.</p>
          ))}
        <Field id="register-acquiredAt" label="Acquired on" required error={errors.acquiredAt}>
          <Input
            id="register-acquiredAt"
            type="date"
            max={today}
            value={form.acquiredAt}
            invalid={Boolean(errors.acquiredAt)}
            onChange={(event) => setForm((prev) => ({ ...prev, acquiredAt: event.target.value }))}
          />
        </Field>
        {failure && (
          <p role="alert" className={ALERT}>
            {failure}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            Register device
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

// The status filter lives in the address (`?status=MAINTENANCE&status=LOST`), so a link or a reload
// keeps it. Unknown values are dropped.
const statusesOf = (params: URLSearchParams): DeviceStatus[] =>
  params
    .getAll('status')
    .filter((value): value is DeviceStatus => STATUSES.includes(value as DeviceStatus));

// The row actions of screen 4.2 follow the device state machine (devices design §2) and the viewer:
// Staff and Admin record the intake check (IN_INTAKE, or MAINTENANCE once its record is closed; the
// server answers MAINTENANCE_OPEN otherwise, since the list does not carry the open record) and the
// reset of a RETURNED unit; an Admin retires a MAINTENANCE unit (`device.retire`, a reason) and
// disposes of a RETIRED one (`device.dispose`, the wipe). Every other move belongs to a contract, a
// maintenance record or a loss case and is made on their pages.
type FleetAction = 'intake' | 'reset' | 'retire' | 'dispose';

const fleetActionsOf = (device: Device, isAdmin: boolean): FleetAction[] => {
  switch (device.status) {
    case 'IN_INTAKE':
      return ['intake'];
    case 'MAINTENANCE':
      return isAdmin ? ['intake', 'retire'] : ['intake'];
    case 'RETURNED':
      return ['reset'];
    case 'RETIRED':
      return isAdmin ? ['dispose'] : [];
    default:
      return [];
  }
};

const ACTION_LABEL: Record<FleetAction, string> = {
  intake: 'Record intake check',
  reset: 'Record reset',
  retire: 'Retire device',
  dispose: 'Dispose device',
};

const RETIRE: StateTransition<'RETIRED'> = {
  target: 'RETIRED',
  label: 'Retire device',
  destructive: true,
  needsReason: true,
  description: 'A retired device leaves the rentable fleet for good. Its history is kept.',
  successMessage: 'Device retired',
};

const RESET_STEPS = ['Key removed', 'Node database cleared', 'Owner cleared'];

const devicesText = (count: number) => `${count} ${count === 1 ? 'device' : 'devices'}`;

type BulkKind = 'reset' | 'retire';

const battery = (device: Device) =>
  device.batteryPct !== null ? `${device.batteryPct}%` : 'Unknown';
const lastSeen = (device: Device) =>
  device.lastSeenAt ? formatDateTime(device.lastSeenAt) : 'Never';

// /t/fleet, FleetPage of screen 4.2 (devices api-design 01, 05 and 06). TrekLink Staff and Admin.
// Status chips (multi-select, each with its count, in the address) above the fleet on CollectionView
// (chapter 06 §9, D-096): search and the variant filter in its command bar, the selection of the
// current page with the bulk reset and retire, intake and reset as item actions, retire and dispose
// as status changes, and the details pane. The devices API pages on the server and does not sort.
// The page does not subscribe to live events; Staff use the fleet map for live state.
export const FleetPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const statuses = statusesOf(params);
  const [hardwareVariantId, setHardwareVariantId] = useState('');
  const [q, setQ] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [registering, setRegistering] = useState(false);
  const [acting, setActing] = useState<{ action: FleetAction; device: Device } | null>(null);
  const [bulk, setBulk] = useState<{ kind: BulkKind; devices: Device[] } | null>(null);
  const { user } = useAuth();
  const isAdmin = hasAnyRole(user?.roles ?? [], ['ADMIN']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const { data: variants } = useVariants();
  // The list and the nine status counts read the search once typing pauses, not on every key.
  const settledQ = useDebounced(q.trim(), SEARCH_DEBOUNCE_MS);
  const narrowing = { hardwareVariantId: hardwareVariantId || undefined, q: settledQ || undefined };
  const { data, isLoading, error, refetch } = useDevices({
    ...narrowing,
    status: statuses.length > 0 ? statuses : undefined,
    pageNumber,
  });
  const counts = useDeviceStatusCounts(STATUSES, narrowing);
  const filtered = statuses.length > 0 || Boolean(hardwareVariantId) || Boolean(q.trim());

  const toggleStatus = (status: DeviceStatus) => {
    const next = statuses.includes(status)
      ? statuses.filter((value) => value !== status)
      : [...statuses, status];
    const nextParams = new URLSearchParams(params);
    nextParams.delete('status');
    next.forEach((value) => nextParams.append('status', value));
    setParams(nextParams, { replace: true });
    setPageNumber(1);
  };

  const clearFilters = () => {
    const nextParams = new URLSearchParams(params);
    nextParams.delete('status');
    setParams(nextParams, { replace: true });
    setHardwareVariantId('');
    setQ('');
    setPageNumber(1);
  };

  const refreshDevices = () => queryClient.invalidateQueries({ queryKey: ['devices'] });

  const actionDone = () => {
    setActing(null);
    showToast(MSG03);
    void refreshDevices();
  };

  const itemsOf = (devices: Device[]): BulkItem[] =>
    devices.map((device) => ({ id: device.id, label: device.assetTag }));

  const registered = async (device: Device) => {
    setRegistering(false);
    showToast(MSG03);
    await queryClient.invalidateQueries({ queryKey: ['devices'] });
    // The new device opens in IN_INTAKE (screen 4.2 Actions); its page takes the intake check.
    navigate(`/t/devices/${device.id}`);
  };

  const fields: CollectionField<Device>[] = [
    { key: 'nodeId', label: 'Node id', render: (device) => device.nodeId, hideWithPane: true },
    {
      key: 'variant',
      label: 'Variant',
      // The icon render beside the code (devices design section 10, "Two renders per variant").
      render: (device) => (
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <VariantImage variant={device.hardwareVariant} render="icon" size="sm" />
          {device.hardwareVariant.code}
        </span>
      ),
      text: (device) => device.hardwareVariant.code,
      hideWithPane: true,
    },
    {
      key: 'status',
      label: 'Status',
      render: (device) => <StatusBadge entry={DEVICE_STATUS[device.status]} />,
      compact: true,
    },
    {
      key: 'firmware',
      label: 'Firmware',
      render: (device) => <span className="whitespace-nowrap">{device.firmwareVersion}</span>,
      text: (device) => device.firmwareVersion,
      hideWithPane: true,
    },
    { key: 'battery', label: 'Battery', align: 'end', render: battery, compact: true },
    { key: 'lastSeen', label: 'Last seen', render: lastSeen, compact: true },
    {
      key: 'serviceDue',
      label: 'Service due',
      // A calendar date (devices api-design, `@db.Date`), shown as every other date: 03 May 2027.
      render: (device) => (
        <span className="whitespace-nowrap">
          {device.serviceDueAt ? formatDay(device.serviceDueAt.slice(0, 10)) : 'None'}
        </span>
      ),
      hideWithPane: true,
    },
  ];

  // Retire and dispose are state changes of the device (devices design §2), in Change status; the
  // intake check and the reset are records with their own forms, so they are item actions.
  const transitions = (device: Device): CollectionTransition<Device>[] =>
    fleetActionsOf(device, isAdmin)
      .filter(
        (action): action is 'retire' | 'dispose' => action === 'retire' || action === 'dispose',
      )
      .map((action) => ({
        key: action,
        label: ACTION_LABEL[action],
        destructive: true,
        onSelect: ([target]) => setActing({ action, device: target }),
      }));

  const bulkActions: CollectionBulkAction<Device>[] = [
    {
      key: 'reset',
      label: (count) => `Record reset for ${devicesText(count)}`,
      appliesTo: (device) => device.status === 'RETURNED',
      onSelect: (devices) => setBulk({ kind: 'reset', devices }),
    },
    ...(isAdmin
      ? [
          {
            key: 'retire',
            label: (count: number) => `Retire ${devicesText(count)}`,
            destructive: true,
            appliesTo: (device: Device) => device.status === 'MAINTENANCE',
            onSelect: (devices: Device[]) => setBulk({ kind: 'retire', devices }),
          },
        ]
      : []),
  ];

  const registerButton = (
    <Button variant="primary" onClick={() => setRegistering(true)}>
      Register device
    </Button>
  );
  const pageSize = data?.pageSize ?? 20;

  return (
    <section aria-labelledby="fleet-title" className="flex flex-col gap-4">
      <PageHeader id="fleet-title" title="Devices" primaryAction={registerButton} />

      {/* One row that scrolls sideways on a phone, with the hints of chapter 06 §10.6; it wraps from 640 px. */}
      <ScrollStrip role="group" aria-label="Filter by status" wrapFrom="sm">
        {STATUSES.map((status) => {
          const pressed = statuses.includes(status);
          const count = counts[status];
          return (
            <button
              key={status}
              type="button"
              aria-pressed={pressed}
              onClick={() => toggleStatus(status)}
              className={cn(
                'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-control border px-3 text-body-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                pressed
                  ? 'border-transparent bg-accent text-on-accent'
                  : 'border-line-strong bg-surface text-ink hover:bg-chrome/60',
              )}
            >
              {DEVICE_STATUS[status].label}
              {count !== undefined && (
                <span className={pressed ? undefined : 'text-ink-muted'}>{count}</span>
              )}
            </button>
          );
        })}
      </ScrollStrip>

      <CollectionView<Device>
        label="Devices"
        items={data?.items}
        loading={isLoading}
        error={error ? <ErrorState error={error} onRetry={() => void refetch()} /> : undefined}
        itemId={(device) => device.id}
        itemName={(device) => device.assetTag}
        itemHref={(device) => `/t/devices/${device.id}`}
        fields={fields}
        noun={{ one: 'device', other: 'devices' }}
        itemActions={[
          {
            key: 'intake',
            label: ACTION_LABEL.intake,
            icon: <ClipboardCheck />,
            allowed: (device) => fleetActionsOf(device, isAdmin).includes('intake'),
            onSelect: (device) => setActing({ action: 'intake', device }),
          },
          {
            key: 'reset',
            label: ACTION_LABEL.reset,
            icon: <RotateCcw />,
            allowed: (device) => fleetActionsOf(device, isAdmin).includes('reset'),
            onSelect: (device) => setActing({ action: 'reset', device }),
          },
        ]}
        transitions={transitions}
        statusOf={(device) => DEVICE_STATUS[device.status].label}
        bulkActions={bulkActions}
        search={{ label: 'Search by asset tag or node id', placeholder: 'TL-00 or !a4b1c2d3' }}
        filters={[
          { key: '', label: 'Every variant' },
          ...(variants ?? []).map((variant) => ({ key: variant.id, label: variant.code })),
        ]}
        query={{ search: q, filter: hardwareVariantId, sort: null }}
        onQueryChange={(next) => {
          setQ(next.search);
          setHardwareVariantId(next.filter);
          setPageNumber(1);
        }}
        resetKey={statuses.join(',')}
        pageInfo={
          data
            ? {
                total: data.totalCount,
                from: data.totalCount === 0 ? 0 : (data.pageNumber - 1) * pageSize + 1,
                to: (data.pageNumber - 1) * pageSize + data.items.length,
              }
            : undefined
        }
        details={{
          // The detail render in the details pane (devices design section 10). The card names the
          // variant, so the pane leaves out the Variant field and its icon.
          fields: fields.map((field) => field.key).filter((key) => key !== 'variant'),
          image: (device) => (
            <VariantCard variant={device.hardwareVariant} render="detail" headingLevel="h3" />
          ),
          href: (device) => `/t/devices/${device.id}`,
          hrefLabel: 'Open the device page',
        }}
        emptyState={
          filtered
            ? { title: MSG01, action: <Button onClick={clearFilters}>Clear filters</Button> }
            : { title: 'No devices registered yet.', action: registerButton }
        }
        footer={
          data && data.totalPages > 1 ? (
            <Pagination
              pageNumber={data.pageNumber}
              totalPages={data.totalPages}
              totalItems={data.totalCount}
              pageSize={data.pageSize}
              onPage={setPageNumber}
            />
          ) : undefined
        }
      />
      {acting?.action === 'intake' && (
        <IntakeDialog device={acting.device} onDone={actionDone} onCancel={() => setActing(null)} />
      )}
      {acting?.action === 'reset' && (
        <ResetDialog device={acting.device} onDone={actionDone} onCancel={() => setActing(null)} />
      )}
      {acting?.action === 'dispose' && (
        <DisposeDialog
          device={acting.device}
          onDone={actionDone}
          onCancel={() => setActing(null)}
        />
      )}
      {acting?.action === 'retire' && (
        <StateChangeDialog<'RETIRED'>
          subject={acting.device.assetTag}
          transition={RETIRE}
          version={acting.device.version}
          onSubmit={({ reason, expectedVersion }) =>
            retireDevice(acting.device.id, reason ?? '', expectedVersion)
          }
          onReload={() => void refreshDevices()}
          onDone={() => void refreshDevices()}
          onClose={() => setActing(null)}
        />
      )}
      {bulk?.kind === 'reset' && (
        <BulkActionDialog
          title={`Record reset for ${devicesText(bulk.devices.length)}?`}
          confirmLabel={`Record reset for ${devicesText(bulk.devices.length)}`}
          description="Each unit's reset is recorded with the three steps below (devices api-design 10). Only the RETURNED devices of the selection are reset."
          confirmations={RESET_STEPS}
          items={itemsOf(bulk.devices)}
          run={(item) => recordReset(item.id)}
          onFinished={() => void refreshDevices()}
          onClose={() => setBulk(null)}
        />
      )}
      {bulk?.kind === 'retire' && (
        <BulkActionDialog
          title={`Retire ${devicesText(bulk.devices.length)}?`}
          confirmLabel={`Retire ${devicesText(bulk.devices.length)}`}
          description="Retired devices leave the rentable fleet for good. A device with an open maintenance record is refused until that record is closed."
          destructive
          needsReason
          items={itemsOf(bulk.devices)}
          run={(item, reason) =>
            retireDevice(
              item.id,
              reason ?? '',
              bulk.devices.find((device) => device.id === item.id)?.version ?? 0,
            )
          }
          onFinished={() => void refreshDevices()}
          onClose={() => setBulk(null)}
        />
      )}
      {registering && (
        <RegisterDialog
          onDone={(device) => void registered(device)}
          onCancel={() => setRegistering(false)}
        />
      )}
    </section>
  );
};
