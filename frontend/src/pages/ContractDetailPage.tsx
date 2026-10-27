import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../app/providers/useAuth';
import { useBalance } from '../entities/billing/api';
import {
  cancelContract,
  contractKeys,
  downloadPdf,
  fetchHandoverNote,
  planLabel,
  STATUS_LABELS,
  STATUS_TONES,
  useContract,
  useTransitions,
  type ContractDetail,
  type ContractDevice,
} from '../entities/contract/api';
import { ApiError } from '../shared/api/apiClient';
import {
  formatDate,
  formatDateTime,
  formatDay,
  formatVnd,
  viewerTimeZone,
} from '../shared/lib/format';
import { hasAnyRole } from '../shared/lib/permissions';
import { Badge, ErrorState, Fact, Field, Loading, PageTitle } from '../shared/ui/bits';
import { invalid, messageOf } from '../shared/ui/errors';
import { Dialog } from '../shared/ui/Dialog';
import { useToast } from '../shared/ui/toastStore';
import {
  ALERT,
  CARD,
  DANGER_BUTTON,
  LINK,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from '../shared/ui/styles';
import { HolderDialog } from '../widgets/ContractActions/HolderDialog';
import { NoticeDialog } from '../widgets/ContractActions/NoticeDialog';

const CANCELLABLE = ['REQUESTED', 'APPROVED'];

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
    if (reason === '' || window.confirm('Discard the cancellation?')) onClose();
  };

  return (
    <Dialog titleId="cancel-title" title={`Cancel ${contract.code}?`} onClose={close}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-slate-700">
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
            className="rounded-lg border border-slate-400 p-3"
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
        <p role="alert" className="text-sm text-red-700">
          {note}
        </p>
      )}
    </div>
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
  const balance = useBalance(id, canSeeMoney && contract.isSuccess);
  const history = useTransitions(id, canSeeMoney && contract.isSuccess);
  const [cancelling, setCancelling] = useState(false);
  const [noticing, setNoticing] = useState(false);
  const [labelling, setLabelling] = useState<ContractDevice | null>(null);
  const isMember = hasAnyRole(roles, ['ORG_OPERATOR']);

  if (contract.isLoading) return <Loading label="Loading contract" />;
  if (contract.error || !contract.data) {
    return <ErrorState error={contract.error} onRetry={() => void contract.refetch()} />;
  }
  const data = contract.data;
  // Holder labels belong to the renting organization's members, on a contract not yet closed.
  const canLabel = scope === 'o' && isMember && data.status !== 'CLOSED';
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
      <p className="-mt-3 mb-5 text-slate-700">
        {planLabel(data)}, {data.quantity} x {data.hardwareVariant.code ?? 'variant'}
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
                {data.quantity} x {data.hardwareVariant.code ?? 'variant'}
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
              {data.reservationExpiresAt && (
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
            <h2 className="mb-3 text-lg font-bold text-slate-900">Prices fixed at request</h2>
            <dl className="grid gap-4 sm:grid-cols-3">
              <Fact label="Monthly price per device">{formatVnd(data.monthlyUnitPriceVnd)}</Fact>
              <Fact label="Holding fee">{Math.round(data.holdingFeeRatio * 100)} % of a term</Fact>
              {data.dayPremium !== null && <Fact label="Day premium">x {data.dayPremium}</Fact>}
            </dl>
          </div>

          <div className={CARD}>
            <h2 className="mb-3 text-lg font-bold text-slate-900">Terms</h2>
            {data.terms.length === 0 ? (
              <p className="text-sm text-slate-700">
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
            <h2 className="mb-3 text-lg font-bold text-slate-900">Devices</h2>
            {data.devices.length === 0 ? (
              <p className="text-sm text-slate-700">
                Devices are reserved when TrekLink approves the request.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-slate-600">
                  <tr>
                    <th className="py-2">Asset tag</th>
                    <th className="py-2">Holder</th>
                    <th className="py-2">Handed over</th>
                    <th className="py-2">Back</th>
                    {canLabel && <th className="py-2 sr-only">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.devices.map((device) => (
                    <tr key={device.deviceId} className="border-t border-slate-200">
                      <td className="py-2 font-mono">{device.assetTag ?? device.deviceId}</td>
                      <td className="py-2">{device.holder?.name ?? 'No label'}</td>
                      <td className="py-2">
                        <When iso={device.handedOverAt} />
                      </td>
                      <td className="py-2">
                        {device.lostAt ? 'Lost' : <When iso={device.checkedInAt} />}
                      </td>
                      {canLabel && (
                        <td className="py-2 text-right">
                          {device.handedOverAt && !device.checkedInAt && !device.lostAt && (
                            <button
                              type="button"
                              className={`${LINK} text-sm`}
                              onClick={() => setLabelling(device)}
                            >
                              {device.holder ? 'Edit label' : 'Label'}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {canSeeMoney && (
            <div className={CARD}>
              <h2 className="mb-3 text-lg font-bold text-slate-900">History</h2>
              {history.isLoading && <Loading />}
              {history.error && <ErrorState error={history.error} />}
              <ol className="flex flex-col gap-2 text-sm">
                {history.data?.map((step, index) => (
                  <li key={index} className="flex flex-wrap justify-between gap-2">
                    <span>
                      {step.fromStatus ? `${STATUS_LABELS[step.fromStatus]} to ` : ''}
                      {STATUS_LABELS[step.toStatus]}
                      {step.reason ? `: ${step.reason}` : ''}
                    </span>
                    <span className="text-slate-600">
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
              <h2 className="mb-3 text-lg font-bold text-slate-900">Balance</h2>
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
          {isStaff && data.status === 'APPROVED' && (
            <Link to={`/t/counter/${data.id}`} className={PRIMARY_BUTTON}>
              Open the counter
            </Link>
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
    </section>
  );
};
