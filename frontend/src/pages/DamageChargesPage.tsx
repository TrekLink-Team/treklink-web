import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../app/providers/useAuth';
import {
  billingKeys,
  damageChargeKeys,
  decideDamageCharge,
  useDamageCharges,
  type DamageCharge,
  type DamageChargeStatus,
  type DamageDecision,
} from '../entities/billing/api';
import { ApiError } from '../shared/api/apiClient';
import { hasAnyRole } from '../shared/lib/permissions';
import { formatDateTime, formatVnd } from '../shared/lib/format';
import {
  Alert,
  BulkActionDialog,
  Button,
  ConfirmDialog,
  CollectionView,
  DAMAGE_CHARGE_STATUS,
  Dialog,
  Field,
  Input,
  PageHeader,
  Pagination,
  pageInfoOf,
  RadioGroup,
  StatusBadge,
  Textarea,
  useToast,
  type BulkItem,
  type CollectionField,
} from '../shared/ui';
import { Scale } from 'lucide-react';
import { ErrorState } from '../shared/ui/bits';

const DECISIONS: { value: DamageDecision; label: string }[] = [
  { value: 'APPROVED', label: 'Approve' },
  { value: 'REDUCED', label: 'Reduce' },
  { value: 'WAIVED', label: 'Waive' },
];

// The decision on one pending charge (billing api-design 17): Approve keeps the amount, Reduce takes
// a final amount below it, Waive keeps nothing and asks first, naming the charge (chapter 06 §8.1).
const DecisionDialog: React.FC<{ charge: DamageCharge; onClose: () => void }> = ({
  charge,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [decision, setDecision] = useState<DamageDecision | undefined>(undefined);
  const [finalAmount, setFinalAmount] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const finalVnd = Number(finalAmount.replace(/[,\s]/g, ''));
  const tag = charge.assetTag ?? 'this device';

  const save = async () => {
    if (!decision) return;
    setPending(true);
    try {
      await decideDamageCharge(charge.id, {
        decision,
        ...(decision === 'REDUCED' ? { finalVnd } : {}),
        note: note.trim(),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: damageChargeKeys.all }),
        queryClient.invalidateQueries({ queryKey: billingKeys.balance(charge.contractId) }),
      ]);
      showToast('Saved.');
      onClose();
    } catch (failure) {
      setPending(false);
      setConfirming(false);
      if (failure instanceof ApiError && failure.errorCode === 'INVALID_STATE_TRANSITION') {
        // Another Admin decided first: MSG28 with the state, and the queue refetches.
        void queryClient.invalidateQueries({ queryKey: damageChargeKeys.all });
      }
      const message =
        failure instanceof ApiError ? failure.message : 'Something went wrong. Please try again.';
      setErrors(
        failure instanceof ApiError && failure.message.includes('finalVnd')
          ? { finalVnd: message }
          : { form: message },
      );
    }
  };

  const check = (event: React.FormEvent) => {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!decision) found.decision = 'Choose a decision.';
    if (
      decision === 'REDUCED' &&
      (!Number.isInteger(finalVnd) || finalVnd < 1 || finalVnd >= charge.amountVnd)
    ) {
      found.finalVnd = `Final amount must be a whole number of VND below ${formatVnd(charge.amountVnd)}.`;
    }
    if (note.trim() === '') found.note = 'Reason is required.';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (decision === 'WAIVED') setConfirming(true);
    else void save();
  };

  if (confirming) {
    return (
      <ConfirmDialog
        titleId="waive-confirm-title"
        title={`Waive the ${formatVnd(charge.amountVnd)} charge on ${tag}?`}
        description="The organization will not be charged for this damage."
        confirmLabel="Waive"
        destructive
        pending={pending}
        onConfirm={() => void save()}
        onCancel={() => setConfirming(false)}
      />
    );
  }

  return (
    <Dialog
      titleId="decision-title"
      title={`Decide the charge on ${tag}`}
      description={`${charge.damageCodes.join(', ')}: ${formatVnd(charge.amountVnd)}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="decision-form" variant="primary" loading={pending}>
            Record decision
          </Button>
        </>
      }
    >
      <form id="decision-form" onSubmit={check} noValidate className="flex flex-col gap-4">
        {errors.form && <Alert tone="error">{errors.form}</Alert>}
        <RadioGroup<DamageDecision>
          name="decision"
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
        {decision === 'REDUCED' && (
          <Field id="final-amount" label="Final amount (VND)" error={errors.finalVnd} required>
            <Input
              id="final-amount"
              inputMode="numeric"
              value={finalAmount}
              onChange={(event) => setFinalAmount(event.target.value)}
            />
          </Field>
        )}
        <Field id="decision-note" label="Reason" error={errors.note} required>
          <Textarea
            id="decision-note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
};

const SELF_INSPECTED = 'Another Admin must decide: you inspected this device.';

// Bulk decisions of screen 6.4 (W29): Approve keeps each amount, Waive keeps nothing; a reduction is
// per charge, so it stays in the row's Decide dialog. Each runs billing api-design 17 once per row.
type BulkDecision = 'APPROVED' | 'WAIVED';

const chargesText = (count: number) => `${count} ${count === 1 ? 'charge' : 'charges'}`;

// /t/damage-charges, screen 6.4 (billing api-design 16 and 17, UC-48): the damage charges, with the
// approval queue first. TrekLink Staff read it; an Admin decides a pending charge they did not
// inspect, and the control is hidden on their own (BR-24, MSG30 only for a forced request).
export const DamageChargesPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = hasAnyRole(user?.roles ?? [], ['ADMIN']);
  const [status, setStatus] = useState<DamageChargeStatus | ''>('PENDING_APPROVAL');
  const [pageNumber, setPageNumber] = useState(1);
  const [deciding, setDeciding] = useState<DamageCharge | null>(null);
  const charges = useDamageCharges({ status: status || undefined, pageNumber });
  const queryClient = useQueryClient();
  // A bulk decision on the selected charges of the current page (chapter 06 §9.4).
  const [bulk, setBulk] = useState<{ decision: BulkDecision; charges: DamageCharge[] } | null>(null);
  // An Admin may decide a pending charge on a device they did not inspect (BR-24).
  const decidable = (charge: DamageCharge) =>
    isAdmin && charge.status === 'PENDING_APPROVAL' && charge.inspector?.id !== user?.id;
  const items: BulkItem[] = (bulk?.charges ?? []).map((charge) => ({
    id: charge.id,
    label: `${charge.assetTag ?? charge.deviceId} (${formatVnd(charge.amountVnd)})`,
  }));
  const bulkDone = () => {
    void queryClient.invalidateQueries({ queryKey: damageChargeKeys.all });
    bulk?.charges.forEach((charge) => void queryClient.invalidateQueries({ queryKey: billingKeys.balance(charge.contractId) }));
  };

  const fields: CollectionField<DamageCharge>[] = [
    { key: 'codes', label: 'Damage codes', render: (charge) => charge.damageCodes.join(', '), compact: true },
    {
      key: 'inspector',
      label: 'Inspector',
      render: (charge) => charge.inspector?.fullName ?? charge.inspector?.id ?? '',
      hideWithPane: true,
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'end',
      compact: true,
      render: (charge) => (
        <span className="flex flex-col items-end">
          <span>{formatVnd(charge.amountVnd)}</span>
          {charge.finalVnd !== null && charge.finalVnd !== charge.amountVnd && (
            <span className="text-body-sm text-ink-muted">
              charged {formatVnd(charge.finalVnd)}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (charge) => <StatusBadge entry={DAMAGE_CHARGE_STATUS[charge.status]} />,
      compact: true,
    },
    { key: 'raised', label: 'Raised', render: (charge) => formatDateTime(charge.createdAt), hideWithPane: true },
  ];

  return (
    <section aria-labelledby="damage-charges-title" className="flex flex-col gap-6">
      <PageHeader id="damage-charges-title" title="Damage charges" />
      {!isAdmin && (
        <Alert tone="info">
          Only a TrekLink Admin who did not inspect the device decides a charge.
        </Alert>
      )}
      <CollectionView<DamageCharge>
        label="Damage charges"
        items={charges.data?.items}
        loading={charges.isLoading}
        error={charges.error ? <ErrorState error={charges.error} onRetry={() => void charges.refetch()} /> : undefined}
        itemId={(charge) => charge.id}
        itemName={(charge) => `${charge.assetTag ?? charge.deviceId} ${charge.damageCodes.join(', ')}`}
        itemTitle={(charge) => <span className="font-semibold text-ink">{charge.assetTag ?? charge.deviceId}</span>}
        fields={fields}
        noun={{ one: 'charge', other: 'charges' }}
        itemActions={[
          {
            key: 'decide',
            label: 'Decide',
            icon: <Scale />,
            allowed: (charge) => isAdmin && charge.status === 'PENDING_APPROVAL',
            unavailableReason: (charge) => (decidable(charge) ? undefined : SELF_INSPECTED),
            onSelect: setDeciding,
          },
        ]}
        bulkActions={
          isAdmin
            ? [
                { key: 'approve', label: (count) => `Approve ${chargesText(count)}`, appliesTo: decidable, onSelect: (rows) => setBulk({ decision: 'APPROVED', charges: rows }) },
                { key: 'waive', label: (count) => `Waive ${chargesText(count)}`, destructive: true, appliesTo: decidable, onSelect: (rows) => setBulk({ decision: 'WAIVED', charges: rows }) },
              ]
            : []
        }
        filters={[
          { key: 'PENDING_APPROVAL', label: DAMAGE_CHARGE_STATUS.PENDING_APPROVAL.label },
          { key: '', label: 'All statuses' },
          ...(Object.keys(DAMAGE_CHARGE_STATUS) as DamageChargeStatus[])
            .filter((key) => key !== 'PENDING_APPROVAL')
            .map((key) => ({ key, label: DAMAGE_CHARGE_STATUS[key].label })),
        ]}
        query={{ search: '', filter: status, sort: null }}
        onQueryChange={(next) => {
          setStatus(next.filter as DamageChargeStatus | '');
          setPageNumber(1);
        }}
        // The approval queue (the default filter) narrows the list, so the bar stays for one or two.
        hideCommandBar={false}
        pageInfo={pageInfoOf(charges.data)}
        emptyState={{ title: 'No damage charges are waiting for a decision.' }}
        noMatch={{ title: 'No damage charges match these filters.' }}
        footer={
          charges.data && charges.data.totalPages > 1 ? (
            <Pagination
              pageNumber={charges.data.pageNumber}
              totalPages={charges.data.totalPages}
              totalItems={charges.data.totalCount}
              pageSize={charges.data.pageSize}
              onPage={setPageNumber}
            />
          ) : undefined
        }
      />
      {bulk && (
        <BulkActionDialog
          title={`${bulk.decision === 'APPROVED' ? 'Approve' : 'Waive'} ${chargesText(items.length)}?`}
          confirmLabel={`${bulk.decision === 'APPROVED' ? 'Approve' : 'Waive'} ${chargesText(items.length)}`}
          description={
            bulk.decision === 'APPROVED'
              ? 'Each charge is kept at its amount and goes on its contract.'
              : 'The organizations will not be charged for this damage.'
          }
          destructive={bulk.decision === 'WAIVED'}
          needsReason
          reasonHint="Kept as the decision note of every charge."
          items={items}
          run={(item, reason) => decideDamageCharge(item.id, { decision: bulk.decision, note: reason ?? '' })}
          onFinished={bulkDone}
          onClose={() => setBulk(null)}
        />
      )}
      {deciding && <DecisionDialog charge={deciding} onClose={() => setDeciding(null)} />}
    </section>
  );
};
