import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  approveContract,
  contractKeys,
  planLabel,
  rejectContract,
  STATUS_LABELS,
  STATUS_TONES,
  useContracts,
  type Approved,
  type Contract,
  type ContractStatus,
} from '../entities/contract/api';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime, formatDay, formatVnd } from '../shared/lib/format';
import { Badge, Empty, ErrorState, Field, Loading, PageTitle, Pager } from '../shared/ui/bits';
import { invalid } from '../shared/ui/errors';
import { Dialog } from '../shared/ui/Dialog';
import { useToast } from '../shared/ui/toastStore';
import {
  ALERT,
  CARD,
  DANGER_BUTTON,
  INPUT,
  LINK,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  TAB,
  TABLE,
  TD,
  TH,
} from '../shared/ui/styles';

const TABS: { label: string; status?: ContractStatus }[] = [
  { label: 'Requested', status: 'REQUESTED' },
  { label: 'Approved', status: 'APPROVED' },
  { label: 'All' },
];

// The appointment field starts on the requested start date at 09:00, the counter's opening hour,
// in the viewer's local time.
const appointmentOf = (day: string) => `${day}T09:00`;

interface Failure {
  message: string;
  stale?: boolean;
  shortfall?: boolean;
}

const failureOf = (error: unknown): Failure => {
  if (!(error instanceof ApiError)) return { message: 'Something went wrong. Please try again.' };
  return {
    message: error.message,
    stale: error.errorCode === 'STALE_VERSION',
    shortfall: error.errorCode === 'INSUFFICIENT_DEVICES',
  };
};

const RejectDialog: React.FC<{
  contract: Contract;
  onClose: () => void;
  onDone: () => void;
}> = ({ contract, onClose, onDone }) => {
  const showToast = useToast((state) => state.show);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reason.trim() === '') {
      setError('Reason is required.');
      return;
    }
    setPending(true);
    try {
      await rejectContract(contract.id, reason.trim(), contract.version);
      showToast('Saved.');
      onDone();
    } catch (failure) {
      setPending(false);
      setError(failureOf(failure).message);
    }
  };

  return (
    <Dialog
      titleId="reject-title"
      title={`Reject ${contract.code}?`}
      onClose={() => {
        if (reason === '' || window.confirm('Discard the rejection?')) onClose();
      }}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field id="reject-reason" label="Reason" error={error} hint="The Manager sees this reason.">
          <textarea
            id="reject-reason"
            rows={3}
            className="rounded-lg border border-slate-400 p-3"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            {...invalid('reject-reason', error)}
          />
        </Field>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="submit" disabled={pending} className={`${DANGER_BUTTON} flex-1`}>
            {pending ? 'Rejecting…' : 'Reject'}
          </button>
          <button type="button" onClick={onClose} className={`${SECONDARY_BUTTON} flex-1`}>
            Back
          </button>
        </div>
      </form>
    </Dialog>
  );
};

// The request panel: prices fixed at request, the handover appointment, Approve and Reject. The
// queue keys it by contract, so choosing another request starts a fresh form.
const RequestPanel: React.FC<{ contract: Contract; onDecided: () => void }> = ({
  contract,
  onDecided,
}) => {
  const showToast = useToast((state) => state.show);
  const [appointment, setAppointment] = useState(appointmentOf(contract.requestedStartDate));
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [approved, setApproved] = useState<Approved | null>(null);

  const approve = async () => {
    if (appointment === '') {
      setFailure({ message: 'Handover appointment is required.' });
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      const result = await approveContract(
        contract.id,
        new Date(appointment).toISOString(),
        contract.version,
      );
      setApproved(result);
      showToast('Saved.');
      onDecided();
    } catch (error) {
      setFailure(failureOf(error));
      if (error instanceof ApiError && error.errorCode === 'INVALID_STATE_TRANSITION') onDecided();
    } finally {
      setPending(false);
    }
  };

  return (
    <aside aria-labelledby="panel-title" className={`${CARD} flex h-fit flex-col gap-4`}>
      <div>
        <h2 id="panel-title" className="text-lg font-bold text-slate-900">
          {contract.code}
        </h2>
        <p className="text-sm text-slate-700">{contract.organization?.legalName}</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="font-semibold text-slate-600">Plan</dt>
          <dd>{planLabel(contract)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-600">Devices</dt>
          <dd>
            {contract.quantity} x {contract.hardwareVariant.code}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-600">Monthly price</dt>
          <dd>{formatVnd(contract.monthlyUnitPriceVnd)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-600">Holding fee</dt>
          <dd>{Math.round(contract.holdingFeeRatio * 100)} %</dd>
        </div>
        <div className="col-span-2">
          <dt className="font-semibold text-slate-600">Requested start</dt>
          <dd>{formatDay(contract.requestedStartDate)}</dd>
        </div>
      </dl>

      {approved ? (
        <div
          role="status"
          className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm"
        >
          <p className="font-semibold">
            Reserved: {approved.devices.map((device) => device.assetTag).join(', ')}
          </p>
          <p>Reservation expires {formatDateTime(approved.reservationExpiresAt)}.</p>
        </div>
      ) : (
        contract.status === 'REQUESTED' && (
          <>
            {failure && (
              <div role="alert" className={ALERT}>
                {failure.message}
                {failure.stale && (
                  <button
                    type="button"
                    className="ml-2 font-semibold underline"
                    onClick={onDecided}
                  >
                    Reload
                  </button>
                )}
              </div>
            )}
            <Field
              id="appointment"
              label="Handover appointment"
              hint="Devices are reserved by the server, the longest unused first."
            >
              <input
                id="appointment"
                type="datetime-local"
                className={INPUT}
                value={appointment}
                onChange={(event) => setAppointment(event.target.value)}
              />
            </Field>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                className={`${SECONDARY_BUTTON} flex-1`}
                disabled={pending}
                onClick={() => setRejecting(true)}
              >
                Reject
              </button>
              <button
                type="button"
                className={`${PRIMARY_BUTTON} flex-1`}
                disabled={pending}
                onClick={() => void approve()}
              >
                {pending ? 'Approving…' : 'Approve'}
              </button>
            </div>
          </>
        )
      )}
      <Link to={`/t/contracts/${contract.id}`} className={`${LINK} text-sm`}>
        Open the contract
      </Link>
      {rejecting && (
        <RejectDialog
          contract={contract}
          onClose={() => setRejecting(false)}
          onDone={() => {
            setRejecting(false);
            onDecided();
          }}
        />
      )}
    </aside>
  );
};

// /t/contracts, screen 5.3: the approval queue with the selected request in a side panel
// (rentals api-design 02, 04, 05). Devices are chosen by the server.
export const ContractApprovalPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  // The selected request stays in the panel after a decision, so the reserved tags stay visible
  // while the row moves to the Approved tab.
  const [selected, setSelected] = useState<Contract | null>(null);
  const status = TABS[tab].status;
  const { data, isLoading, error, refetch } = useContracts('t', { status, pageNumber });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: contractKeys.all });
    if (selected)
      void queryClient.invalidateQueries({ queryKey: contractKeys.detail(selected.id) });
  };

  return (
    <section aria-labelledby="queue-title">
      <PageTitle id="queue-title" title="Contract requests" />
      <div role="tablist" aria-label="Queues" className="mb-4 flex gap-2">
        {TABS.map((item, index) => (
          <button
            key={item.label}
            type="button"
            role="tab"
            aria-selected={tab === index}
            onClick={() => {
              setTab(index);
              setPageNumber(1);
              setSelected(null);
            }}
            className={TAB(tab === index)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          {isLoading && <Loading />}
          {error && <ErrorState error={error} onRetry={() => void refetch()} />}
          {data && data.items.length === 0 && (
            <Empty>
              {status === 'REQUESTED'
                ? 'No contract requests are waiting.'
                : 'No results match your filters.'}
            </Empty>
          )}
          {data && data.items.length > 0 && (
            <>
              <ul className="flex flex-col gap-2 md:hidden">
                {data.items.map((contract) => (
                  <li key={contract.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(contract)}
                      aria-pressed={contract.id === selected?.id}
                      className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border bg-white p-4 text-left shadow-sm ${
                        contract.id === selected?.id
                          ? 'border-blue-700 ring-2 ring-blue-200'
                          : 'border-slate-200'
                      }`}
                    >
                      <span>
                        <span className="font-semibold text-slate-900">{contract.code}</span>
                        <span className="ml-2 text-sm text-slate-600">
                          {contract.organization?.code}
                        </span>
                        <span className="block text-sm text-slate-700">
                          {planLabel(contract)}, {contract.hardwareVariant.code} x{' '}
                          {contract.quantity}, starts {formatDay(contract.requestedStartDate)}
                        </span>
                      </span>
                      <Badge tone={STATUS_TONES[contract.status]}>
                        {STATUS_LABELS[contract.status]}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
              <table className={`${TABLE} hidden md:table`}>
                <thead className="bg-slate-50">
                  <tr>
                    <th className={TH}>Contract</th>
                    <th className={TH}>Organization</th>
                    <th className={TH}>Plan</th>
                    <th className={TH}>Variant x qty</th>
                    <th className={TH}>Start</th>
                    <th className={TH}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((contract) => {
                    const active = contract.id === selected?.id;
                    return (
                      <tr
                        key={contract.id}
                        onClick={() => setSelected(contract)}
                        className={`cursor-pointer border-t border-slate-200 transition ${
                          active ? 'bg-blue-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className={TD}>
                          <button
                            type="button"
                            aria-pressed={active}
                            onClick={() => setSelected(contract)}
                            className={`${LINK} whitespace-nowrap text-left`}
                          >
                            {contract.code}
                          </button>
                        </td>
                        <td className={TD}>{contract.organization?.code}</td>
                        <td className={`${TD} whitespace-nowrap`}>{planLabel(contract)}</td>
                        <td className={`${TD} whitespace-nowrap`}>
                          {contract.hardwareVariant.code} x {contract.quantity}
                        </td>
                        <td className={`${TD} whitespace-nowrap`}>
                          {formatDay(contract.requestedStartDate)}
                        </td>
                        <td className={TD}>
                          <Badge tone={STATUS_TONES[contract.status]}>
                            {STATUS_LABELS[contract.status]}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Pager
                pageNumber={data.pageNumber}
                totalPages={data.totalPages}
                onPage={setPageNumber}
              />
            </>
          )}
        </div>
        <div className="lg:sticky lg:top-4">
          {selected ? (
            <RequestPanel key={selected.id} contract={selected} onDecided={refresh} />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">
              Select a request to see its prices, choose the handover appointment and decide.
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
