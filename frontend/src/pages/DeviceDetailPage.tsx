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
  type DeviceHistoryItem,
  type NextAction,
  type NextStep,
} from '../entities/device/api';
import { VariantCard } from '../entities/variant/VariantCard';
import { formatDate, formatDateTime } from '../shared/lib/format';
import { hasAnyRole } from '../shared/lib/permissions';
import { ErrorState, Fact, Loading, PageTitle, Pager } from '../shared/ui/bits';
import { Button } from '../shared/ui/Button';
import { Dialog } from '../shared/ui/Dialog';
import { Field, Input, Textarea } from '../shared/ui/Field';
import { DEVICE_STATUS, MAINTENANCE_STATUS, type DeviceStatus } from '../shared/ui/status';
import { StatusBadge } from '../shared/ui/Badge';
import { ReportLossDialog } from '../features/report-loss/ReportLossDialog';
import { DisposeDialog, IntakeDialog, ResetDialog } from '../widgets/DeviceActions/DeviceDialogs';
import { deviceFailure, MSG29 } from '../widgets/DeviceActions/deviceFailure';
import { StickyPageHeader, PageScrollBody } from '../shared/ui/PageChrome';
import { RecordActionBar, type RecordAction } from '../shared/ui/RecordActionBar';
import { useToast } from '../shared/ui/toastStore';
import { useMediaQuery } from '../shared/lib/useMediaQuery';
import { PositionMap } from '../widgets/LiveMapWidget/PositionMap';
import { CARD, FACT_LIST_PHONE, LINK } from '../shared/ui/styles';

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

// Who holds the unit (W20B item 3). devices api-design 07 has no holder field; the key organization is
// set when rentals provisions a reserved unit and cleared at the reset (REQ-EVT-04, REQ-EVT-06), so a
// reserved, rented or lost unit with a key is held for that organization, and any other unit by TrekLink.
const HELD_FOR_ORGANIZATION: readonly DeviceStatus[] = ['RESERVED', 'RENTED', 'LOST'];
const holderOf = (device: Device): string =>
  HELD_FOR_ORGANIZATION.includes(device.status) && device.keyOrganization
    ? `${device.keyOrganization.legalName} (${device.keyOrganization.code})`
    : 'TrekLink';

// Where a history row leads (screen 4.2, "History row link"): the contract, the loss case, the incident
// or the maintenance record it names. A maintenance row opens /t/maintenance with the record's id in the
// navigation state, and that page opens the record. An incident row opens the Staff incident detail,
// /t/incidents/:id (#386). Other references (an inspection, an intake check, the key's organization) have
// no page of their own and stay plain text.
const historyLink = (
  item: Pick<DeviceHistoryItem, 'refType' | 'refId'>,
): { to: string; state?: Record<string, string> } | null => {
  if (!item.refId) return null;
  switch (item.refType) {
    case 'CONTRACT':
      return { to: `/t/contracts/${item.refId}` };
    case 'LOSS_CASE':
      return { to: `/t/loss-cases/${item.refId}` };
    case 'INCIDENT':
      return { to: `/t/incidents/${item.refId}` };
    case 'MAINTENANCE':
      return { to: '/t/maintenance', state: { recordId: item.refId } };
    default:
      return null;
  }
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
// /t/devices/:id, DeviceDetailPage of screen 4.2 (devices api-design 05 to 10, 16, 23 and monitoring
// api-design 07). TrekLink Staff may register, edit firmware, intake check, reset and report a unit in
// service lost (devices api-design 17, screen 4.4); Admin also retires and disposes (D-057 rule 7).
// Below 600 px the facts are one compact list and the actions a bar pinned to the bottom (§10.5).
export const DeviceDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const isAdmin = hasAnyRole(user?.roles ?? [], ['ADMIN']);
  const { data: device, isLoading, error, refetch } = useDevice(id);
  // Paged as the spec's query key ['device-history', id, page] says, 20 rows a page.
  const [historyPage, setHistoryPage] = useState(1);
  const { data: history } = useDeviceHistory(id, historyPage);
  const [editingFirmware, setEditingFirmware] = useState(false);
  const [intaking, setIntaking] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [retireReason, setRetireReason] = useState('');
  const [retireFailure, setRetireFailure] = useState<string | null>(null);
  const [retirePending, setRetirePending] = useState(false);
  const [disposing, setDisposing] = useState(false);
  const [reportingLoss, setReportingLoss] = useState(false);
  const phone = !useMediaQuery('(min-width: 600px)', true);

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
      <section aria-labelledby="device-title">
        <Link to="/t/fleet" className={`${LINK} inline-flex min-h-6 items-center`}>
          Back to devices
        </Link>
        {/* The page keeps its one h1 when the device cannot be read (axe page-has-heading-one). */}
        <h1 id="device-title" className="mt-3 text-title-lg text-ink">
          Device
        </h1>
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

  // The page's actions in their wide order; below 600 px they move into the bar pinned to the bottom.
  const actions: RecordAction[] = [
    ...(device.status !== 'DISPOSED'
      ? [{ key: 'firmware', label: 'Edit firmware', onSelect: () => setEditingFirmware(true) }]
      : []),
    ...(canIntake
      ? [{ key: 'intake', label: 'Record intake check', tone: 'primary' as const, onSelect: () => setIntaking(true) }]
      : []),
    ...(canReset
      ? [{ key: 'reset', label: 'Record reset', tone: 'primary' as const, onSelect: () => setResetting(true) }]
      : []),
    ...(device.status === 'AVAILABLE' && !device.openMaintenance
      ? [
          {
            key: 'maintenance',
            label: 'Open maintenance',
            onSelect: () => navigate('/t/maintenance', { state: { deviceId: device.id } }),
          },
        ]
      : []),
    // Unavailable while a maintenance record is open, since the server refuses with
    // MAINTENANCE_OPEN (leader ruling, 2026-10-30); the reason says why.
    ...(canRetire
      ? [
          {
            key: 'retire',
            label: 'Retire',
            tone: 'danger' as const,
            reason: device.openMaintenance ? MSG29 : undefined,
            onSelect: () => setRetiring(true),
          },
        ]
      : []),
    ...(canDispose
      ? [{ key: 'dispose', label: 'Dispose', tone: 'danger' as const, onSelect: () => setDisposing(true) }]
      : []),
    // Screen 4.2: position history in any state, on its own route (screen 9.2); the asset tag
    // travels along for the history heading.
    {
      key: 'history',
      label: 'Position history',
      to: `/t/devices/${device.id}/telemetry`,
      state: { assetTag: device.assetTag },
    },
    ...(IN_SERVICE.includes(device.status)
      ? [{ key: 'lost', label: 'Report lost', tone: 'danger' as const, onSelect: () => setReportingLoss(true) }]
      : []),
  ];

  // The variant card comes from the unit's own payload (devices design section 10). Below 600 px it
  // follows the facts and the next step, so the first screen of a phone reads the unit's state.
  const variantCard = (
    <div className={CARD}>
      <VariantCard variant={device.hardwareVariant} render="detail" headingLevel="h2" />
    </div>
  );

  return (
    <section aria-labelledby="device-title" data-fit-page="" className="flex min-h-0 flex-1 flex-col">
      {/* The back link and the title stay pinned together (ui standard §7). */}
      <StickyPageHeader>
        <Link to="/t/fleet" className={`${LINK} inline-flex min-h-6 items-center self-start`}>
          Back to devices
        </Link>
        <div className="mt-3">
          <PageTitle
            id="device-title"
            title={device.assetTag}
            action={<StatusBadge entry={DEVICE_STATUS[device.status]} />}
          />
        </div>
      </StickyPageHeader>

      {/* The record body is the one scroll region; the title and the actions stay (ui standard §7). */}
      <PageScrollBody label="Device details">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            {!phone && variantCard}
            <div className={CARD}>
              <dl className={phone ? FACT_LIST_PHONE : 'grid gap-3 sm:grid-cols-2'}>
                {/* The facts a person checks first, ahead of the render on a phone (W20B item 3). */}
                <Fact label="Holder">{holderOf(device)}</Fact>
                <Fact label="Battery">{device.batteryPct !== null ? `${device.batteryPct}%` : 'Not reported'}</Fact>
                <Fact label="Last seen">{device.lastSeenAt ? formatDateTime(device.lastSeenAt) : 'Never heard'}</Fact>
                <Fact label="Node">{device.nodeId} ({device.nodeNum})</Fact>
                <Fact label="Hardware variant">{device.hardwareVariant.code}</Fact>
                <Fact label="Acquired">{formatDate(device.acquiredAt)}</Fact>
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
              </dl>
            </div>

            {device.nextStep && <NextStepPanel device={device} step={device.nextStep} />}

            {phone && variantCard}

            {/* Screen 4.2: the last position on a small map with the overlay, coordinates under it. */}
            <section className={CARD} aria-labelledby="device-position">
              <h2 id="device-position" className="mb-3 text-title-sm text-ink">
                Last position
              </h2>
              <PositionMap position={device.lastPosition} label={device.assetTag} seenAt={device.lastSeenAt} />
            </section>

            {!phone && <RecordActionBar label="Device actions" actions={actions} />}
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
                  {history.items.map((item, index) => {
                    const link = historyLink(item);
                    return (
                      <li key={`${item.at}-${index}`}>
                        <p className="text-body-sm text-ink-muted">
                          {formatDateTime(item.at)}, {item.actor}
                        </p>
                        {link ? (
                          <Link
                            to={link.to}
                            state={link.state}
                            className={`${LINK} inline-flex min-h-6 items-center text-body`}
                          >
                            {item.summary}
                          </Link>
                        ) : (
                          <p className="text-body text-ink">{item.summary}</p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
              {history && (
                <Pager pageNumber={historyPage} totalPages={history.totalPages} onPage={setHistoryPage} />
              )}
            </section>
          </div>
        </div>
      </PageScrollBody>

      {phone && <RecordActionBar label="Device actions" actions={actions} />}

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
