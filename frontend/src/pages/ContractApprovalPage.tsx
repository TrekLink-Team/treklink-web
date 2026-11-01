import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  approveContract,
  cancelContract,
  contractKeys,
  planLabel,
  rejectContract,
  STATUS_LABELS,
  STATUS_TONES,
  useContracts,
  type Approved,
  type Contract,
  type ContractStatus,
  useAvailability,
} from '../entities/contract/api';
import { useVariantName } from '../entities/billing/api';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime, formatDay, formatVnd } from '../shared/lib/format';
import { Badge, ErrorState, Field, PageTitle } from '../shared/ui/bits';
import { invalid } from '../shared/ui/errors';
import {
  Alert,
  Button,
  DataTable,
  Pagination,
  Select,
  StateChangeDialog,
  Toolbar,
  ToolbarSearch,
  type Column,
  type RowAction,
  type StateTransition,
} from '../shared/ui';
import { Dialog } from '../shared/ui/Dialog';
import { useToast } from '../shared/ui/toastStore';
import { matchesText } from '../shared/lib/filter';
import {
  ALERT,
  CARD,
  DANGER_BUTTON,
  INPUT,
  LINK,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  TAB,
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
  );
};

// The request panel: prices fixed at request, the handover appointment, Approve and Reject. The
// queue keys it by contract, so choosing another request starts a fresh form.
const RequestPanel: React.FC<{ contract: Contract; onDecided: () => void }> = ({
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
        <h2 id="panel-title" className="text-lg font-bold text-ink">
          {contract.code}
        </h2>
        <p className="text-sm text-ink-muted">{contract.organization?.legalName}</p>
      </div>
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
          Reservation expires {formatDateTime(approved.reservationExpiresAt)}.
        </Alert>
      ) : rejected ? (
        <Alert tone="info" title="Rejected. The Manager sees the reason." />
      ) : (
        contract.status === 'REQUESTED' && (
          <>
            {held && contract.holdExpiresAt ? (
              // Past its end, an unpaid hold is refused at approval (REQ-ERR-12) and cancelled by the
              // expiry job; a paid one is kept.
              new Date(contract.holdExpiresAt).getTime() > Date.now() ? (
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
      <Link to={`/t/contracts/${contract.id}`} className={`${LINK} text-sm`}>
        Open the contract
      </Link>
      {rejecting && (
        <RejectDialog
          contract={contract}
          onClose={() => setRejecting(false)}
          onDone={() => {
            setRejecting(false);
            setRejected(true);
            onDecided();
          }}
        />
      )}
    </aside>
  );
};

// The row actions of screen 5.3 (W29). A request is approved in the side panel, which fixes the
// handover appointment (rentals api-design 04), so Review opens it; Reject (05) and Cancel (06) need a
// reason only. Staff and Admin cancel through `contract.operate`. A contract past approval opens at
// its counter.
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
    description: 'The contract ends before handover and its devices go back to AVAILABLE. A holding fee already paid is retained.',
    cancelLabel: 'Keep contract',
    successMessage: 'Contract cancelled.',
  },
};

const AT_COUNTER: readonly ContractStatus[] = ['APPROVED', 'ACTIVE', 'ENDING', 'RETURN_DUE', 'OVERDUE', 'DEFAULTED', 'RETURNED'];

// /t/contracts, screen 5.3: the approval queue with the selected request in a side panel
// (rentals api-design 02, 04, 05). Devices are chosen by the server.
export const ContractApprovalPage: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [moving, setMoving] = useState<{ contract: Contract; move: RowMove } | null>(null);
  const [tab, setTab] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  // The selected request stays in the panel after a decision, so the reserved tags stay visible
  // while the row moves to the Approved tab.
  const [selected, setSelected] = useState<Contract | null>(null);
  const status = TABS[tab].status;
  const { data, isLoading, error, refetch } = useContracts('t', { status, pageNumber });
  const variantName = useVariantName();
  const [find, setFind] = useState({ text: '', plan: '' });
  const clear = () => setFind({ text: '', plan: '' });
  const filtered = find.text !== '' || find.plan !== '';
  const rows = data?.items.filter(
    (contract) =>
      matchesText(
        find.text,
        contract.code,
        contract.organization?.code,
        contract.organization?.legalName,
        variantName(contract.hardwareVariant),
        contract.hardwareVariant.code,
      ) && (find.plan === '' || contract.planType === find.plan),
  );

  const rowActions = (contract: Contract): RowAction[] => [
    ...(contract.status === 'REQUESTED'
      ? [
          { key: 'review', label: 'Review and approve', onSelect: () => setSelected(contract) },
          { key: 'reject', label: 'Reject contract', destructive: true, onSelect: () => setMoving({ contract, move: 'REJECTED' }) },
        ]
      : []),
    ...(AT_COUNTER.includes(contract.status)
      ? [{ key: 'counter', label: 'Open counter', onSelect: () => navigate(`/t/counter/${contract.id}`) }]
      : []),
    ...(contract.status === 'REQUESTED' || contract.status === 'APPROVED'
      ? [{ key: 'cancel', label: 'Cancel contract', destructive: true, onSelect: () => setMoving({ contract, move: 'CANCELLED' }) }]
      : []),
  ];

  const columns: Column<Contract>[] = [
    { key: 'code', header: 'Contract', cell: (contract) => <span className="whitespace-nowrap">{contract.code}</span> },
    { key: 'organization', header: 'Organization', cell: (contract) => contract.organization?.code },
    { key: 'plan', header: 'Plan', cell: (contract) => <span className="whitespace-nowrap">{planLabel(contract)}</span> },
    {
      key: 'variant',
      header: 'Variant x qty',
      cell: (contract) => (
        <span className="whitespace-nowrap">
          {variantName(contract.hardwareVariant)} x {contract.quantity}
        </span>
      ),
    },
    { key: 'start', header: 'Start', cell: (contract) => <span className="whitespace-nowrap">{formatDay(contract.requestedStartDate)}</span>, hideOnMobile: true },
    { key: 'status', header: 'Status', cell: (contract) => <Badge tone={STATUS_TONES[contract.status]}>{STATUS_LABELS[contract.status]}</Badge> },
  ];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: contractKeys.all });
    if (selected)
      void queryClient.invalidateQueries({ queryKey: contractKeys.detail(selected.id) });
  };

  return (
    <section aria-labelledby="queue-title">
      <PageTitle id="queue-title" title="Contracts" />
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

      <div className="grid items-start gap-5 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          <Toolbar
            label="Contract filters"
            start={
              <>
                <ToolbarSearch
                  id="queue-search"
                  label="Search by contract, organization or variant"
                  placeholder="Contract, organization or variant"
                  value={find.text}
                  onChange={(text) => setFind((current) => ({ ...current, text }))}
                />
                <span className="w-40">
                  <Select aria-label="Plan" value={find.plan} onChange={(event) => setFind((current) => ({ ...current, plan: event.target.value }))}>
                    <option value="">Every plan</option>
                    <option value="MONTHLY">Monthly</option>
                    <option value="DAY">Day plan</option>
                  </Select>
                </span>
                {filtered && (
                  <Button variant="ghost" onClick={clear}>
                    Clear filters
                  </Button>
                )}
              </>
            }
          />
          <DataTable<Contract>
            caption="Contracts"
            columns={columns}
            rows={rows}
            rowId={(contract) => contract.id}
            rowLabel={(contract) => contract.code}
            loading={isLoading}
            error={error ? <ErrorState error={error} onRetry={() => void refetch()} /> : undefined}
            empty={
              filtered
                ? { title: 'No results match your filters.', action: <Button onClick={clear}>Clear filters</Button> }
                : { title: status === 'REQUESTED' ? 'No contract requests are waiting.' : 'No contracts in this queue.' }
            }
            activeRowId={selected?.id}
            onRowActivate={setSelected}
            rowActions={rowActions}
            renderCard={(contract) => (
              <button type="button" onClick={() => setSelected(contract)} aria-pressed={contract.id === selected?.id} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
                <span>
                  <span className="font-semibold text-ink">{contract.code}</span>
                  <span className="ml-2 text-sm text-ink-muted">{contract.organization?.code}</span>
                  <span className="block text-sm text-ink-muted">
                    {planLabel(contract)}, {variantName(contract.hardwareVariant)} x {contract.quantity}, starts{' '}
                    {formatDay(contract.requestedStartDate)}
                  </span>
                </span>
                <Badge tone={STATUS_TONES[contract.status]}>{STATUS_LABELS[contract.status]}</Badge>
              </button>
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
        </div>
        <div className="xl:sticky xl:top-4">
          {selected ? (
            <RequestPanel key={selected.id} contract={selected} onDecided={refresh} />
          ) : (
            <div className="rounded-xl border border-dashed border-line-strong p-6 text-sm text-ink-muted">
              Select a request to see its prices, choose the handover appointment and decide.
            </div>
          )}
        </div>
      </div>
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
          onDone={() => {
            if (selected?.id === moving.contract.id) setSelected(null);
            refresh();
          }}
          onClose={() => setMoving(null)}
        />
      )}
    </section>
  );
};
