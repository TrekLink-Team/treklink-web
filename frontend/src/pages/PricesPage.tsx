import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageScrollBody } from '../shared/ui/PageChrome';
import {
  createDamageRate,
  schedulePrice,
  updateDamageRate,
  useDamageRates,
  usePlans,
  usePriceHistory,
  type DamageRate,
  type PriceRow,
} from '../entities/billing/api';
import { ApiError } from '../shared/api/apiClient';
import { Pencil, Tags } from 'lucide-react';
import { formatDateTime, formatVnd } from '../shared/lib/format';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Checkbox,
  CollectionView,
  ConfirmDialog,
  Dialog,
  Field,
  Input,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
  useToast,
  type CollectionField,
  type StatusEntry,
} from '../shared/ui';
import { ErrorState } from '../shared/ui/bits';
import { invalid } from '../shared/ui/errors';
import { MoneyInput } from '../shared/ui/MoneyInput';

type Errors = Record<string, string | undefined>;

// The server names the field in its message (`{field} is required.`); the error goes under it,
// anything else above the form (chapter 06 §8.7).
const errorsOf = (failure: unknown, fields: string[], codeField?: string): Errors => {
  if (!(failure instanceof ApiError)) return { form: 'Something went wrong. Please try again.' };
  if (failure.errorCode === 'EFFECTIVE_IN_PAST') return { effectiveFrom: failure.message };
  if (failure.errorCode === 'CONFLICT_UNIQUE' && codeField) return { [codeField]: failure.message };
  const field = fields.find((name) => failure.message.includes(name));
  return field ? { [field]: failure.message } : { form: failure.message };
};

// Now as a datetime-local value in the viewer's timezone, the floor of Effective from.
const nowLocal = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

// The field holds minutes, so its default, the current minute, is already past when the server
// checks it (api-design 04 refuses a past time). A time earlier than one minute from now is sent as
// one minute from now, which also covers a client clock a little behind the server's.
const effectiveInstant = (local: string) =>
  new Date(Math.max(new Date(local).getTime(), Date.now() + 60_000)).toISOString();

const useVariants = () => {
  const plans = usePlans();
  const variants = plans.data?.variants ?? [];
  const codeOf = (id: string | null) =>
    id === null ? 'All variants' : (variants.find((variant) => variant.id === id)?.code ?? id);
  return { variants, codeOf };
};

const PriceDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const { variants, codeOf } = useVariants();
  const [variantId, setVariantId] = useState('');
  const [price, setPrice] = useState('');
  const [from, setFrom] = useState(nowLocal());
  const [errors, setErrors] = useState<Errors>({});
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const monthlyPriceVnd = Number(price.replace(/[,\s]/g, ''));

  const check = (event: React.FormEvent) => {
    event.preventDefault();
    const found: Errors = {};
    if (variantId === '') found.hardwareVariantId = 'Variant is required.';
    if (!Number.isInteger(monthlyPriceVnd) || monthlyPriceVnd < 1) {
      found.monthlyPriceVnd = 'Monthly price must be a positive whole number of VND.';
    }
    if (from === '') found.effectiveFrom = 'Effective from is required.';
    setErrors(found);
    if (Object.keys(found).length === 0) setConfirming(true);
  };

  const save = async () => {
    setPending(true);
    try {
      await schedulePrice({
        hardwareVariantId: variantId,
        monthlyPriceVnd,
        effectiveFrom: effectiveInstant(from),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['price-schedules'] }),
        queryClient.invalidateQueries({ queryKey: ['plans'] }),
      ]);
      showToast('Saved.');
      onClose();
    } catch (failure) {
      setPending(false);
      setConfirming(false);
      setErrors(errorsOf(failure, ['hardwareVariantId', 'monthlyPriceVnd', 'effectiveFrom']));
    }
  };

  if (confirming) {
    return (
      <ConfirmDialog
        titleId="price-confirm-title"
        title={`Set ${codeOf(variantId)} to ${formatVnd(monthlyPriceVnd)}?`}
        description={`Per device per month from ${formatDateTime(effectiveInstant(from))}. Contracts already requested keep their price.`}
        confirmLabel="Schedule price"
        pending={pending}
        onConfirm={() => void save()}
        onCancel={() => setConfirming(false)}
      />
    );
  }

  return (
    <Dialog
      titleId="price-title"
      title="Schedule a price"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="price-form" variant="primary">
            Schedule price
          </Button>
        </>
      }
    >
      <form id="price-form" onSubmit={check} noValidate className="flex flex-col gap-4">
        {errors.form && <Alert tone="error">{errors.form}</Alert>}
        <Field id="price-variant" label="Variant" error={errors.hardwareVariantId} required>
          <Select
            id="price-variant"
            value={variantId}
            onChange={(event) => setVariantId(event.target.value)}
            {...invalid('price-variant', errors.hardwareVariantId)}
          >
            <option value="">Choose a variant</option>
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="price-amount"
          label="Monthly price (VND)"
          error={errors.monthlyPriceVnd}
          required
        >
          <MoneyInput
            id="price-amount"
            label="Monthly price"
            value={price}
            onValueChange={setPrice}
            {...invalid('price-amount', errors.monthlyPriceVnd)}
          />
        </Field>
        <Field
          id="price-from"
          label="Effective from"
          error={errors.effectiveFrom}
          hint="Now or later. Contracts already requested keep their price."
          required
        >
          <Input
            id="price-from"
            type="datetime-local"
            min={nowLocal()}
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            {...invalid('price-from', errors.effectiveFrom)}
          />
        </Field>
      </form>
    </Dialog>
  );
};

// Add (rate null) or edit one damage rate; the code and variant of an existing rate do not change.
// Deactivating a rate asks first, naming it (chapter 06 §8.1).
const RateDialog: React.FC<{ rate: DamageRate | null; onClose: () => void }> = ({
  rate,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const { variants } = useVariants();
  const [code, setCode] = useState(rate?.code ?? '');
  const [label, setLabel] = useState(rate?.label ?? '');
  const [variantId, setVariantId] = useState(rate?.hardwareVariantId ?? '');
  const [amount, setAmount] = useState(rate ? String(rate.amountVnd) : '');
  const [active, setActive] = useState(rate?.isActive ?? true);
  const [errors, setErrors] = useState<Errors>({});
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const amountVnd = Number(amount.replace(/[,\s]/g, ''));

  const save = async () => {
    setPending(true);
    try {
      if (rate) {
        await updateDamageRate(rate.id, {
          ...(label.trim() !== rate.label ? { label: label.trim() } : {}),
          ...(amountVnd !== rate.amountVnd ? { amountVnd } : {}),
          ...(active !== rate.isActive ? { isActive: active } : {}),
        });
      } else {
        await createDamageRate({
          code,
          label: label.trim(),
          hardwareVariantId: variantId === '' ? null : variantId,
          amountVnd,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['damage-rates'] });
      showToast('Saved.');
      onClose();
    } catch (failure) {
      setPending(false);
      setConfirming(false);
      setErrors(errorsOf(failure, ['code', 'label', 'amountVnd', 'hardwareVariantId'], 'code'));
    }
  };

  const check = (event: React.FormEvent) => {
    event.preventDefault();
    const found: Errors = {};
    if (!rate && !/^[A-Z][A-Z0-9_]*$/.test(code)) found.code = 'Code must be UPPER_SNAKE_CASE.';
    if (label.trim() === '') found.label = 'Label is required.';
    if (!Number.isInteger(amountVnd) || amountVnd < 1) {
      found.amountVnd = 'Amount must be a positive whole number of VND.';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (rate && rate.isActive && !active) setConfirming(true);
    else void save();
  };

  if (confirming && rate) {
    return (
      <ConfirmDialog
        titleId="rate-confirm-title"
        title={`Deactivate ${rate.code}?`}
        description={`${rate.label}. Inspections can no longer use it.`}
        confirmLabel="Deactivate"
        destructive
        pending={pending}
        onConfirm={() => void save()}
        onCancel={() => setConfirming(false)}
      />
    );
  }

  return (
    <Dialog
      titleId="rate-title"
      title={rate ? `Edit ${rate.code}` : 'Add a damage rate'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="rate-form" variant="primary" loading={pending}>
            Save
          </Button>
        </>
      }
    >
      <form id="rate-form" onSubmit={check} noValidate className="flex flex-col gap-4">
        {errors.form && <Alert tone="error">{errors.form}</Alert>}
        {!rate && (
          <>
            <Field
              id="rate-code"
              label="Code"
              error={errors.code}
              hint="UPPER_SNAKE_CASE."
              required
            >
              <Input
                id="rate-code"
                className="font-mono"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                {...invalid('rate-code', errors.code)}
              />
            </Field>
            <Field id="rate-variant" label="Variant">
              <Select
                id="rate-variant"
                value={variantId}
                onChange={(event) => setVariantId(event.target.value)}
              >
                <option value="">All variants</option>
                {variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.code}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
        <Field id="rate-label" label="Label" error={errors.label} required>
          <Input
            id="rate-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            {...invalid('rate-label', errors.label)}
          />
        </Field>
        <Field id="rate-amount" label="Amount (VND)" error={errors.amountVnd} required>
          <MoneyInput
            id="rate-amount"
            label="Amount"
            value={amount}
            onValueChange={setAmount}
            {...invalid('rate-amount', errors.amountVnd)}
          />
        </Field>
        {rate && (
          <Checkbox
            label="Active"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />
        )}
      </form>
    </Dialog>
  );
};

const PRICE_STATE: Record<PriceRow['state'], StatusEntry> = {
  CURRENT: { label: 'Current', tone: 'active' },
  UPCOMING: { label: 'Upcoming', tone: 'waiting' },
  PAST: { label: 'Past', tone: 'ended' },
};

const RATE_STATE: Record<'active' | 'inactive', StatusEntry> = {
  active: { label: 'Active', tone: 'active' },
  inactive: { label: 'Inactive', tone: 'ended' },
};

// /t/admin/prices, screen 6.4 (billing api-design 03 to 07): the append-only monthly price
// schedule and the damage rates, TrekLink Admin only. The filters narrow the rows already loaded.
// The damage charge queue is its own page, /t/damage-charges (DamageChargesPage).
export const PricesPage: React.FC = () => {
  const [pageNumber, setPageNumber] = useState(1);
  const prices = usePriceHistory(pageNumber);
  const rates = useDamageRates();
  const { codeOf, variants } = useVariants();
  const [pricing, setPricing] = useState(false);
  const [editing, setEditing] = useState<DamageRate | null | undefined>(undefined);
  // Both lists filter the rows already loaded (chapter 06 §9): the state or the active flag is the
  // Show filter, and the price history's variant is a second filter in Show, as its select was.
  const priceFields: CollectionField<PriceRow>[] = [
    {
      key: 'variant',
      label: 'Variant',
      render: (row) => <span className="whitespace-nowrap">{codeOf(row.hardwareVariantId)}</span>,
      text: (row) => codeOf(row.hardwareVariantId),
      compact: true,
    },
    {
      key: 'price',
      label: 'Per device per month',
      align: 'end',
      render: (row) => <span className="font-semibold">{formatVnd(row.monthlyPriceVnd)}</span>,
      compact: true,
    },
    {
      key: 'state',
      label: 'State',
      render: (row) => <StatusBadge entry={PRICE_STATE[row.state]} />,
      compact: true,
    },
    {
      key: 'by',
      label: 'Set by',
      render: (row) => `${row.createdBy ?? 'Seed'}, ${formatDateTime(row.createdAt)}`,
      hideWithPane: true,
    },
  ];

  const rateFields: CollectionField<DamageRate>[] = [
    { key: 'label', label: 'Label', render: (rate) => rate.label, text: (rate) => rate.label, compact: true },
    {
      key: 'variant',
      label: 'Variant',
      render: (rate) => <span className="whitespace-nowrap">{codeOf(rate.hardwareVariantId)}</span>,
      text: (rate) => codeOf(rate.hardwareVariantId),
      hideWithPane: true,
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'end',
      render: (rate) => <span className="font-semibold">{formatVnd(rate.amountVnd)}</span>,
      compact: true,
    },
    {
      key: 'active',
      label: 'Active',
      render: (rate) => <StatusBadge entry={RATE_STATE[rate.isActive ? 'active' : 'inactive']} />,
      compact: true,
    },
  ];

  return (
    <section aria-labelledby="prices-title" data-fit-page="" className="flex min-h-0 flex-1 flex-col gap-6">
      <PageHeader id="prices-title" title="Prices and damage rates" />

      <PageScrollBody label="Prices and damage rates" className="flex flex-col gap-6">
        <Card>
          <CardHeader
            title="Monthly prices"
            action={
              <Button variant="primary" onClick={() => setPricing(true)}>
                Schedule price
              </Button>
            }
          />
          <CollectionView<PriceRow>
            icon={<Tags />}
            label="Monthly price history"
            items={prices.data?.items}
            loading={prices.isLoading}
            error={prices.error ? <ErrorState error={prices.error} onRetry={() => void prices.refetch()} /> : undefined}
            itemId={(row) => row.id}
            itemName={(row) => `${codeOf(row.hardwareVariantId)} from ${formatDateTime(row.effectiveFrom)}`}
            itemTitle={(row) => <span className="whitespace-nowrap">{formatDateTime(row.effectiveFrom)}</span>}
            fields={priceFields}
            noun={{ one: 'price', other: 'prices' }}
            search={{ label: 'Search prices by variant' }}
            filters={[
              { key: 'all', label: 'All states' },
              ...(Object.keys(PRICE_STATE) as PriceRow['state'][]).map((state) => ({
                key: state,
                label: PRICE_STATE[state].label,
                test: (row: PriceRow) => row.state === state,
              })),
            ]}
            filterGroups={[
              {
                key: 'variant',
                label: 'Variant',
                options: [
                  { key: '', label: 'All variants' },
                  ...variants.map((variant) => ({
                    key: variant.id,
                    label: variant.code,
                    test: (row: PriceRow) => row.hardwareVariantId === variant.id,
                  })),
                ],
              },
            ]}
            emptyState={{ title: 'No prices yet.' }}
            footer={
              prices.data && prices.data.totalPages > 1 ? (
                <Pagination
                  pageNumber={prices.data.pageNumber}
                  totalPages={prices.data.totalPages}
                  onPage={setPageNumber}
                />
              ) : undefined
            }
          />
        </Card>

        <Card>
          <CardHeader
            title="Damage rates"
            action={
              <Button variant="primary" onClick={() => setEditing(null)}>
                Add damage rate
              </Button>
            }
          />
          <CollectionView<DamageRate>
            icon={<Tags />}
            label="Damage rates"
            items={rates.data}
            loading={rates.isLoading}
            error={rates.error ? <ErrorState error={rates.error} onRetry={() => void rates.refetch()} /> : undefined}
            itemId={(rate) => rate.id}
            itemName={(rate) => rate.code}
            itemTitle={(rate) => <span className="font-mono font-semibold text-ink">{rate.code}</span>}
            fields={rateFields}
            noun={{ one: 'damage rate', other: 'damage rates' }}
            itemActions={[{ key: 'edit', label: 'Edit', icon: <Pencil />, onSelect: (rate) => setEditing(rate) }]}
            search={{ label: 'Filter by code, label or variant', placeholder: 'Code, label or variant' }}
            filters={[
              { key: 'all', label: 'Active and inactive' },
              { key: 'active', label: 'Active', test: (rate) => rate.isActive },
              { key: 'inactive', label: 'Inactive', test: (rate) => !rate.isActive },
            ]}
            emptyState={{
              title: 'No damage codes yet.',
              description: 'Add one before inspections can record damage.',
            }}
          />
        </Card>

        {pricing && <PriceDialog onClose={() => setPricing(false)} />}
        {editing !== undefined && <RateDialog rate={editing} onClose={() => setEditing(undefined)} />}
      </PageScrollBody>
    </section>
  );
};
