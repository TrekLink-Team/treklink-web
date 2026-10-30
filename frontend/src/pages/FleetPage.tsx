import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  registerDevice,
  useDevices,
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
import { Empty, ErrorState, Loading, PageTitle, Pager } from '../shared/ui/bits';
import { formatDateTime } from '../shared/lib/format';
import { useToast } from '../shared/ui/toastStore';
import { ALERT, LINK, TABLE, TD, TH } from '../shared/ui/styles';

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

// /t/fleet, FleetPage of screen 4.2 (devices api-design 01 and 06). TrekLink Staff and Admin.
export const FleetPage: React.FC = () => {
  const [status, setStatus] = useState<DeviceStatus | ''>('');
  const [hardwareVariantId, setHardwareVariantId] = useState('');
  const [q, setQ] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [registering, setRegistering] = useState(false);
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const { data: variants } = useVariants();
  const filters = {
    status: status ? [status] : undefined,
    hardwareVariantId: hardwareVariantId || undefined,
    q: q || undefined,
    pageNumber,
  };
  const { data, isLoading, error, refetch } = useDevices(filters);

  const registered = async (device: Device) => {
    setRegistering(false);
    showToast(MSG03);
    await queryClient.invalidateQueries({ queryKey: ['devices'] });
    showToast(`${device.assetTag} opened in intake.`);
  };

  return (
    <section aria-labelledby="fleet-title">
      <PageTitle
        id="fleet-title"
        title="Devices"
        action={<Button variant="primary" onClick={() => setRegistering(true)}>Register device</Button>}
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          id="fleet-status"
          aria-label="Filter by status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as DeviceStatus | '');
            setPageNumber(1);
          }}
        >
          <option value="">Every status</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {DEVICE_STATUS[value].label}
            </option>
          ))}
        </Select>
        <Select
          id="fleet-variant"
          aria-label="Filter by hardware variant"
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
        <Input
          aria-label="Search by asset tag or node id"
          placeholder="TL-00 or !a4b1c2d3"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setPageNumber(1);
          }}
          className="max-w-xs"
        />
      </div>

      {isLoading && <Loading />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.items.length === 0 && (
        <Empty>
          <p>{status || hardwareVariantId || q ? 'No results match your filters.' : 'No devices registered yet.'}</p>
        </Empty>
      )}
      {data && data.items.length > 0 && (
        <>
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Asset tag</th>
                <th className={TH}>Node id</th>
                <th className={TH}>Variant</th>
                <th className={TH}>Status</th>
                <th className={TH}>Firmware</th>
                <th className={TH}>Battery</th>
                <th className={TH}>Last seen</th>
                <th className={TH}>Service due</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((device) => (
                <tr key={device.id}>
                  <td className={TD}>
                    <Link to={`/t/devices/${device.id}`} className={LINK}>
                      {device.assetTag}
                    </Link>
                  </td>
                  <td className={TD}>{device.nodeId}</td>
                  <td className={TD}>{device.hardwareVariant.code}</td>
                  <td className={TD}>
                    <StatusBadge entry={DEVICE_STATUS[device.status]} />
                  </td>
                  <td className={TD}>{device.firmwareVersion}</td>
                  <td className={TD}>{device.batteryPct !== null ? `${device.batteryPct}%` : 'Unknown'}</td>
                  <td className={TD}>{device.lastSeenAt ? formatDateTime(device.lastSeenAt) : 'Never'}</td>
                  <td className={TD}>{device.serviceDueAt ?? 'None'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager pageNumber={data.pageNumber} totalPages={data.totalPages} onPage={setPageNumber} />
        </>
      )}
      {registering && (
        <RegisterDialog onDone={(device) => void registered(device)} onCancel={() => setRegistering(false)} />
      )}
    </section>
  );
};
