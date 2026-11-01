import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../app/providers/useAuth';
import {
  deviceKeys,
  editFirmware,
  retireDevice,
  useDevice,
  useDeviceHistory,
  NEXT_STEP_LABELS,
  nextStepPath,
  type Device,
  type DeviceDetail,
  type NextAction,
  type NextStep,
} from '../entities/device/api';
import { formatDateTime } from '../shared/lib/format';
import { hasAnyRole } from '../shared/lib/permissions';
import { ErrorState, Fact, Loading, PageTitle } from '../shared/ui/bits';
import { Button } from '../shared/ui/Button';
import { buttonClasses } from '../shared/ui/buttonStyles';
import { Dialog } from '../shared/ui/Dialog';
import { Field, Input, Textarea } from '../shared/ui/Field';
import { DEVICE_STATUS, MAINTENANCE_STATUS, type DeviceStatus } from '../shared/ui/status';
import { StatusBadge } from '../shared/ui/Badge';
import { ReportLossDialog } from '../features/report-loss/ReportLossDialog';
import { DisposeDialog, IntakeDialog, ResetDialog } from '../widgets/DeviceActions/DeviceDialogs';
import { deviceFailure, MSG29 } from '../widgets/DeviceActions/deviceFailure';
import { useToast } from '../shared/ui/toastStore';
import { CARD, LINK } from '../shared/ui/styles';

const MSG03 = 'Saved.';
// The unit's next step back to AVAILABLE (devices api-design 07 nextStep, REQ-EVT-23, D-092 rule 4):
// the reset and the inspection are recorded at the counter of the contract it came back on, the
// maintenance on its page, and the intake check here.
const NEXT_STEP_TEXT: Record<NextAction, string> = {
  RESET: 'Record the reset at the counter of the contract it came back on, then inspect it there.',
  INSPECT: 'Inspect it at the counter of the contract it came back on. A pass makes it available.',
  COMPLETE_MAINTENANCE: 'Complete its open maintenance record, then record an intake check here.',
  INTAKE: 'Record an intake check on this page. A pass makes it available.',
};

const NextStepPanel: React.FC<{ device: DeviceDetail; step: NextStep }> = ({ device, step }) => {
  const path = step.action === 'INTAKE' ? null : nextStepPath(step, device.id);
  return (
    <div className={CARD} aria-labelledby="next-step-title" role="region">
      <h2 id="next-step-title" className="mb-1 text-lg font-bold text-ink">
        Next step: {NEXT_STEP_LABELS[step.action]}
      </h2>
      <p className="text-sm text-ink-muted">{NEXT_STEP_TEXT[step.action]}</p>
      {path && (
        <Link to={path} className={`${LINK} mt-2 inline-block text-sm`}>
          {step.action === 'COMPLETE_MAINTENANCE' ? 'Open maintenance' : 'Open the counter'}
        </Link>
      )}
      {!path && step.action === 'RESET' && (
        <p className="mt-2 text-sm text-ink-muted">
          It came back outside a contract: record the reset on this page.
        </p>
      )}
      {!path && step.action === 'INSPECT' && (
        <p className="mt-2 text-sm text-ink-muted">
          It came back outside a contract, and no counter records its inspection yet.
        </p>
      )}
    </div>
  );
};

// The six working states a device is reported lost from (devices REQ-EVT-13, screen 4.4). A copy of
// `IN_SERVICE` in backend/src/modules/devices/loss-cases.service.ts, which decides; the frontend has no
// shared constant for it, so a change there is made here too.
const IN_SERVICE: readonly DeviceStatus[] = [
  'IN_INTAKE',
  'AVAILABLE',
  'RESERVED',
  'RENTED',
  'RETURNED',
  'MAINTENANCE',
];

const failureOf = deviceFailure;

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
// /t/devices/:id, DeviceDetailPage of screen 4.2 (devices api-design 05 to 10, 16, 23 and monitoring
// api-design 07). TrekLink Staff may register, edit firmware, intake check, reset and report a unit in
// service lost (devices api-design 17, screen 4.4); Admin also retires and disposes (D-057 rule 7).
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
  const [retiring, setRetiring] = useState(false);
  const [retireReason, setRetireReason] = useState('');
  const [retireFailure, setRetireFailure] = useState<string | null>(null);
  const [retirePending, setRetirePending] = useState(false);
  const [disposing, setDisposing] = useState(false);
  const [reportingLoss, setReportingLoss] = useState(false);

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

  const canIntake = device.status === 'IN_INTAKE' || (device.status === 'MAINTENANCE' && !device.openMaintenance);
  const canReset = device.status === 'RETURNED';
  const canRetire = isAdmin && device.status === 'MAINTENANCE';
  const canDispose = isAdmin && device.status === 'RETIRED';

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
                    {MAINTENANCE_STATUS[device.openMaintenance.status].label}, {device.openMaintenance.description}
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

          {device.nextStep && <NextStepPanel device={device} step={device.nextStep} />}

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
            {canRetire && (
              // Disabled while a maintenance record is open, since the server refuses with
              // MAINTENANCE_OPEN (leader ruling, 2026-10-30); the hint says why.
              <Button
                variant="danger"
                disabled={Boolean(device.openMaintenance)}
                aria-describedby={device.openMaintenance ? 'retire-blocked' : undefined}
                onClick={() => setRetiring(true)}
              >
                Retire
              </Button>
            )}
            {canRetire && device.openMaintenance && (
              <p id="retire-blocked" className="w-full text-body-sm text-ink-muted">
                {MSG29}
              </p>
            )}
            {canDispose && <Button variant="danger" onClick={() => setDisposing(true)}>Dispose</Button>}
            {/* Screen 4.2: position history in any state, on its own route (screen 9.2); the asset tag
                travels along for the history heading. */}
            <Link
              to={`/t/devices/${device.id}/telemetry`}
              state={{ assetTag: device.assetTag }}
              className={buttonClasses('secondary')}
            >
              Position history
            </Link>
            {IN_SERVICE.includes(device.status) && (
              <Button variant="danger" onClick={() => setReportingLoss(true)}>
                Report lost
              </Button>
            )}
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

      {reportingLoss && (
        <ReportLossDialog
          deviceId={device.id}
          assetTag={device.assetTag}
          scope="t"
          onClose={() => setReportingLoss(false)}
          onReported={(reported) => {
            setReportingLoss(false);
            void refresh();
            navigate(`/t/loss-cases/${reported.id}`);
          }}
        />
      )}

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
        <ResetDialog
          device={device}
          onDone={() => void (async () => {
            setResetting(false);
            await refresh();
          })()}
          onCancel={() => setResetting(false)}
        />
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
        <DisposeDialog
          device={device}
          onDone={() => void (async () => {
            setDisposing(false);
            await refresh();
          })()}
          onCancel={() => setDisposing(false)}
        />
      )}
    </section>
  );
};
