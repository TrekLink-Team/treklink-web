import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../app/providers/useAuth';
import { useBalance, useVariantName } from '../entities/billing/api';
import {
  cancelContract,
  contractKeys,
  downloadPdf,
  fetchHandoverNote,
  planLabel,
  STATUS_LABELS,
  STATUS_TONES,
  useCloseCheck,
  useContract,
  useTransitions,
  type ContractDetail,
  type ContractDevice,
} from '../entities/contract/api';
import { NEXT_STEP_LABELS, nextStepPath } from '../entities/device/api';
import { CloseBlockers } from '../features/close-contract/CloseBlockers';
import { CloseContractDialog } from '../features/close-contract/CloseContractDialog';
import { ApiError } from '../shared/api/apiClient';
import {
  formatDate,
  formatDateTime,
  formatDay,
  formatInstantsIn,
  formatVnd,
  viewerTimeZone,
} from '../shared/lib/format';
import { hasAnyRole } from '../shared/lib/permissions';
import { Badge, ErrorState, Fact, Field, Loading, PageTitle } from '../shared/ui/bits';
import { invalid, messageOf } from '../shared/ui/errors';
import { Dialog } from '../shared/ui/Dialog';
import { useConfirmStep } from '../shared/ui/useConfirmStep';
import { useToast } from '../shared/ui/toastStore';
import {
  ALERT,
  CARD,
  DANGER_BUTTON,
  LINK,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from '../shared/ui/styles';
import { matchesText } from '../shared/lib/filter';
import { HolderDialog } from '../widgets/ContractActions/HolderDialog';
import { ReportLossDialog } from '../features/report-loss/ReportLossDialog';
import {
  DataTable,
  DEVICE_STATUS,
  StatusBadge,
  Toolbar,
  ToolbarSearch,
  type Column,
  type RowAction,
} from '../shared/ui';
import { NoticeDialog } from '../widgets/ContractActions/NoticeDialog';

const CANCELLABLE = ['REQUESTED', 'APPROVED'];

// Staff open the counter for the handover (5.4) and for the return, inspection and close (5.5).
const COUNTER_STATES = [
  'APPROVED',
  'ACTIVE',
  'ENDING',
  'RETURN_DUE',
  'OVERDUE',
  'DEFAULTED',
  'RETURNED',
];

const When: React.FC<{ iso: string | null | undefined }> = ({ iso }) =>
  iso ? (
    <time dateTime={iso} title={viewerTimeZone()}>
      {formatDateTime(iso)}
    </time>
  ) : (
    <>Not yet</>
  );

// The cancel dialog of screen 5.2: the reason is required and sent with the version the page saw;
// a holding fee already paid is retained (MSG15).
const CancelDialog: React.FC<{ contract: ContractDetail; onClose: () => void }> = ({
  contract,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState(false);
  const discard = useConfirmStep();

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: contractKeys.detail(contract.id) }),
      queryClient.invalidateQueries({ queryKey: contractKeys.all }),
      queryClient.invalidateQueries({ queryKey: contractKeys.balance(contract.id) }),
      queryClient.invalidateQueries({ queryKey: contractKeys.transitions(contract.id) }),
    ]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reason.trim() === '') {
      setError('Reason is required.');
      return;
    }
    setPending(true);
    try {
      const cancelled = await cancelContract(contract.id, reason.trim(), contract.version);
      await refresh();
      showToast(`Contract cancelled. Retained: ${formatVnd(cancelled.retainedVnd)}.`);
      onClose();
    } catch (failure) {
      setPending(false);
      if (failure instanceof ApiError && failure.errorCode === 'STALE_VERSION') setStale(true);
      else setError(failure instanceof ApiError ? failure.message : 'Something went wrong.');
      if (failure instanceof ApiError && failure.errorCode === 'INVALID_STATE_TRANSITION') {
        void refresh();
      }
    }
  };

  const close = () => {
    if (reason === '') onClose();
    else
      discard.ask(
        {
          title: 'Discard the cancellation?',
          description: 'The reason you typed is lost; the contract stays as it is.',
          confirmLabel: 'Discard',
        },
        onClose,
      );
  };

  return (
    <>
      <Dialog titleId="cancel-title" title={`Cancel ${contract.code}?`} onClose={close}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">
            The reserved devices are released. A holding fee already paid is retained.
          </p>
          {stale && (
            <div role="alert" className={`${ALERT} flex items-center justify-between gap-3`}>
              <span>Someone else changed this. Reload to see the latest.</span>
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => {
                  void refresh();
                  onClose();
                }}
              >
                Reload
              </button>
            </div>
          )}
          <Field id="cancel-reason" label="Reason" error={error ?? undefined}>
            <textarea
              id="cancel-reason"
              rows={3}
              className="rounded-lg border border-line-strong p-3"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              {...invalid('cancel-reason', error ?? undefined)}
            />
          </Field>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="submit" disabled={pending} className={`${DANGER_BUTTON} flex-1`}>
              {pending ? 'Cancelling…' : 'Cancel contract'}
            </button>
            <button type="button" onClick={close} className={`${SECONDARY_BUTTON} flex-1`}>
              Keep contract
            </button>
          </div>
        </form>
      </Dialog>
      {discard.dialog}
    </>
  );
};

// The signed handover note (rentals api-design 11) as a download, with its integrity check: a note
// whose hash no longer matches the one recorded at signing still downloads, with a warning.
const HandoverNoteButton: React.FC<{ contract: ContractDetail }> = ({ contract }) => {
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const download = async () => {
    setPending(true);
    setNote(null);
    try {
      const stored = await fetchHandoverNote(contract.id);
      if (stored.pdfBase64) downloadPdf(stored.pdfBase64, `${contract.code}-handover-note.pdf`);
      if (stored.integrity === 'MISMATCH') {
        setNote('This note does not match the one signed at the counter. Tell TrekLink Staff.');
      } else if (stored.integrity === 'MISSING') {
        setNote('The stored note cannot be found. Tell TrekLink Staff.');
      }
    } catch (failure) {
      setNote(messageOf(failure));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className={SECONDARY_BUTTON}
        disabled={pending}
        onClick={() => void download()}
      >
        {pending ? 'Preparing…' : 'Download handover note'}
      </button>
      {note && (
        <p role="alert" className="text-sm text-status-critical-fg">
          {note}
        </p>
      )}
    </div>
  );
};

// The state of a returned unit now and its next step back to AVAILABLE (rentals api-design 03
// afterReturn, devices REQ-EVT-23), with a link to where the step is recorded.
const AfterReturn: React.FC<{ device: ContractDevice }> = ({ device }) => {
  const after = device.afterReturn;
  if (!after) return null;
  const step = after.nextStep;
  const path = step ? nextStepPath(step, device.deviceId) : null;
  return (
    <span className="flex flex-col gap-1">
      <StatusBadge entry={DEVICE_STATUS[after.status]} />
      {step &&
        (path ? (
          <Link to={path} className={`${LINK} text-sm`}>
            Next: {NEXT_STEP_LABELS[step.action]}
          </Link>
        ) : (
          <span className="text-sm text-ink-muted">Next: {NEXT_STEP_LABELS[step.action]}</span>
        ))}
    </span>
  );
};

// /o/contracts/:id and /t/contracts/:id, the contract detail of screen 5.2 (rentals api-design 03,
// 06, 11, 12, 13, 18; billing api-design 10). The Org Operator reads it without balance, history,
// notice or cancel, and may label holders.
export const ContractDetailPage: React.FC<{ scope: 'o' | 't' }> = ({ scope }) => {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const isStaff = hasAnyRole(roles, ['STAFF']);
  const isManager = hasAnyRole(roles, ['ORG_MANAGER']);
  const canSeeMoney = isStaff || isManager;
  const contract = useContract(id);
  const variantName = useVariantName();
  const balance = useBalance(id, canSeeMoney && contract.isSuccess);
  const history = useTransitions(id, canSeeMoney && contract.isSuccess);
  const [cancelling, setCancelling] = useState(false);
  const [noticing, setNoticing] = useState(false);
  const [labelling, setLabelling] = useState<ContractDevice | null>(null);
  const [reporting, setReporting] = useState<ContractDevice | null>(null);
  const [staffReporting, setStaffReporting] = useState<{ deviceId: string; assetTag: string } | null>(
    null,
  );
  const [closing, setClosing] = useState(false);
  // Staff see the Close action whenever the close check passes, and what blocks it otherwise
  // (rentals api-design 20, D-092 rule 3).
  const closeCheck = useCloseCheck(
    id,
    scope === 't' &&
      isStaff &&
      Boolean(contract.data?.handedOverAt) &&
      contract.data?.status !== 'CLOSED',
  );
  const isMember = hasAnyRole(roles, ['ORG_OPERATOR']);
  const [tag, setTag] = useState('');
  const [holder, setHolder] = useState('');

  if (contract.isLoading) return <Loading label="Loading contract" />;
  if (contract.error || !contract.data) {
    return <ErrorState error={contract.error} onRetry={() => void contract.refetch()} />;
  }
  const data = contract.data;
  const devices = data.devices.filter(
    (device) =>
      matchesText(tag, device.assetTag, device.deviceId) &&
      matchesText(holder, device.holder?.name ?? 'No label'),
  );
  // The device rows (W29): the shared DataTable; Label and Report lost are row actions on a unit that
  // is out, named after its asset tag.
  const deviceColumns: Column<ContractDevice>[] = [
    {
      key: 'tag',
      header: 'Asset tag',
      cell: (device) => (
        <span className="whitespace-nowrap">
          <span className="font-mono">{device.assetTag ?? device.deviceId}</span>
          {device.handedOverAt && (
            <Link
              to={`/${scope}/devices/${device.deviceId}/telemetry`}
              state={{ assetTag: device.assetTag }}
              className={`${LINK} ml-3 text-sm`}
            >
              History
            </Link>
          )}
        </span>
      ),
    },
    { key: 'holder', header: 'Holder', cell: (device) => device.holder?.name ?? 'No label' },
    { key: 'out', header: 'Handed over', cell: (device) => <When iso={device.handedOverAt} /> },
    { key: 'back', header: 'Back', cell: (device) => (device.lostAt ? 'Lost' : <When iso={device.checkedInAt} />) },
  ];

  // Holder labels belong to the renting organization's members, on a contract not yet closed.
  const canLabel = scope === 'o' && isMember && data.status !== 'CLOSED';
  // The Org Manager reports a unit that is out as lost (devices api-design 17, screen 4.4).
  const canReport = scope === 'o' && isManager && data.status !== 'CLOSED';
  const hasActions = canLabel || canReport;
  // The unit's state after the return and its next step back to AVAILABLE (D-092 rule 4), TrekLink
  // detail only: the read carries afterReturn for TrekLink callers alone.
  const showState = scope === 't' && data.devices.some((device) => device.afterReturn);
  if (showState) deviceColumns.push({ key: 'state', header: 'State now', cell: (device) => <AfterReturn device={device} /> });
  const deviceActions = (device: ContractDevice): RowAction[] =>
    device.handedOverAt && !device.checkedInAt && !device.lostAt
      ? [
          ...(canLabel
            ? [{ key: 'label', label: device.holder ? 'Edit label' : 'Label', onSelect: () => setLabelling(device) }]
            : []),
          ...(canReport
            ? [{ key: 'report', label: 'Report lost', destructive: true, onSelect: () => setReporting(device) }]
            : []),
        ]
      : [];
  const back = scope === 'o' ? '/o/contracts' : '/t/contracts';
  const invoices =
    scope === 'o' ? `/o/invoices?contractId=${data.id}` : `/t/billing?contractId=${data.id}`;

  return (
    <section aria-labelledby="contract-title">
      <Link to={back} className={`${LINK} text-sm`}>
        Back to contracts
      </Link>
      <PageTitle
        id="contract-title"
        title={data.code}
        action={<Badge tone={STATUS_TONES[data.status]}>{STATUS_LABELS[data.status]}</Badge>}
      />
      <p className="-mt-3 mb-5 text-ink-muted">
        {planLabel(data)}, {data.quantity} x {variantName(data.hardwareVariant)}
        {scope === 't' && data.organization ? ` for ${data.organization.legalName}` : ''}
      </p>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-5">
          <div className={CARD}>
            <dl className="grid gap-4 sm:grid-cols-3">
              {scope === 't' && data.organization && (
                <Fact label="Organization">
                  {data.organization.code}, {data.organization.legalName}
                </Fact>
              )}
              <Fact label="Plan">{planLabel(data)}</Fact>
              <Fact label="Devices">
                {data.quantity} x {variantName(data.hardwareVariant)}
              </Fact>
              <Fact label="Requested start">{formatDay(data.requestedStartDate)}</Fact>
              <Fact label="Handed over">
                <When iso={data.handedOverAt} />
              </Fact>
              <Fact label="Current term">
                {data.currentTerm
                  ? `Term ${data.currentTerm.seq}, ${formatDate(data.currentTerm.startsAt)} to ${formatDate(data.currentTerm.endsAt)}`
                  : 'Not started'}
              </Fact>
              {data.handoverAppointmentAt && (
                <Fact label="Handover appointment">
                  <When iso={data.handoverAppointmentAt} />
                </Fact>
              )}
              {/* D-092: a request holds its units at once; an unpaid hold ends here and the request is cancelled (rentals REQ-EVT-17). */}
              {data.status === 'REQUESTED' && data.holdExpiresAt && (
                <Fact label="Devices held until">
                  <When iso={data.holdExpiresAt} />
                </Fact>
              )}
              {/* The reservation holds the units from approval to the handover (rentals REQ-EVT-02, REQ-EVT-14). */}
              {data.status === 'APPROVED' && data.reservationExpiresAt && (
                <Fact label="Reservation expires">
                  <When iso={data.reservationExpiresAt} />
                </Fact>
              )}
              {data.noticeGivenAt && (
                <Fact label="Notice given">
                  <When iso={data.noticeGivenAt} />
                </Fact>
              )}
              {data.returnDueAt && (
                <Fact label="Return due">
                  <When iso={data.returnDueAt} />
                </Fact>
              )}
            </dl>
          </div>

          <div className={CARD}>
            <h2 className="mb-3 text-lg font-bold text-ink">Prices fixed at request</h2>
            <dl className="grid gap-4 sm:grid-cols-3">
              <Fact label="Monthly price per device">{formatVnd(data.monthlyUnitPriceVnd)}</Fact>
              <Fact label="Holding fee">{Math.round(data.holdingFeeRatio * 100)} % of a term</Fact>
              {data.dayPremium !== null && <Fact label="Day premium">x {data.dayPremium}</Fact>}
            </dl>
          </div>

          <div className={CARD}>
            <h2 className="mb-3 text-lg font-bold text-ink">Terms</h2>
            {data.terms.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Term 1 is created when TrekLink approves the request.
              </p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {data.terms.map((term) => (
                  <li key={term.seq} className="flex justify-between">
                    <span>
                      Term {term.seq}: {formatDateTime(term.startsAt)} to{' '}
                      {formatDateTime(term.endsAt)}
                    </span>
                    <span className="font-semibold">
                      {term.status === 'OPEN' ? 'Open' : 'Closed'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={CARD}>
            <h2 className="mb-3 text-lg font-bold text-ink">Devices</h2>
            {data.devices.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Devices are reserved when TrekLink approves the request.
              </p>
            ) : (
              <>
                <Toolbar
                  label="Device filters"
                  start={
                    <>
                      <ToolbarSearch id="contract-device-tag" label="Search by asset tag" value={tag} onChange={setTag} />
                      <ToolbarSearch id="contract-device-holder" label="Search by holder" value={holder} onChange={setHolder} />
                    </>
                  }
                />
                <DataTable<ContractDevice>
                  caption={`Devices of ${data.code}`}
                  columns={deviceColumns}
                  rows={devices}
                  rowId={(device) => device.deviceId}
                  rowLabel={(device) => device.assetTag ?? device.deviceId}
                  empty={{
                    title: 'No devices match these filters.',
                    action: (
                      <button
                        type="button"
                        className={`${LINK} text-sm`}
                        onClick={() => {
                          setTag('');
                          setHolder('');
                        }}
                      >
                        Clear filters
                      </button>
                    ),
                  }}
                  rowActions={hasActions ? deviceActions : undefined}
                />
              </>
            )}
          </div>

          {canSeeMoney && (
            <div className={CARD}>
              <h2 className="mb-3 text-lg font-bold text-ink">History</h2>
              {history.isLoading && <Loading />}
              {history.error && <ErrorState error={history.error} />}
              <ol className="flex flex-col gap-2 text-sm">
                {history.data?.map((step, index) => (
                  <li key={index} className="flex flex-wrap justify-between gap-2">
                    <span>
                      {step.fromStatus ? `${STATUS_LABELS[step.fromStatus]} to ` : ''}
                      {STATUS_LABELS[step.toStatus]}
                      {step.reason ? `: ${formatInstantsIn(step.reason)}` : ''}
                    </span>
                    <span className="text-ink-muted">
                      {step.actor ?? 'System'}, {formatDateTime(step.createdAt)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-5">
          {canSeeMoney && (
            <div className={CARD} aria-live="polite">
              <h2 className="mb-3 text-lg font-bold text-ink">Balance</h2>
              {balance.isLoading && <Loading />}
              {balance.data && (
                <dl className="flex flex-col gap-2 text-sm">
                  <div className="flex justify-between">
                    <dt>Due now</dt>
                    <dd className="font-semibold">{formatVnd(balance.data.dueNowVnd)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Due later</dt>
                    <dd className="font-semibold">{formatVnd(balance.data.dueLaterVnd)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Paid</dt>
                    <dd className="font-semibold">{formatVnd(balance.data.paidVnd)}</dd>
                  </div>
                </dl>
              )}
              <Link to={invoices} className={`${LINK} mt-3 inline-block text-sm`}>
                Invoices
              </Link>
            </div>
          )}

          {isManager && data.planType === 'MONTHLY' && data.status === 'ACTIVE' && (
            <button type="button" className={PRIMARY_BUTTON} onClick={() => setNoticing(true)}>
              Give notice
            </button>
          )}
          {canSeeMoney && CANCELLABLE.includes(data.status) && (
            <button type="button" className={DANGER_BUTTON} onClick={() => setCancelling(true)}>
              Cancel contract
            </button>
          )}
          {isStaff && COUNTER_STATES.includes(data.status) && (
            <Link to={`/t/counter/${data.id}`} className={PRIMARY_BUTTON}>
              Open the counter
            </Link>
          )}
          {scope === 't' && isStaff && data.handedOverAt && data.status !== 'CLOSED' && (
            <div className={CARD} aria-live="polite">
              <h2 className="mb-3 text-lg font-bold text-ink">Close</h2>
              {closeCheck.isLoading && <Loading />}
              {closeCheck.error && (
                <ErrorState error={closeCheck.error} onRetry={() => void closeCheck.refetch()} />
              )}
              {closeCheck.data?.canClose ? (
                <>
                  <p className="mb-3 text-sm text-ink-muted">Nothing blocks the close.</p>
                  <button type="button" className={PRIMARY_BUTTON} onClick={() => setClosing(true)}>
                    Close contract
                  </button>
                </>
              ) : (
                closeCheck.data && (
                  <CloseBlockers
                    check={closeCheck.data}
                    onReportLost={(blocker) =>
                      setStaffReporting({ deviceId: blocker.deviceId, assetTag: blocker.assetTag })
                    }
                  />
                )
              )}
            </div>
          )}
          {canSeeMoney && data.handedOverAt && <HandoverNoteButton contract={data} />}
          {isStaff && data.status === 'REQUESTED' && (
            <Link to="/t/contracts" className={PRIMARY_BUTTON}>
              Open the approval queue
            </Link>
          )}
        </div>
      </div>

      {cancelling && <CancelDialog contract={data} onClose={() => setCancelling(false)} />}
      {noticing && <NoticeDialog contract={data} onClose={() => setNoticing(false)} />}
      {labelling && (
        <HolderDialog contract={data} device={labelling} onClose={() => setLabelling(null)} />
      )}
      {closing && closeCheck.data && (
        <CloseContractDialog
          contractId={data.id}
          code={data.code}
          version={closeCheck.data.version}
          onClose={() => setClosing(false)}
        />
      )}
      {staffReporting && (
        <ReportLossDialog
          deviceId={staffReporting.deviceId}
          assetTag={staffReporting.assetTag}
          scope="t"
          onClose={() => setStaffReporting(null)}
          onReported={() => setStaffReporting(null)}
        />
      )}
      {reporting && (
        <ReportLossDialog
          deviceId={reporting.deviceId}
          assetTag={reporting.assetTag ?? reporting.deviceId}
          scope="o"
          onClose={() => setReporting(null)}
          onReported={() => undefined}
        />
      )}
    </section>
  );
};
