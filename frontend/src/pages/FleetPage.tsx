import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  registerDevice,
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
import { DataTable, Pagination, type Column } from '../shared/ui/DataTable';
import { PageHeader } from '../shared/ui/PageHeader';
import { Toolbar, ToolbarSearch } from '../shared/ui/Toolbar';
import { cn } from '../shared/ui/cn';
import { formatDateTime } from '../shared/lib/format';
import { useToast } from '../shared/ui/toastStore';
import { ALERT, LINK } from '../shared/ui/styles';

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
// the variant's baseline the first time a variant is chosen.
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
  const today = new Date().toISOString().slice(0, 10);

  const pickVariant = (hardwareVariantId: string) => {
    const variant = variants?.find((item) => item.id === hardwareVariantId);
    setForm((prev) => ({
      ...prev,
      hardwareVariantId,
      firmwareVersion: touchedFirmware ? prev.firmwareVersion : variant?.firmwareBaseline ?? '',
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
        <Field id="register-variant" label="Hardware variant" required error={errors.hardwareVariantId}>
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
        <Field id="register-firmware" label="Firmware version" required error={errors.firmwareVersion}>
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
  params.getAll('status').filter((value): value is DeviceStatus => STATUSES.includes(value as DeviceStatus));

const battery = (device: Device) => (device.batteryPct !== null ? `${device.batteryPct}%` : 'Unknown');
const lastSeen = (device: Device) => (device.lastSeenAt ? formatDateTime(device.lastSeenAt) : 'Never');

// /t/fleet, FleetPage of screen 4.2 (devices api-design 01, 05 and 06). TrekLink Staff and Admin.
// Status chips (multi-select, each with its count), variant and search filters, the table with a
// card per device below 768 px, and the register dialog. The page does not subscribe to live
// events; Staff use the fleet map for live state.
export const FleetPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const statuses = statusesOf(params);
  const [hardwareVariantId, setHardwareVariantId] = useState('');
  const [q, setQ] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [registering, setRegistering] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const { data: variants } = useVariants();
  const narrowing = { hardwareVariantId: hardwareVariantId || undefined, q: q.trim() || undefined };
  const { data, isLoading, error, refetch } = useDevices({
    ...narrowing,
    status: statuses.length > 0 ? statuses : undefined,
    pageNumber,
  });
  const counts = useDeviceStatusCounts(STATUSES, narrowing);
  const filtered = statuses.length > 0 || Boolean(hardwareVariantId) || Boolean(q.trim());

  const toggleStatus = (status: DeviceStatus) => {
    const next = statuses.includes(status) ? statuses.filter((value) => value !== status) : [...statuses, status];
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

  const registered = async (device: Device) => {
    setRegistering(false);
    showToast(MSG03);
    await queryClient.invalidateQueries({ queryKey: ['devices'] });
    // The new device opens in IN_INTAKE (screen 4.2 Actions); its page takes the intake check.
    navigate(`/t/devices/${device.id}`);
  };

  const columns: Column<Device>[] = [
    {
      key: 'assetTag',
      header: 'Asset tag',
      cell: (device) => (
        <Link to={`/t/devices/${device.id}`} className={LINK}>
          {device.assetTag}
        </Link>
      ),
    },
    { key: 'nodeId', header: 'Node id', cell: (device) => device.nodeId },
    { key: 'variant', header: 'Variant', cell: (device) => device.hardwareVariant.code },
    { key: 'status', header: 'Status', cell: (device) => <StatusBadge entry={DEVICE_STATUS[device.status]} /> },
    { key: 'firmware', header: 'Firmware', cell: (device) => device.firmwareVersion },
    { key: 'battery', header: 'Battery', align: 'end', cell: battery },
    { key: 'lastSeen', header: 'Last seen', cell: lastSeen },
    { key: 'serviceDue', header: 'Service due', cell: (device) => device.serviceDueAt ?? 'None' },
  ];

  const registerButton = (
    <Button variant="primary" onClick={() => setRegistering(true)}>
      Register device
    </Button>
  );

  return (
    <section aria-labelledby="fleet-title" className="flex flex-col gap-4">
      <PageHeader id="fleet-title" title="Devices" primaryAction={registerButton} />

      <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
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
                'inline-flex min-h-9 items-center gap-1.5 rounded-control border px-3 text-body-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                pressed
                  ? 'border-transparent bg-accent text-on-accent'
                  : 'border-line-strong bg-surface text-ink hover:bg-chrome/60',
              )}
            >
              {DEVICE_STATUS[status].label}
              {count !== undefined && <span className={pressed ? undefined : 'text-ink-muted'}>{count}</span>}
            </button>
          );
        })}
      </div>

      <Toolbar
        label="Device filters"
        start={
          <>
            <Field id="fleet-variant" label="Hardware variant" hideLabel className="w-full sm:w-56">
              <Select
                id="fleet-variant"
                value={hardwareVariantId}
                onChange={(event) => {
                  setHardwareVariantId(event.target.value);
                  setPageNumber(1);
                }}
              >
                <option value="">Every variant</option>
                {(variants ?? []).map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.code}
                  </option>
                ))}
              </Select>
            </Field>
            <ToolbarSearch
              id="fleet-search"
              label="Search by asset tag or node id"
              placeholder="TL-00 or !a4b1c2d3"
              value={q}
              onChange={(value) => {
                setQ(value);
                setPageNumber(1);
              }}
            />
            {filtered && (
              <Button variant="ghost" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </>
        }
      />

      <DataTable
        caption="Devices"
        columns={columns}
        rows={data?.items}
        rowId={(device) => device.id}
        loading={isLoading}
        error={error ? <ErrorState error={error} onRetry={() => void refetch()} /> : undefined}
        empty={
          filtered
            ? { title: MSG01, action: <Button onClick={clearFilters}>Clear filters</Button> }
            : { title: 'No devices registered yet.', action: registerButton }
        }
        renderCard={(device) => (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <Link to={`/t/devices/${device.id}`} className={LINK}>
                {device.assetTag}
              </Link>
              <StatusBadge entry={DEVICE_STATUS[device.status]} />
            </div>
            <p className="text-body-sm text-ink-muted">
              Battery {battery(device)}, last seen {lastSeen(device)}
            </p>
          </div>
        )}
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
      {registering && (
        <RegisterDialog onDone={(device) => void registered(device)} onCancel={() => setRegistering(false)} />
      )}
    </section>
  );
};
