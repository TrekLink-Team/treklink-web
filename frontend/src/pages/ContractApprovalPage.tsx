import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  approveContract,
  cancelContract,
  contractKeys,
  fetchContract,
  planLabel,
  rejectContract,
  STATUS_LABELS,
  STATUS_TONES,
  useContracts,
  type Approved,
  type Contract,
  type ContractStatus,
  useAvailability,
  CONTRACT_SORT_FIELDS,
  type ContractSortField,
} from '../entities/contract/api';
import { collectionSortOf, sortParamsOf, type SortParams } from '../shared/api/query';
import { useVariantName } from '../entities/billing/api';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime, formatDay, formatVnd } from '../shared/lib/format';
import { Badge, ErrorState, Field, PageTitle } from '../shared/ui/bits';
import { invalid } from '../shared/ui/errors';
import { Store } from 'lucide-react';
import {
  Alert,
  CollectionView,
  Pagination,
  StateChangeDialog,
  type CollectionField,
  type CollectionTransition,
  type StateTransition,
} from '../shared/ui';
import { Dialog } from '../shared/ui/Dialog';
import { useConfirmStep } from '../shared/ui/useConfirmStep';
import { useToast } from '../shared/ui/toastStore';
import { useDebounced } from '../shared/lib/useDebounced';
import {
  ALERT,
  DANGER_BUTTON,
  INPUT,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
} from '../shared/ui/styles';

// The appointment field starts on the requested start date at 09:00, the counter's opening hour,
// in the viewer's local time.
const appointmentOf = (day: string) => `${day}T09:00`;

interface Failure {
  message: string;
  stale?: boolean;
  shortfall?: boolean;
  // Shown under the appointment field: the panel sends no other field the server validates
  // (rentals api-design 04, an appointment in the past is 400 VALIDATION_FAILED).
  appointment?: boolean;
}

const failureOf = (error: unknown): Failure => {
  if (!(error instanceof ApiError)) return { message: 'Something went wrong. Please try again.' };
  return {
    message: error.message,
    stale: error.errorCode === 'STALE_VERSION',
    shortfall: error.errorCode === 'INSUFFICIENT_DEVICES',
    appointment: error.errorCode === 'VALIDATION_FAILED',
  };
};

const RejectDialog: React.FC<{
  contract: Contract;
  onClose: () => void;
  onDone: (rejected: Contract) => void;
}> = ({ contract, onClose, onDone }) => {
  const showToast = useToast((state) => state.show);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const discard = useConfirmStep();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reason.trim() === '') {
      setError('Reason is required.');
      return;
    }
    setPending(true);
    try {
      const rejected = await rejectContract(contract.id, reason.trim(), contract.version);
      showToast('Saved.');
      onDone(rejected);
    } catch (failure) {
      setPending(false);
      setError(failureOf(failure).message);
    }
  };

  return (
    <>
      <Dialog
        titleId="reject-title"
        title={`Reject ${contract.code}?`}
        onClose={() => {
          if (reason === '') onClose();
          else
            discard.ask(
              {
                title: 'Discard the rejection?',
                description: 'The reason you typed is lost; the request stays as it is.',
                confirmLabel: 'Discard',
              },
              onClose,
            );
        }}
      >
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field
            id="reject-reason"
            label="Reason"
            error={error}
            hint="The Manager sees this reason."
          >
            <textarea
              id="reject-reason"
              rows={3}
              className="rounded-lg border border-line-strong p-3"
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
      {discard.dialog}
    </>
  );
};

// The request panel: prices fixed at request, the handover appointment, Approve and Reject. The
// queue keys it by contract, so choosing another request starts a fresh form.
// `onDecided` passes the contract as the server returned it, or nothing when the server refused and
// the contract must be read again.
const RequestPanel: React.FC<{ contract: Contract; onDecided: (decided?: Contract) => void }> = ({
  contract,
  onDecided,
}) => {
  const showToast = useToast((state) => state.show);
  const variant = useVariantName()(contract.hardwareVariant);
  const [appointment, setAppointment] = useState(appointmentOf(contract.requestedStartDate));
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [approved, setApproved] = useState<Approved | null>(null);
  // Since D-092 a request holds its units from the moment it is sent, and approval keeps them; only a
  // request sent before D-092 (no holdExpiresAt) is reserved at approval and needs the count.
  const held = Boolean(contract.holdExpiresAt);
  // Read once when the panel opens (a render stays pure); the panel remounts per contract.
  const [openedAt] = useState(() => Date.now());
  const availability = useAvailability(
    contract.hardwareVariant.id,
    contract.status === 'REQUESTED' && !held,
  );
  const available = availability.data?.find(
    (row) => row.hardwareVariantId === contract.hardwareVariant.id,
  )?.available;
  // The panel keeps the contract as it was selected, so a rejection is remembered here to hide
  // Approve and Reject.
  const [rejected, setRejected] = useState(false);

  const appointmentError = failure?.appointment ? failure.message : undefined;

  const approve = async () => {
    if (appointment === '') {
      setFailure({ message: 'Handover appointment is required.', appointment: true });
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
      // The pattern of the organization approval toast (screen 3.2), with what was reserved.
      showToast(`${contract.code} approved. ${result.devices.length} devices reserved.`);
      onDecided(result);
    } catch (error) {
      setFailure(failureOf(error));
      if (error instanceof ApiError && error.errorCode === 'INVALID_STATE_TRANSITION') onDecided();
    } finally {
      setPending(false);
    }
  };

  // In the queue's details pane (chapter 06 §9.8) the pane holds the heading.
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">{contract.organization?.legalName}</p>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="font-semibold text-ink-muted">Plan</dt>
          <dd>{planLabel(contract)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink-muted">Devices</dt>
          <dd>
            {contract.quantity} x {variant}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink-muted">Monthly price</dt>
          <dd>{formatVnd(contract.monthlyUnitPriceVnd)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink-muted">Holding fee</dt>
          <dd>{Math.round(contract.holdingFeeRatio * 100)} %</dd>
        </div>
        <div className="col-span-2">
          <dt className="font-semibold text-ink-muted">Requested start</dt>
          <dd>{formatDay(contract.requestedStartDate)}</dd>
        </div>
      </dl>

      {approved ? (
        <Alert
          tone="success"
          title={`Reserved: ${approved.devices.map((device) => device.assetTag).join(', ')}`}
        >
          Reservation expires {formatDateTime(approved.reservationExpiresAt)}. The request hold has
          ended; these units stay reserved for the handover until then.
        </Alert>
      ) : rejected ? (
        <Alert tone="info" title="Rejected. The Manager sees the reason." />
      ) : (
        contract.status === 'REQUESTED' && (
          <>
            {held && contract.holdExpiresAt ? (
              // Past its end, an unpaid hold is refused at approval (REQ-ERR-12) and cancelled by the
              // expiry job; a paid one is kept.
              new Date(contract.holdExpiresAt).getTime() > openedAt ? (
                <Alert tone="success">
                  {`This request holds its ${contract.quantity} ${variant} devices; approval keeps them. An unpaid hold ends ${formatDateTime(contract.holdExpiresAt)}.`}
                </Alert>
              ) : (
                <Alert tone="warning">
                  {`The hold of this request ended ${formatDateTime(contract.holdExpiresAt)}. If the deposit is unpaid, approval is refused and the request is cancelled shortly; a paid deposit keeps the ${contract.quantity} ${variant} devices.`}
                </Alert>
              )
            ) : (
              <Alert
                tone={
                  available === undefined
                    ? 'info'
                    : available < contract.quantity
                      ? 'warning'
                      : 'success'
                }
              >
                {availability.isLoading
                  ? 'Checking availability…'
                  : available === undefined
                    ? 'Availability is unknown; approval checks it.'
                    : available < contract.quantity
                      ? `Only ${available} ${variant} available now.`
                      : `${available} ${variant} available now; approval reserves ${contract.quantity}.`}
              </Alert>
            )}
            {failure && !failure.appointment && (
              <div role="alert" className={ALERT}>
                {failure.message}
                {failure.stale && (
                  <button
                    type="button"
                    className="ml-2 font-semibold underline"
                    onClick={() => onDecided()}
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
              error={appointmentError}
            >
              <input
                id="appointment"
                type="datetime-local"
                className={INPUT}
                value={appointment}
                onChange={(event) => {
                  setAppointment(event.target.value);
                  if (failure?.appointment) setFailure(null);
                }}
                {...invalid('appointment', appointmentError)}
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
      {/* The details pane links to the contract home under this panel; a second "Open the contract"
          here gave the pane two links of one name (e2e MF-01 step 7, treklink-web#350). */}
      {rejecting && (
        <RejectDialog
          contract={contract}
          onClose={() => setRejecting(false)}
          onDone={(decided) => {
            setRejecting(false);
            setRejected(true);
            onDecided(decided);
          }}
        />
      )}
    </div>
  );
};

// The moves of screen 5.3 (W29) as status changes (chapter 06 §9.6): a request is approved in the
// details pane, which fixes the handover appointment (rentals api-design 04); Reject (05) and Cancel
// (06) need a reason only. Staff and Admin cancel through `contract.operate`. A contract past
// approval opens at its counter.
type RowMove = 'REJECTED' | 'CANCELLED';

const MOVES: Record<RowMove, StateTransition<RowMove>> = {
  REJECTED: {
    target: 'REJECTED',
    label: 'Reject contract',
    destructive: true,
    needsReason: true,
    reasonHint: 'The Manager sees this reason.',
    description: 'The request is refused and any device it holds is released.',
    successMessage: 'Contract rejected.',
  },
  CANCELLED: {
    target: 'CANCELLED',
    label: 'Cancel contract',
    destructive: true,
    needsReason: true,
    reasonHint: 'The Manager sees this reason.',
    description:
      'The contract ends before handover and its devices go back to AVAILABLE. A holding fee already paid is retained.',
    cancelLabel: 'Keep contract',
    successMessage: 'Contract cancelled.',
  },
};

const AT_COUNTER: readonly ContractStatus[] = [
  'APPROVED',
  'ACTIVE',
  'ENDING',
  'RETURN_DUE',
  'OVERDUE',
  'DEFAULTED',
  'RETURNED',
];

const QUEUES: { key: string; label: string; status?: ContractStatus }[] = [
  { key: 'REQUESTED', label: 'Requested', status: 'REQUESTED' },
  { key: 'APPROVED', label: 'Approved', status: 'APPROVED' },
  { key: 'ALL', label: 'All' },
];

// As the fleet search (FleetPage): one request once typing pauses.
const SEARCH_DEBOUNCE_MS = 300;

// /t/contracts, screen 5.3: the approval queue on CollectionView (chapter 06 §9, D-096), the queue as
// its Show filter (rentals api-design 02), and the selected request's decision panel in the details
// pane (rentals api-design 04, 05, 06). Devices are chosen by the server.
export const ContractApprovalPage: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [moving, setMoving] = useState<{ contract: Contract; move: RowMove } | null>(null);
  const [queueKey, setQueueKey] = useState('REQUESTED');
  const [pageNumber, setPageNumber] = useState(1);
  const [text, setText] = useState('');
  // The header sort on the server (rentals api-design 02, W26); none keeps the newest change first.
  const [sort, setSort] = useState<SortParams<ContractSortField>>({});
  const status = QUEUES.find((queue) => queue.key === queueKey)?.status;
  // The search runs on the server over the whole queue (rentals api-design 02 `q`, REQ-EVT-26): the
  // contract code, the organization's name or code, once typing has paused for SEARCH_DEBOUNCE_MS.
  const q = useDebounced(text.trim(), SEARCH_DEBOUNCE_MS);
  const { data, isLoading, error, refetch } = useContracts('t', {
    status,
    pageNumber,
    q: q || undefined,
    ...sort,
  });
  const variantName = useVariantName();

  const transitions = (contract: Contract): CollectionTransition<Contract>[] => [
    ...(contract.status === 'REQUESTED'
      ? [
          {
            key: 'reject',
            label: 'Reject contract',
            destructive: true,
            onSelect: () => setMoving({ contract, move: 'REJECTED' }),
          },
        ]
      : []),
    ...(contract.status === 'REQUESTED' || contract.status === 'APPROVED'
      ? [
          {
            key: 'cancel',
            label: 'Cancel contract',
            destructive: true,
            onSelect: () => setMoving({ contract, move: 'CANCELLED' }),
          },
        ]
      : []),
  ];

  const fields: CollectionField<Contract>[] = [
    {
      key: 'organization',
      label: 'Organization',
      render: (contract) => contract.organization?.code,
      compact: true,
    },
    {
      key: 'plan',
      label: 'Plan',
      render: (contract) => <span className="whitespace-nowrap">{planLabel(contract)}</span>,
      hideWithPane: true,
    },
    {
      key: 'variant',
      label: 'Variant x qty',
      render: (contract) => (
        <span className="whitespace-nowrap">
          {variantName(contract.hardwareVariant)} x {contract.quantity}
        </span>
      ),
      compact: true,
    },
    {
      key: 'requestedStartDate',
      label: 'Start',
      render: (contract) => (
        <span className="whitespace-nowrap">{formatDay(contract.requestedStartDate)}</span>
      ),
      hideWithPane: true,
      sortable: true,
    },
    {
      key: 'status',
      label: 'Status',
      render: (contract) => (
        <Badge tone={STATUS_TONES[contract.status]}>{STATUS_LABELS[contract.status]}</Badge>
      ),
      compact: true,
      sortable: true,
    },
  ];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: contractKeys.all });
  };

  // The contracts this page just decided, as the server returned them: the details pane shows the new
  // status while the request leaves its queue (review of treklink-web#350).
  const [decided, setDecided] = useState<Record<string, Contract>>({});
  const remember = (contract: Contract) =>
    setDecided((current) => ({ ...current, [contract.id]: contract }));
  const onDecided = (contractId: string, contract?: Contract) => {
    if (contract) remember(contract);
    // A refused decision (another member decided first, a stale version) reads the contract again.
    else
      void queryClient
        .fetchQuery({ queryKey: contractKeys.detail(contractId), queryFn: () => fetchContract(contractId) })
        .then(remember, () => undefined);
    refresh();
  };
  const freshItem = (id: string) => {
    const known = decided[id];
    const listed = data?.items.find((contract) => contract.id === id);
    return known && (!listed || listed.version < known.version) ? known : undefined;
  };

  const pageSize = data?.pageSize ?? 20;

  return (
    <section aria-labelledby="queue-title" data-fit-page="" className="flex min-h-0 flex-1 flex-col gap-4">
      <PageTitle id="queue-title" title="Contracts" />
      <CollectionView<Contract>
        label="Contracts"
        items={data?.items}
        loading={isLoading}
        error={error ? <ErrorState error={error} onRetry={() => void refetch()} /> : undefined}
        itemId={(contract) => contract.id}
        itemName={(contract) => contract.code}
        itemHref={(contract) => `/t/contracts/${contract.id}`}
        fields={fields}
        noun={{ one: 'contract', other: 'contracts' }}
        itemActions={[
          {
            key: 'counter',
            label: 'Open counter',
            icon: <Store />,
            allowed: (contract) => AT_COUNTER.includes(contract.status),
            onSelect: (contract) => navigate(`/t/counter/${contract.id}`),
          },
        ]}
        transitions={transitions}
        freshItem={freshItem}
        status={{
          field: 'status',
          value: (contract) => ({ label: STATUS_LABELS[contract.status], tone: STATUS_TONES[contract.status] }),
        }}
        search={{
          label: 'Search by contract or organization',
          placeholder: 'Contract code, organization name or code',
        }}
        filters={QUEUES.map((queue) => ({ key: queue.key, label: queue.label }))}
        query={{ search: text, filter: queueKey, sort: collectionSortOf(sort) }}
        titleSort="code"
        // The default queue (Requested) narrows the list, so the bar stays even for one or two rows.
        hideCommandBar={false}
        onQueryChange={(next) => {
          if (next.search !== text) {
            setText(next.search);
            setPageNumber(1);
          }
          if (next.filter !== queueKey) {
            setQueueKey(next.filter);
            setPageNumber(1);
          }
          const nextSort = sortParamsOf(next.sort, CONTRACT_SORT_FIELDS);
          if (nextSort.sort !== sort.sort || nextSort.order !== sort.order) {
            setSort(nextSort);
            setPageNumber(1);
          }
        }}
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
          extra: (contract) => (
            <RequestPanel
              key={contract.id}
              contract={contract}
              onDecided={(result) => onDecided(contract.id, result)}
            />
          ),
          href: (contract) => `/t/contracts/${contract.id}`,
          hrefLabel: 'Open the contract',
        }}
        emptyState={{
          title:
            status === 'REQUESTED'
              ? 'No contract requests are waiting.'
              : 'No contracts in this queue.',
        }}
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
      {moving && (
        <StateChangeDialog<RowMove>
          subject={moving.contract.code}
          transition={MOVES[moving.move]}
          version={moving.contract.version}
          onSubmit={({ reason, expectedVersion }) =>
            moving.move === 'REJECTED'
              ? rejectContract(moving.contract.id, reason ?? '', expectedVersion)
              : cancelContract(moving.contract.id, reason ?? '', expectedVersion)
          }
          onReload={refresh}
          onDone={refresh}
          onClose={() => setMoving(null)}
        />
      )}
    </section>
  );
};
