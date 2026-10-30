import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../app/providers/useAuth';
import {
  deviceKeys,
  disposeDevice,
  editFirmware,
  recordIntakeCheck,
  recordReset,
  retireDevice,
  useDevice,
  useDeviceHistory,
  useVariants,
  type Device,
} from '../entities/device/api';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime } from '../shared/lib/format';
import { hasAnyRole } from '../shared/lib/permissions';
import { ErrorState, Fact, Loading, PageTitle } from '../shared/ui/bits';
import { Button } from '../shared/ui/Button';
import { Dialog } from '../shared/ui/Dialog';
import { Checkbox, Field, Input, Switch, Textarea } from '../shared/ui/Field';
import { messageOf } from '../shared/ui/errors';
import { DEVICE_STATUS } from '../shared/ui/status';
import { StatusBadge } from '../shared/ui/Badge';
import { useToast } from '../shared/ui/toastStore';
import { ALERT, CARD, LINK } from '../shared/ui/styles';

const MSG03 = 'Saved.';
const MSG29 = 'Finish the open maintenance record first.';

const failureOf = (error: unknown, status: string): string => {
  if (error instanceof ApiError) {
    if (error.errorCode === 'INVALID_STATE_TRANSITION')
      return `This cannot be done while it is ${status}.`;
    if (error.errorCode === 'MAINTENANCE_OPEN') return MSG29;
    return error.message;
  }
  return messageOf(error);
};

// Firmware edit (devices api-design 08): one text field, no confirmation (screen 4.2).
const FirmwareDialog: React.FC<{ device: Device; onDone: () => void; onCancel: () => void }> = ({
  device,
  onDone,
  onCancel,
}) => {
  const [value, setValue] = useState(device.firmwareVersion);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!value.trim()) {
      setError('Please fill in this field.');
      return;
    }
    setPending(true);
    try {
      await editFirmware(device.id, value.trim(), device.version);
      onDone();
    } catch (failure) {
      setPending(false);
      setError(failureOf(failure, device.status));
    }
  };

  return (
    <Dialog titleId="firmware-title" title="Edit firmware version" onClose={onCancel} size="sm">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <Field id="firmware-value" label="Firmware version" required error={error ?? undefined}>
          <Input id="firmware-value" value={value} onChange={(event) => setValue(event.target.value)} />
        </Field>
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

// Intake check (devices api-design 09, screen 4.2): GPS, radio, battery always; motion only for a
// motion-sensor variant (REQ-EVT-02).
const IntakeDialog: React.FC<{ device: Device; onDone: () => void; onCancel: () => void }> = ({
  device,
  onDone,
  onCancel,
}) => {
  const { data: variants } = useVariants(true);
  const hasMotion = variants?.find((variant) => variant.id === device.hardwareVariant.id)?.hasMotionSensor;
  const [gpsFixOk, setGpsFixOk] = useState(true);
  const [radioOk, setRadioOk] = useState(true);
  const [batteryOk, setBatteryOk] = useState(true);
  const [motionOk, setMotionOk] = useState(true);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await recordIntakeCheck(device.id, {
        gpsFixOk,
        radioOk,
        batteryOk,
        ...(hasMotion ? { motionOk } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        expectedVersion: device.version,
      });
      onDone();
      return result;
    } catch (failure) {
      setPending(false);
      setError(failureOf(failure, device.status));
    }
  };

  return (
    <Dialog titleId="intake-title" title="Record intake check" onClose={onCancel} size="md">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-1">
        <Switch id="intake-gps" label="GPS fix" checked={gpsFixOk} onChange={setGpsFixOk} />
        <Switch id="intake-radio" label="Radio" checked={radioOk} onChange={setRadioOk} />
        <Switch id="intake-battery" label="Battery" checked={batteryOk} onChange={setBatteryOk} />
        {hasMotion && <Switch id="intake-motion" label="Motion sensor" checked={motionOk} onChange={setMotionOk} />}
        <div className="mt-3">
          <Field id="intake-note" label="Note" hint="Up to 500 characters">
            <Textarea
              id="intake-note"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </div>
        {error && (
          <p role="alert" className={`${ALERT} mt-3`}>
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <Button type="button" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

// /t/devices/:id, DeviceDetailPage of screen 4.2 (devices api-design 05 to 10, 16, 23 and monitoring
// api-design 07). TrekLink Staff may register, edit firmware, intake check and reset; Admin also
// retires and disposes (D-057 rule 7).
export const DeviceDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const isAdmin = hasAnyRole(user?.roles ?? [], ['ADMIN']);
  const { data: device, isLoading, error, refetch } = useDevice(id);
  const { data: history } = useDeviceHistory(id, 1);
  const [editingFirmware, setEditingFirmware] = useState(false);
  const [intaking, setIntaking] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetChecked, setResetChecked] = useState({ key: false, node: false, owner: false });
  const [resetFailure, setResetFailure] = useState<string | null>(null);
  const [retiring, setRetiring] = useState(false);
  const [retireReason, setRetireReason] = useState('');
  const [retireFailure, setRetireFailure] = useState<string | null>(null);
  const [retirePending, setRetirePending] = useState(false);
  const [disposing, setDisposing] = useState(false);
  const [disposeChecked, setDisposeChecked] = useState({ key: false, node: false, owner: false });
  const [disposeMethod, setDisposeMethod] = useState('');
  const [disposeFailure, setDisposeFailure] = useState<string | null>(null);
  const [disposePending, setDisposePending] = useState(false);

  const refresh = async () => {
    showToast(MSG03);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: deviceKeys.device(id) }),
      queryClient.invalidateQueries({ queryKey: ['devices'] }),
      queryClient.invalidateQueries({ queryKey: ['device-history', id] }),
    ]);
  };

  if (isLoading) return <Loading />;
  if (error || !device)
    return (
      <section>
        <Link to="/t/fleet" className={LINK}>
          Back to devices
        </Link>
        <div className="mt-4">
          <ErrorState error={error} onRetry={() => void refetch()} />
        </div>
      </section>
    );

  const submitReset = async () => {
    setResetFailure(null);
    try {
      await recordReset(device.id);
      setResetting(false);
      setResetChecked({ key: false, node: false, owner: false });
      await refresh();
    } catch (failure) {
      setResetFailure(failureOf(failure, device.status));
    }
  };

  const submitRetire = async () => {
    if (!retireReason.trim()) {
      setRetireFailure('Please fill in this field.');
      return;
    }
    setRetirePending(true);
    setRetireFailure(null);
    try {
      await retireDevice(device.id, retireReason.trim(), device.version);
      setRetiring(false);
      await refresh();
    } catch (failure) {
      setRetirePending(false);
      setRetireFailure(failureOf(failure, device.status));
    }
  };

  const submitDispose = async () => {
    if (!disposeMethod.trim()) {
      setDisposeFailure('Please fill in this field.');
      return;
    }
    setDisposePending(true);
    setDisposeFailure(null);
    try {
      await disposeDevice(device.id, disposeMethod.trim(), device.version);
      setDisposing(false);
      await refresh();
    } catch (failure) {
      setDisposePending(false);
      setDisposeFailure(failureOf(failure, device.status));
    }
  };

  const canIntake = device.status === 'IN_INTAKE' || (device.status === 'MAINTENANCE' && !device.openMaintenance);
  const canReset = device.status === 'RETURNED';
  const canRetire = isAdmin && device.status === 'MAINTENANCE';
  const canDispose = isAdmin && device.status === 'RETIRED';
  const resetReady = resetChecked.key && resetChecked.node && resetChecked.owner;
  const disposeReady = disposeChecked.key && disposeChecked.node && disposeChecked.owner;

  return (
    <section aria-labelledby="device-title">
      <Link to="/t/fleet" className={LINK}>
        Back to devices
      </Link>
      <div className="mt-3">
        <PageTitle
          id="device-title"
          title={device.assetTag}
          action={<StatusBadge entry={DEVICE_STATUS[device.status]} />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className={CARD}>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Fact label="Node">{device.nodeId} ({device.nodeNum})</Fact>
              <Fact label="Hardware variant">{device.hardwareVariant.code}</Fact>
              <Fact label="Acquired">{new Date(device.acquiredAt).toLocaleDateString('en-GB')}</Fact>
              <Fact label="Status since">{formatDateTime(device.statusChangedAt)}</Fact>
              <Fact label="Firmware">{device.firmwareVersion}</Fact>
              <Fact label="Key version and organization">
                {device.keyVersion !== null
                  ? `v${device.keyVersion}, ${device.keyOrganization?.legalName ?? 'unknown organization'}`
                  : 'None'}
              </Fact>
              <Fact label="Last intake check">
                {device.lastIntakeCheck
                  ? `${device.lastIntakeCheck.passed ? 'Passed' : 'Failed'}, ${formatDateTime(device.lastIntakeCheck.createdAt)}`
                  : 'None'}
              </Fact>
              <Fact label="Last reset">
                {device.lastReset ? formatDateTime(device.lastReset.createdAt) : 'None'}
              </Fact>
              <Fact label="Open maintenance">
                {device.openMaintenance ? (
                  <Link to="/t/maintenance" className={LINK}>
                    {device.openMaintenance.status}, {device.openMaintenance.description}
                  </Link>
                ) : (
                  'None'
                )}
              </Fact>
              <Fact label="Last position">
                {device.lastPosition
                  ? `${device.lastPosition.lat.toFixed(5)}, ${device.lastPosition.lon.toFixed(5)}`
                  : 'Position unavailable'}
              </Fact>
            </dl>
          </div>

          <div className="flex flex-wrap gap-3">
            {device.status !== 'DISPOSED' && (
              <Button onClick={() => setEditingFirmware(true)}>Edit firmware</Button>
            )}
            {canIntake && <Button variant="primary" onClick={() => setIntaking(true)}>Record intake check</Button>}
            {canReset && <Button variant="primary" onClick={() => setResetting(true)}>Record reset</Button>}
            {device.status === 'AVAILABLE' && !device.openMaintenance && (
              <Button onClick={() => navigate('/t/maintenance', { state: { deviceId: device.id } })}>
                Open maintenance
              </Button>
            )}
            {canRetire && <Button variant="danger" onClick={() => setRetiring(true)}>Retire</Button>}
            {canDispose && <Button variant="danger" onClick={() => setDisposing(true)}>Dispose</Button>}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <section className={CARD} aria-labelledby="device-history">
            <h2 id="device-history" className="mb-3 text-title-sm text-ink">
              History
            </h2>
            {!history || history.items.length === 0 ? (
              <p className="text-body text-ink-muted">No history recorded yet.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {history.items.map((item, index) => (
                  <li key={`${item.at}-${index}`}>
                    <p className="text-body-sm text-ink-muted">
                      {formatDateTime(item.at)}, {item.actor}
                    </p>
                    <p className="text-body text-ink">{item.summary}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>

      {editingFirmware && (
        <FirmwareDialog
          device={device}
          onDone={() => void (async () => {
            setEditingFirmware(false);
            await refresh();
          })()}
          onCancel={() => setEditingFirmware(false)}
        />
      )}
      {intaking && (
        <IntakeDialog
          device={device}
          onDone={() => void (async () => {
            setIntaking(false);
            await refresh();
          })()}
          onCancel={() => setIntaking(false)}
        />
      )}
      {resetting && (
        <Dialog titleId="reset-title" title="Record reset" onClose={() => setResetting(false)} size="sm">
          <div className="flex flex-col gap-1">
            <Checkbox
              label="Key removed"
              checked={resetChecked.key}
              onChange={(event) => setResetChecked((prev) => ({ ...prev, key: event.target.checked }))}
            />
            <Checkbox
              label="Node database cleared"
              checked={resetChecked.node}
              onChange={(event) => setResetChecked((prev) => ({ ...prev, node: event.target.checked }))}
            />
            <Checkbox
              label="Owner cleared"
              checked={resetChecked.owner}
              onChange={(event) => setResetChecked((prev) => ({ ...prev, owner: event.target.checked }))}
            />
            {resetFailure && (
              <p role="alert" className={`${ALERT} mt-2`}>
                {resetFailure}
              </p>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-3">
              <Button onClick={() => setResetting(false)}>Cancel</Button>
              <Button variant="primary" disabled={!resetReady} onClick={() => void submitReset()}>
                Save
              </Button>
            </div>
          </div>
        </Dialog>
      )}
      {retiring && (
        <Dialog
          titleId="retire-title"
          title={`Retire device ${device.assetTag}?`}
          description="A retired device leaves the rentable fleet. Its history is kept."
          onClose={() => setRetiring(false)}
          size="sm"
        >
          <div className="flex flex-col gap-3">
            <Field id="retire-reason" label="Reason" required error={retireFailure ?? undefined}>
              <Textarea
                id="retire-reason"
                value={retireReason}
                onChange={(event) => setRetireReason(event.target.value)}
              />
            </Field>
            <div className="mt-2 flex flex-wrap justify-end gap-3">
              <Button onClick={() => setRetiring(false)} disabled={retirePending}>
                Cancel
              </Button>
              <Button variant="danger" loading={retirePending} onClick={() => void submitRetire()}>
                Retire
              </Button>
            </div>
          </div>
        </Dialog>
      )}
      {disposing && (
        <Dialog titleId="dispose-title" title={`Dispose of ${device.assetTag}?`} onClose={() => setDisposing(false)} size="sm">
          <div className="flex flex-col gap-1">
            <Checkbox
              label="Key removed"
              checked={disposeChecked.key}
              onChange={(event) => setDisposeChecked((prev) => ({ ...prev, key: event.target.checked }))}
            />
            <Checkbox
              label="Node database cleared"
              checked={disposeChecked.node}
              onChange={(event) => setDisposeChecked((prev) => ({ ...prev, node: event.target.checked }))}
            />
            <Checkbox
              label="Owner cleared"
              checked={disposeChecked.owner}
              onChange={(event) => setDisposeChecked((prev) => ({ ...prev, owner: event.target.checked }))}
            />
            <div className="mt-3">
              <Field id="dispose-method" label="Method" required>
                <Input
                  id="dispose-method"
                  value={disposeMethod}
                  onChange={(event) => setDisposeMethod(event.target.value)}
                />
              </Field>
            </div>
            {disposeFailure && (
              <p role="alert" className={`${ALERT} mt-2`}>
                {disposeFailure}
              </p>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-3">
              <Button onClick={() => setDisposing(false)} disabled={disposePending}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={!disposeReady}
                loading={disposePending}
                onClick={() => void submitDispose()}
              >
                Dispose
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
};
