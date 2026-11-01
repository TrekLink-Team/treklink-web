import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../app/providers/useAuth';
import { billingKeys, fetchQuote, usePlans, type QuoteRequest } from '../entities/billing/api';
import {
  contractKeys,
  requestContract,
  useAllAvailability,
  type PlanType,
  type RequestedContract,
} from '../entities/contract/api';
import { useOrganization } from '../entities/organization/api';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime, formatDay, formatVnd, todayDay } from '../shared/lib/format';
import { useDebounced } from '../shared/lib/useDebounced';
import { Empty, ErrorState, Field, Loading, PageTitle } from '../shared/ui/bits';
import { PageActionBar, StickyPageHeader } from '../shared/ui/PageChrome';
import { ConfirmDialog } from '../shared/ui/Dialog';
import { invalid } from '../shared/ui/errors';
import { useToast } from '../shared/ui/toastStore';
import {
  ALERT,
  CARD,
  INPUT,
  LINK,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  WARNING,
} from '../shared/ui/styles';

const STEPS = ['Plan and devices', 'Start date', 'Review and send'] as const;
const QUOTE_DEBOUNCE_MS = 400;
// MSG14, shown after sending (wording amended for D-092 rule 1: the request holds its devices).
const MSG14 =
  'Request sent. Your devices are held; TrekLink will confirm your handover appointment.';

// MSG11, the wording of rentals api-design 01 INSUFFICIENT_DEVICES, for a quantity above the count.
const msg11 = (available: number, variantName: string) =>
  `Only ${available} ${variantName} devices are available. Lower the quantity or choose another variant.`;

interface Errors {
  quantity?: string;
  dayPlanDays?: string;
  hardwareVariantId?: string;
  requestedStartDate?: string;
  form?: string;
}

// Places a server refusal under the field it names (screen 5.1 States).
const errorsOf = (failure: unknown): Errors => {
  if (!(failure instanceof ApiError)) return { form: 'Something went wrong. Please try again.' };
  if (failure.errorCode === 'BELOW_MOQ') return { quantity: failure.message };
  if (failure.errorCode === 'INSUFFICIENT_DEVICES') return { quantity: failure.message };
  if (failure.errorCode === 'DAY_PLAN_LENGTH') return { dayPlanDays: failure.message };
  if (failure.errorCode === 'VALIDATION_FAILED') {
    const field = (
      ['requestedStartDate', 'quantity', 'dayPlanDays', 'hardwareVariantId'] as const
    ).find((name) => failure.message.includes(name));
    return field ? { [field]: failure.message } : { form: failure.message };
  }
  return { form: failure.message };
};

// /o/contracts/new, screen 5.1: three steps of at most four fields, with the quote of billing
// api-design 02 beside them. Since D-092 rule 1 the form shows the units available now (devices
// api-design 24) and refuses a quantity above them (MSG11); the request holds the units, and the page
// then shows when the hold expires and the deposit due before it.
export const ContractRequestPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const plans = usePlans();
  const [step, setStep] = useState(0);
  const [discarding, setDiscarding] = useState(false);
  const [planType, setPlanType] = useState<PlanType>('MONTHLY');
  const [dayPlanDays, setDayPlanDays] = useState<number | ''>('');
  const [variantId, setVariantId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [startDate, setStartDate] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<RequestedContract | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const sentHeading = useRef<HTMLHeadingElement>(null);
  const availability = useAllAvailability();

  // Read from the API (organizations api-design 03), never the sign-in session: a Manager who signed in
  // while PENDING sees the approval without signing in again. Unknown until the head loads.
  const organizationStatus = useOrganization(user?.organization?.id).data?.status;
  const notActive = organizationStatus !== undefined && organizationStatus !== 'ACTIVE';
  const catalogue = plans.data;
  const minOrder = catalogue?.minOrderQuantity ?? 1;
  const quantityNumber = Number(quantity);
  // Null while the count is loading or failed: the request itself decides then (REQ-ERR-01).
  const availableNow =
    availability.data?.find((row) => row.hardwareVariantId === variantId)?.available ?? null;
  const variantName = catalogue?.variants.find((item) => item.id === variantId)?.name ?? '';
  const overAvailable = availableNow !== null && quantityNumber > availableNow;
  const stepOneValid =
    variantId !== '' &&
    Number.isInteger(quantityNumber) &&
    quantityNumber >= minOrder &&
    (planType === 'MONTHLY' || dayPlanDays !== '');

  const quoteRequest: QuoteRequest | null = stepOneValid
    ? {
        planType,
        hardwareVariantId: variantId,
        quantity: quantityNumber,
        ...(planType === 'DAY' ? { dayPlanDays: Number(dayPlanDays) } : {}),
      }
    : null;
  const settledRequest = useDebounced(quoteRequest, QUOTE_DEBOUNCE_MS);
  const quote = useQuery({
    queryKey: settledRequest ? billingKeys.quote(settledRequest) : ['quote', 'none'],
    queryFn: () => fetchQuote(settledRequest as QuoteRequest),
    enabled: settledRequest !== null,
  });

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  useEffect(() => {
    if (sent) sentHeading.current?.focus();
  }, [sent]);

  // A field's error clears as soon as the field changes; Next checks it again.
  const clearError = (field: keyof Errors) =>
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));

  const dirty = variantId !== '' || quantity !== '' || startDate !== '' || dayPlanDays !== '';
  // Leaving with something entered asks first, in the shared confirmation dialog.
  const cancel = () => {
    if (dirty) setDiscarding(true);
    else navigate('/o/contracts');
  };

  const next = () => {
    if (step === 0) {
      const found: Errors = {};
      if (variantId === '') found.hardwareVariantId = 'Hardware variant is required.';
      if (!Number.isInteger(quantityNumber) || quantityNumber < minOrder) {
        found.quantity = `The minimum order is ${minOrder} devices.`;
      } else if (overAvailable) {
        found.quantity = msg11(availableNow, variantName);
      }
      if (planType === 'DAY' && dayPlanDays === '')
        found.dayPlanDays = 'Day plan length is required.';
      setErrors(found);
      if (Object.keys(found).length > 0) return;
    }
    if (step === 1) {
      if (startDate === '' || startDate < todayDay()) {
        setErrors({ requestedStartDate: 'Start date must not be in the past.' });
        return;
      }
      setErrors({});
    }
    setStep(step + 1);
  };

  const send = async () => {
    if (overAvailable) {
      setErrors({ quantity: msg11(availableNow, variantName) });
      setStep(0);
      return;
    }
    setPending(true);
    setErrors({});
    try {
      const contract = await requestContract({
        planType,
        hardwareVariantId: variantId,
        quantity: quantityNumber,
        requestedStartDate: startDate,
        ...(planType === 'DAY' ? { dayPlanDays: Number(dayPlanDays) } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: contractKeys.all });
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
      showToast(MSG14);
      setSent(contract);
      setPending(false);
    } catch (failure) {
      const found = errorsOf(failure);
      setErrors(found);
      // Another organization took the units first: read the count again.
      if (failure instanceof ApiError && failure.errorCode === 'INSUFFICIENT_DEVICES') {
        void availability.refetch();
      }
      if (found.quantity || found.dayPlanDays || found.hardwareVariantId) setStep(0);
      else if (found.requestedStartDate) setStep(1);
      setPending(false);
    }
  };

  if (plans.isLoading) return <Loading label="Loading plans" />;
  if (plans.error) return <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />;
  if (!catalogue || catalogue.variants.length === 0) {
    return <Empty>No devices can be rented right now. Contact TrekLink.</Empty>;
  }
  const variant = catalogue.variants.find((item) => item.id === variantId);
  const countOf = (id: string) =>
    availability.data?.find((row) => row.hardwareVariantId === id)?.available;

  if (sent) {
    return (
      <section aria-labelledby="sent-title" className="flex flex-1 flex-col">
        <PageTitle title="Request a contract" />
        <div role="status" className={`${CARD} flex max-w-2xl flex-col gap-3`}>
          <h2
            id="sent-title"
            ref={sentHeading}
            tabIndex={-1}
            className="text-lg font-bold text-ink"
          >
            Request {sent.code} sent
          </h2>
          <p>
            {sent.heldDevices} {variant?.name ?? 'devices'} devices are held for you until{' '}
            <strong>{formatDateTime(sent.holdExpiresAt)}</strong>.
          </p>
          <p>
            Deposit due before then: <strong>{formatVnd(sent.quote.firstPaymentVnd)}</strong>
            {sent.planType === 'DAY' ? ', the whole day-plan fee' : ', the holding fee'}. Pay it at
            the TrekLink counter or online. If it is not paid by then, the request is cancelled and
            the devices are released.
          </p>
          <p className="text-ink-muted">TrekLink will confirm your handover appointment.</p>
          <div className="flex flex-wrap gap-3">
            <Link to={`/o/contracts/${sent.id}`} className={PRIMARY_BUTTON}>
              Open the contract
            </Link>
            <Link to={`/o/invoices?contractId=${sent.id}`} className={SECONDARY_BUTTON}>
              Pay the deposit
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const quotePanel = (
    <aside
      aria-live="polite"
      aria-label="Quote"
      className={`${CARD} h-fit border-chrome-strong md:sticky md:top-[calc(var(--tl-page-header-h,0px)+1rem)]`}
    >
      <h2 className="text-lg font-bold text-ink">Quote</h2>
      <p className="text-xs text-ink-muted">Updates as you choose.</p>
      {!quoteRequest && (
        <p className="mt-2 text-sm text-ink-muted">Choose a plan, a variant and a quantity.</p>
      )}
      {quoteRequest && quote.isFetching && <p className="mt-2 text-sm">Calculating…</p>}
      {quoteRequest && quote.error && (
        <p className="mt-2 text-sm text-status-critical-fg">
          {errorsOf(quote.error).quantity ?? errorsOf(quote.error).form}
        </p>
      )}
      {quoteRequest && quote.data && !quote.isFetching && (
        <dl className="mt-3 flex flex-col gap-2 text-sm">
          {quote.data.planType === 'MONTHLY' ? (
            <>
              <div className="flex justify-between">
                <dt>Term fee (one month)</dt>
                <dd className="font-semibold">{formatVnd(quote.data.termFeeVnd ?? 0)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>
                  First payment, holding fee ({Math.round(catalogue.holdingFeeRatio * 100)} %)
                </dt>
                <dd className="font-semibold">{formatVnd(quote.data.firstPaymentVnd)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Balance at each term end</dt>
                <dd className="font-semibold">
                  {formatVnd((quote.data.termFeeVnd ?? 0) - quote.data.firstPaymentVnd)}
                </dd>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-between">
                <dt>Per device per day</dt>
                <dd className="font-semibold">{formatVnd(quote.data.unitPerDayVnd ?? 0)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Days</dt>
                <dd className="font-semibold">{quote.data.days}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Total, paid up front</dt>
                <dd className="font-semibold">{formatVnd(quote.data.totalVnd ?? 0)}</dd>
              </div>
            </>
          )}
          <div className="rounded-lg bg-sunken px-3 py-2 text-xs text-ink-muted">
            Formula: <span className="font-mono">{quote.data.formula}</span>
          </div>
          <p className="text-xs text-ink-muted">
            Prices are fixed when you send the request. The request holds the devices; the first
            payment is the deposit that keeps them.
          </p>
        </dl>
      )}
    </aside>
  );

  return (
    <section aria-labelledby="request-title" className="flex flex-1 flex-col">
      <StickyPageHeader>
        <PageTitle
          title="Request a contract"
          action={
            <button type="button" onClick={cancel} className={LINK}>
              Cancel
            </button>
          }
        />
        <ol className="mb-5 flex flex-wrap items-center gap-2 text-sm" aria-label="Steps">
          {STEPS.map((label, index) => (
            <li
              key={label}
              aria-current={index === step ? 'step' : undefined}
              className={`flex items-center gap-2 rounded-full px-3 py-1 font-semibold group-data-[compact=true]/chrome:py-0.5 ${
                index === step ? '' : 'group-data-[compact=true]/chrome:max-sm:hidden'
              } ${
                index === step
                  ? 'bg-accent text-on-accent'
                  : index < step
                    ? 'bg-status-done-tint text-status-done-fg'
                    : 'bg-sunken text-ink-muted'
              }`}
            >
              <span aria-hidden="true">{index < step ? '✓' : index + 1}</span>
              {label}
              {index < step && <span className="sr-only">(done)</span>}
            </li>
          ))}
        </ol>
      </StickyPageHeader>

      {notActive && (
        <div role="alert" className={`${WARNING} mb-4`}>
          This cannot be done while it is {organizationStatus}.
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-[1fr_320px]">
        <div className={`${CARD} flex min-w-0 flex-col gap-4`}>
          <h2 id="request-title" ref={heading} tabIndex={-1} className="text-lg font-bold text-ink">
            {STEPS[step]}
          </h2>
          {errors.form && (
            <div role="alert" className={ALERT}>
              {errors.form}
            </div>
          )}

          {step === 0 && (
            <>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-sm font-semibold text-ink">Plan</legend>
                <div className="flex gap-2">
                  {(['MONTHLY', 'DAY'] as const).map((type) => (
                    <label
                      key={type}
                      className={`flex h-11 cursor-pointer items-center rounded-lg border px-4 font-semibold transition focus-within:ring-2 focus-within:ring-focus focus-within:ring-offset-2 ${
                        planType === type
                          ? 'border-accent bg-chrome text-ink'
                          : 'border-line-strong hover:bg-chrome/60'
                      }`}
                    >
                      <input
                        type="radio"
                        name="planType"
                        value={type}
                        checked={planType === type}
                        onChange={() => setPlanType(type)}
                        className="sr-only"
                      />
                      {type === 'MONTHLY' ? 'Monthly' : 'Day plan'}
                    </label>
                  ))}
                </div>
              </fieldset>

              {planType === 'DAY' && (
                <Field id="day-plan-days" label="Day plan length" error={errors.dayPlanDays}>
                  <select
                    id="day-plan-days"
                    className={INPUT}
                    value={dayPlanDays}
                    onChange={(event) => {
                      setDayPlanDays(event.target.value ? Number(event.target.value) : '');
                      clearError('dayPlanDays');
                    }}
                    {...invalid('day-plan-days', errors.dayPlanDays)}
                  >
                    <option value="">Choose a length</option>
                    {catalogue.dayPlanLengths.map((length) => (
                      <option key={length} value={length}>
                        {length} days
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              <Field id="variant" label="Hardware variant" error={errors.hardwareVariantId}>
                <select
                  id="variant"
                  className={INPUT}
                  value={variantId}
                  onChange={(event) => {
                    setVariantId(event.target.value);
                    clearError('hardwareVariantId');
                  }}
                  {...invalid('variant', errors.hardwareVariantId)}
                >
                  <option value="">Choose a variant</option>
                  {catalogue.variants.map((item) => {
                    const count = countOf(item.id);
                    return (
                      <option key={item.id} value={item.id}>
                        {item.name}, {formatVnd(item.monthlyPriceVnd)} per device per month
                        {count === undefined ? '' : `, ${count} available now`}
                      </option>
                    );
                  })}
                </select>
              </Field>

              <Field
                id="quantity"
                label="Quantity"
                error={errors.quantity}
                hint={`At least ${minOrder} devices.`}
              >
                <input
                  id="quantity"
                  type="number"
                  inputMode="numeric"
                  min={minOrder}
                  className={INPUT}
                  value={quantity}
                  onChange={(event) => {
                    setQuantity(event.target.value);
                    clearError('quantity');
                  }}
                  {...invalid('quantity', errors.quantity)}
                />
              </Field>
              {variantId !== '' && (
                <div className="-mt-2 flex flex-wrap items-center gap-3 text-sm">
                  <p aria-live="polite" className="text-ink-muted">
                    {availability.isError
                      ? 'Availability could not be read; the request will check it.'
                      : availableNow === null
                        ? 'Checking availability…'
                        : `${availableNow} available now`}
                  </p>
                  <button
                    type="button"
                    className={LINK}
                    disabled={availability.isFetching}
                    onClick={() => void availability.refetch()}
                  >
                    {availability.isFetching ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <Field
              id="start-date"
              label="Start date (handover day)"
              error={errors.requestedStartDate}
            >
              <input
                id="start-date"
                type="date"
                min={todayDay()}
                className={INPUT}
                value={startDate}
                onChange={(event) => {
                  setStartDate(event.target.value);
                  clearError('requestedStartDate');
                }}
                {...invalid('start-date', errors.requestedStartDate)}
              />
            </Field>
          )}

          {step === 2 && (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-ink-muted">Plan</dt>
                <dd>{planType === 'DAY' ? `Day plan, ${dayPlanDays} days` : 'Monthly'}</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink-muted">Hardware variant</dt>
                <dd>{variant?.name}</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink-muted">Quantity</dt>
                <dd>{quantityNumber} devices</dd>
              </div>
              <div>
                <dt className="font-semibold text-ink-muted">Start date</dt>
                <dd>{startDate && formatDay(startDate)}</dd>
              </div>
              <p className="sm:col-span-2 text-ink-muted">
                Plan, variant and quantity cannot change after the request. Need more devices? Send
                another request.
              </p>
            </dl>
          )}
        </div>
        {quotePanel}
      </div>
      <PageActionBar
        label="Request steps"
        start={
          step > 0 ? (
            <button type="button" className={SECONDARY_BUTTON} onClick={() => setStep(step - 1)}>
              Back
            </button>
          ) : (
            <Link
              to="/o/contracts"
              className={SECONDARY_BUTTON}
              onClick={(event) => {
                if (!dirty) return;
                event.preventDefault();
                setDiscarding(true);
              }}
            >
              Back to contracts
            </Link>
          )
        }
      >
        {step < 2 ? (
          <button type="button" className={PRIMARY_BUTTON} onClick={next}>
            Next
          </button>
        ) : (
          <button
            type="button"
            className={PRIMARY_BUTTON}
            disabled={pending || notActive || overAvailable}
            onClick={() => void send()}
          >
            {pending ? 'Sending…' : 'Send request'}
          </button>
        )}
      </PageActionBar>
      {discarding && (
        <ConfirmDialog
          titleId="discard-title"
          title="Discard this request?"
          description="What you entered is not saved."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          destructive
          onConfirm={() => navigate('/o/contracts')}
          onCancel={() => setDiscarding(false)}
        />
      )}
    </section>
  );
};
