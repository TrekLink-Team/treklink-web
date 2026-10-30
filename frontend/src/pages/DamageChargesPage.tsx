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
  Button,
  Card,
  ConfirmDialog,
  DAMAGE_CHARGE_STATUS,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Pagination,
  RadioGroup,
  Select,
  StatusBadge,
  Textarea,
  Toolbar,
  useToast,
  type Column,
} from '../shared/ui';
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

  const columns: Column<DamageCharge>[] = [
    { key: 'device', header: 'Device', cell: (charge) => charge.assetTag ?? charge.deviceId },
    { key: 'codes', header: 'Damage codes', cell: (charge) => charge.damageCodes.join(', ') },
    {
      key: 'inspector',
      header: 'Inspector',
      cell: (charge) => charge.inspector?.fullName ?? charge.inspector?.id ?? '',
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'end',
      cell: (charge) => (
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
      header: 'Status',
      cell: (charge) => <StatusBadge entry={DAMAGE_CHARGE_STATUS[charge.status]} />,
    },
    { key: 'raised', header: 'Raised', cell: (charge) => formatDateTime(charge.createdAt) },
  ];

  return (
    <section aria-labelledby="damage-charges-title" className="flex flex-col gap-6">
      <PageHeader id="damage-charges-title" title="Damage charges" />
      {!isAdmin && (
        <Alert tone="info">
          Only a TrekLink Admin who did not inspect the device decides a charge.
        </Alert>
      )}
      <Card>
        <Toolbar
          label="Damage charge filters"
          start={
            <Field id="charge-filter-status" label="Status" hideLabel className="w-full sm:w-56">
              <Select
                id="charge-filter-status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as DamageChargeStatus | '');
                  setPageNumber(1);
                }}
              >
                <option value="">All statuses</option>
                {(Object.keys(DAMAGE_CHARGE_STATUS) as DamageChargeStatus[]).map((key) => (
                  <option key={key} value={key}>
                    {DAMAGE_CHARGE_STATUS[key].label}
                  </option>
                ))}
              </Select>
            </Field>
          }
        />
        <DataTable
          caption="Damage charges"
          columns={columns}
          rows={charges.data?.items}
          rowId={(charge) => charge.id}
          loading={charges.isLoading}
          error={
            charges.error ? (
              <ErrorState error={charges.error} onRetry={() => void charges.refetch()} />
            ) : undefined
          }
          empty={
            status === 'PENDING_APPROVAL'
              ? { title: 'No damage charges are waiting for a decision.' }
              : { title: 'No damage charges match these filters.' }
          }
          rowActions={(charge) => {
            if (!isAdmin || charge.status !== 'PENDING_APPROVAL') return null;
            if (charge.inspector?.id === user?.id) {
              return <span className="text-body-sm text-ink-muted">Another Admin must decide</span>;
            }
            return (
              <Button size="sm" variant="primary" onClick={() => setDeciding(charge)}>
                Decide
              </Button>
            );
          }}
          footer={
            charges.data && charges.data.totalPages > 1 ? (
              <Pagination
                pageNumber={charges.data.pageNumber}
                totalPages={charges.data.totalPages}
                onPage={setPageNumber}
              />
            ) : undefined
          }
        />
      </Card>
      {deciding && <DecisionDialog charge={deciding} onClose={() => setDeciding(null)} />}
    </section>
  );
};
