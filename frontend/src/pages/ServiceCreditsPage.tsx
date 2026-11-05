import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ReceiptText, Scale, Undo2 } from 'lucide-react';
import { useAuth } from '../app/providers/useAuth';
import {
  billingKeys,
  causeLabel,
  decideServiceCredit,
  recordServiceCreditRefund,
  serviceCreditKeys,
  useServiceCredits,
  type ServiceCredit,
  type ServiceCreditDecision,
} from '../entities/billing/api';
import { creditAmount, outageText } from '../features/service-credits/creditText';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime, formatVnd } from '../shared/lib/format';
import { hasAnyRole } from '../shared/lib/permissions';
import {
  Alert,
  Button,
  CollectionView,
  ConfirmDialog,
  Dialog,
  Field,
  Input,
  PageHeader,
  Pagination,
  pageInfoOf,
  RadioGroup,
  SERVICE_CREDIT_STATUS,
  StatusBadge,
  Textarea,
  useToast,
  type CollectionField,
  type ServiceCreditStatus,
} from '../shared/ui';
import { ErrorState } from '../shared/ui/bits';
import { LINK } from '../shared/ui/styles';

const DECISIONS: { value: ServiceCreditDecision; label: string }[] = [
  { value: 'APPROVE', label: 'Approve' },
  { value: 'REDUCE', label: 'Reduce' },
  { value: 'REJECT', label: 'Reject' },
];

const SELF_REQUESTED = 'Another Admin must decide: you requested this credit.';

const errorText = (failure: unknown) =>
  failure instanceof ApiError ? failure.message : 'Something went wrong. Please try again.';

// The decision of screen 6.5 (billing api-design 21, REQ-EVT-13): Approve keeps the computed amount,
// Reduce takes a smaller one and a reason, Reject takes a reason and asks first. The source of the
// outage start sits next to the amount, since the amount depends on it (design §9.1).
const DecisionDialog: React.FC<{ credit: ServiceCredit; onClose: () => void }> = ({
  credit,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [decision, setDecision] = useState<ServiceCreditDecision | undefined>(undefined);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const decidedVnd = Number(amount.replace(/[,\s]/g, ''));
  const tag = credit.assetTag ?? 'this device';

  const save = async () => {
    if (!decision) return;
    setPending(true);
    try {
      await decideServiceCredit(credit.id, {
        decision,
        ...(decision === 'REDUCE' ? { decidedVnd } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        expectedVersion: credit.version,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: serviceCreditKeys.all }),
        queryClient.invalidateQueries({ queryKey: billingKeys.balance(credit.contractId) }),
      ]);
      showToast('Saved.');
      onClose();
    } catch (failure) {
      setPending(false);
      setConfirming(false);
      if (
        failure instanceof ApiError &&
        (failure.errorCode === 'INVALID_STATE_TRANSITION' || failure.errorCode === 'STALE_VERSION')
      ) {
        // Another Admin decided first: the queue refetches to show the row as it is now.
        void queryClient.invalidateQueries({ queryKey: serviceCreditKeys.all });
      }
      const message = errorText(failure);
      setErrors(
        failure instanceof ApiError && failure.message.includes('decidedVnd')
          ? { decidedVnd: message }
          : { form: message },
      );
    }
  };

  const check = (event: React.FormEvent) => {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!decision) found.decision = 'Choose a decision.';
    if (
      decision === 'REDUCE' &&
      (!Number.isInteger(decidedVnd) || decidedVnd < 1 || decidedVnd >= credit.computedVnd)
    ) {
      found.decidedVnd = `Credit must be a whole number of VND below ${formatVnd(credit.computedVnd)}.`;
    }
    if (decision && decision !== 'APPROVE' && reason.trim() === '') {
      found.reason = 'Reason is required to reduce or reject.';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (decision === 'REJECT') setConfirming(true);
    else void save();
  };

  if (confirming) {
    return (
      <ConfirmDialog
        titleId="reject-credit-title"
        title={`Reject the ${formatVnd(credit.computedVnd)} credit on ${tag}?`}
        description="The organization keeps paying for these days."
        confirmLabel="Reject"
        destructive
        pending={pending}
        onConfirm={() => void save()}
        onCancel={() => setConfirming(false)}
      />
    );
  }

  return (
    <Dialog
      titleId="credit-decision-title"
      title={`Decide the credit on ${tag}`}
      description={`${causeLabel(credit.cause)}: ${outageText(credit)}, ${formatVnd(credit.computedVnd)}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="credit-decision-form" variant="primary" loading={pending}>
            Record decision
          </Button>
        </>
      }
    >
      <form id="credit-decision-form" onSubmit={check} noValidate className="flex flex-col gap-4">
        {errors.form && <Alert tone="error">{errors.form}</Alert>}
        <p className="text-body-sm text-ink">
          Outage start source:{' '}
          {credit.outageSourceNote ?? (credit.outageSourceIncidentId ? 'an incident' : 'not given')}
        </p>
        <RadioGroup<ServiceCreditDecision>
          name="credit-decision"
          legend="Decision"
          layout="row"
          required
          value={decision}
          error={errors.decision}
          onChange={(value) => {
            setDecision(value);
            setErrors({});
          }}
          options={DECISIONS}
        />
        {decision === 'REDUCE' && (
          <Field id="credit-amount" label="Credit (VND)" error={errors.decidedVnd} required>
            <Input
              id="credit-amount"
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </Field>
        )}
        <Field
          id="credit-reason"
          label="Reason"
          error={errors.reason}
          required={decision === 'REDUCE' || decision === 'REJECT'}
        >
          <Textarea
            id="credit-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
};

// The refund of screen 6.5 (billing api-design 22, REQ-EVT-15): the reference of a transfer made
// outside TrekLink, recorded once.
const RefundDialog: React.FC<{ credit: ServiceCredit; onClose: () => void }> = ({
  credit,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const owed = (credit.decidedVnd ?? credit.computedVnd) - credit.appliedVnd;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reference.trim() === '') {
      setError('Reference is required.');
      return;
    }
    setError(undefined);
    setFormError(null);
    setPending(true);
    try {
      await recordServiceCreditRefund(credit.id, reference.trim());
      await queryClient.invalidateQueries({ queryKey: serviceCreditKeys.all });
      showToast('Saved.');
      onClose();
    } catch (failure) {
      setPending(false);
      if (failure instanceof ApiError && failure.errorCode === 'DUPLICATE_REFERENCE') {
        setError(failure.message);
      } else {
        setFormError(errorText(failure));
        if (failure instanceof ApiError && failure.errorCode === 'INVALID_STATE_TRANSITION') {
          void queryClient.invalidateQueries({ queryKey: serviceCreditKeys.all });
        }
      }
    }
  };

  return (
    <Dialog
      titleId="credit-refund-title"
      title={`Record the refund for ${credit.assetTag ?? 'this device'}`}
      description={`${formatVnd(owed)} paid back to the organization outside TrekLink.`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="credit-refund-form" variant="primary" loading={pending}>
            Save refund
          </Button>
        </>
      }
    >
      <form id="credit-refund-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {formError && <Alert tone="error">{formError}</Alert>}
        <Field id="credit-reference" label="Reference" error={error} required>
          <Input
            id="credit-reference"
            value={reference}
            maxLength={100}
            onChange={(event) => setReference(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
};

const EMPTY: Partial<Record<ServiceCreditStatus | '', string>> = {
  REQUESTED: 'No service credits are waiting for a decision.',
  REFUND_DUE: 'No refunds are waiting to be recorded.',
};

// /t/service-credits, screen 6.5 (billing api-design 20 to 22, design §9.6): the credits with the
// decision queue first. An Admin decides a credit they did not request (BR-24); Staff and Admins record
// the refund of a credit that is REFUND_DUE.
export const ServiceCreditsPage: React.FC = () => {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const isAdmin = hasAnyRole(roles, ['ADMIN']);
  const isStaff = hasAnyRole(roles, ['STAFF']);
  const [status, setStatus] = useState<ServiceCreditStatus | ''>('REQUESTED');
  const [pageNumber, setPageNumber] = useState(1);
  const [deciding, setDeciding] = useState<ServiceCredit | null>(null);
  const [refunding, setRefunding] = useState<ServiceCredit | null>(null);
  const credits = useServiceCredits({ status: status || undefined, pageNumber });

  const fields: CollectionField<ServiceCredit>[] = [
    { key: 'cause', label: 'Cause', render: (credit) => causeLabel(credit.cause), compact: true },
    { key: 'outage', label: 'Outage', render: outageText, hideWithPane: true },
    { key: 'amount', label: 'Credit', align: 'end', render: creditAmount, compact: true },
    {
      key: 'status',
      label: 'Status',
      // A short badge with the refund reference beside it (design handoff item 12).
      render: (credit) => (
        <StatusBadge
          entry={SERVICE_CREDIT_STATUS[credit.status]}
          after={credit.refundReference ? `Ref. ${credit.refundReference}` : undefined}
        />
      ),
      compact: true,
    },
    { key: 'raised', label: 'Requested', render: (credit) => formatDateTime(credit.createdAt), hideWithPane: true },
  ];

  return (
    <section aria-labelledby="service-credits-title" data-fit-page="" className="flex min-h-0 flex-1 flex-col gap-6">
      <PageHeader id="service-credits-title" title="Service credits" />
      {!isAdmin && (
        <Alert tone="info">Only a TrekLink Admin who did not request a credit decides it.</Alert>
      )}
      <CollectionView<ServiceCredit>
        icon={<Undo2 />}
        label="Service credits"
        items={credits.data?.items}
        loading={credits.isLoading}
        error={credits.error ? <ErrorState error={credits.error} onRetry={() => void credits.refetch()} /> : undefined}
        itemId={(credit) => credit.id}
        itemName={(credit) => `${credit.assetTag ?? credit.deviceId} ${causeLabel(credit.cause)}`}
        itemTitle={(credit) => (
          <span className="flex flex-col">
            <span className="font-mono font-semibold text-ink">{credit.assetTag ?? credit.deviceId}</span>
            <Link to={`/t/contracts/${credit.contractId}`} className={`${LINK} inline-flex min-h-6 items-center text-body-sm`}>
              Open contract
            </Link>
          </span>
        )}
        fields={fields}
        noun={{ one: 'credit', other: 'credits' }}
        itemActions={[
          {
            key: 'decide',
            label: 'Decide',
            icon: <Scale />,
            allowed: (credit) => isAdmin && credit.status === 'REQUESTED',
            unavailableReason: (credit) => (credit.requestedById === user?.id ? SELF_REQUESTED : undefined),
            onSelect: setDeciding,
          },
          {
            key: 'refund',
            label: 'Record refund',
            icon: <ReceiptText />,
            allowed: (credit) => isStaff && credit.status === 'REFUND_DUE',
            onSelect: setRefunding,
          },
        ]}
        filters={[
          { key: 'REQUESTED', label: SERVICE_CREDIT_STATUS.REQUESTED.label },
          { key: '', label: 'All statuses' },
          ...(Object.keys(SERVICE_CREDIT_STATUS) as ServiceCreditStatus[])
            .filter((key) => key !== 'REQUESTED')
            .map((key) => ({ key, label: SERVICE_CREDIT_STATUS[key].label })),
        ]}
        query={{ search: '', filter: status, sort: null }}
        onQueryChange={(next) => {
          setStatus(next.filter as ServiceCreditStatus | '');
          setPageNumber(1);
        }}
        // The decision queue (the default filter) narrows the list, so the bar stays for one or two.
        hideCommandBar={false}
        pageInfo={pageInfoOf(credits.data)}
        details={{ href: (credit) => `/t/contracts/${credit.contractId}`, hrefLabel: 'Open the contract' }}
        emptyState={{ title: EMPTY[status] ?? 'No service credits match these filters.' }}
        noMatch={{ title: EMPTY[status] ?? 'No service credits match these filters.' }}
        footer={
          credits.data && credits.data.totalPages > 1 ? (
            <Pagination
              pageNumber={credits.data.pageNumber}
              totalPages={credits.data.totalPages}
              totalItems={credits.data.totalCount}
              pageSize={credits.data.pageSize}
              onPage={setPageNumber}
            />
          ) : undefined
        }
      />
      {deciding && <DecisionDialog credit={deciding} onClose={() => setDeciding(null)} />}
      {refunding && <RefundDialog credit={refunding} onClose={() => setRefunding(null)} />}
    </section>
  );
};
