import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../app/providers/useAuth';
import { billingKeys, fetchQuote, usePlans, type QuoteRequest } from '../entities/billing/api';
import { contractKeys, requestContract, type PlanType } from '../entities/contract/api';
import { useOrganization } from '../entities/organization/api';
import { ApiError } from '../shared/api/apiClient';
import { formatDay, formatVnd, todayDay } from '../shared/lib/format';
import { Empty, ErrorState, Field, Loading, PageTitle } from '../shared/ui/bits';
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
const DISCARD_PROMPT = 'Discard this request?';
// MSG14, shown on the contract page after sending.
const MSG14 = 'Request sent. TrekLink will confirm availability and your handover appointment.';

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
  if (failure.errorCode === 'DAY_PLAN_LENGTH') return { dayPlanDays: failure.message };
  if (failure.errorCode === 'VALIDATION_FAILED') {
    const field = (
      ['requestedStartDate', 'quantity', 'dayPlanDays', 'hardwareVariantId'] as const
    ).find((name) => failure.message.includes(name));
    return field ? { [field]: failure.message } : { form: failure.message };
  }
  return { form: failure.message };
};

// Waits until the step 1 values have been still for a moment, so typing a quantity sends one quote.
const useDebounced = <T,>(value: T, ms: number): T => {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
};

// /o/contracts/new, screen 5.1: three steps of at most four fields, with the quote of billing
// api-design 02 beside them. Nothing is charged until Staff approve and the first invoice is paid.
export const ContractRequestPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const plans = usePlans();
  const [step, setStep] = useState(0);
  const [planType, setPlanType] = useState<PlanType>('MONTHLY');
  const [dayPlanDays, setDayPlanDays] = useState<number | ''>('');
  const [variantId, setVariantId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [startDate, setStartDate] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  // Read from the API (organizations api-design 03), never the sign-in session: a Manager who signed in
  // while PENDING sees the approval without signing in again. Unknown until the head loads.
  const organizationStatus = useOrganization(user?.organization?.id).data?.status;
  const notActive = organizationStatus !== undefined && organizationStatus !== 'ACTIVE';
  const catalogue = plans.data;
  const minOrder = catalogue?.minOrderQuantity ?? 1;
  const quantityNumber = Number(quantity);
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

  // A field's error clears as soon as the field changes; Next checks it again.
  const clearError = (field: keyof Errors) =>
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));

  const dirty = variantId !== '' || quantity !== '' || startDate !== '' || dayPlanDays !== '';
  const cancel = () => {
    if (!dirty || window.confirm(DISCARD_PROMPT)) navigate('/o/contracts');
  };

  const next = () => {
    if (step === 0) {
      const found: Errors = {};
      if (variantId === '') found.hardwareVariantId = 'Hardware variant is required.';
      if (!Number.isInteger(quantityNumber) || quantityNumber < minOrder) {
        found.quantity = `The minimum order is ${minOrder} devices.`;
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
      showToast(MSG14);
      navigate(`/o/contracts/${contract.id}`);
    } catch (failure) {
      const found = errorsOf(failure);
      setErrors(found);
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

  const quotePanel = (
    <aside
      aria-live="polite"
      aria-label="Quote"
      className={`${CARD} h-fit border-blue-100 md:sticky md:top-4`}
    >
      <h2 className="text-lg font-bold text-slate-900">Quote</h2>
      <p className="text-xs text-slate-600">Updates as you choose.</p>
      {!quoteRequest && (
        <p className="mt-2 text-sm text-slate-600">Choose a plan, a variant and a quantity.</p>
      )}
      {quoteRequest && quote.isFetching && <p className="mt-2 text-sm">Calculating…</p>}
      {quoteRequest && quote.error && (
        <p className="mt-2 text-sm text-red-700">
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
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
            Formula: <span className="font-mono">{quote.data.formula}</span>
          </div>
          <p className="text-xs text-slate-600">
            Prices are fixed when you send the request. Nothing is charged until TrekLink approves
            it.
          </p>
        </dl>
      )}
    </aside>
  );

  return (
    <section aria-labelledby="request-title">
      <PageTitle
        title="Request a contract"
        action={
          <button type="button" onClick={cancel} className={LINK}>
            Cancel
          </button>
        }
      />

      {notActive && (
        <div role="alert" className={`${WARNING} mb-4`}>
          This cannot be done while it is {organizationStatus}.
        </div>
      )}

      <ol className="mb-5 flex flex-wrap items-center gap-2 text-sm" aria-label="Steps">
        {STEPS.map((label, index) => (
          <li
            key={label}
            aria-current={index === step ? 'step' : undefined}
            className={`flex items-center gap-2 rounded-full px-3 py-1 font-semibold ${
              index === step
                ? 'bg-blue-700 text-white'
                : index < step
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'bg-slate-200 text-slate-700'
            }`}
          >
            <span aria-hidden="true">{index < step ? '✓' : index + 1}</span>
            {label}
            {index < step && <span className="sr-only">(done)</span>}
          </li>
        ))}
      </ol>

      <div className="grid gap-5 md:grid-cols-[1fr_320px]">
        <div className={`${CARD} flex min-w-0 flex-col gap-4`}>
          <h2
            id="request-title"
            ref={heading}
            tabIndex={-1}
            className="text-lg font-bold text-slate-900"
          >
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
                <legend className="text-sm font-semibold text-slate-900">Plan</legend>
                <div className="flex gap-2">
                  {(['MONTHLY', 'DAY'] as const).map((type) => (
                    <label
                      key={type}
                      className={`flex h-11 cursor-pointer items-center rounded-lg border px-4 font-semibold transition focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 ${
                        planType === type
                          ? 'border-blue-700 bg-blue-50 text-blue-800'
                          : 'border-slate-300 hover:bg-slate-50'
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
                  {catalogue.variants.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}, {formatVnd(item.monthlyPriceVnd)} per device per month
                    </option>
                  ))}
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
                <dt className="font-semibold text-slate-600">Plan</dt>
                <dd>{planType === 'DAY' ? `Day plan, ${dayPlanDays} days` : 'Monthly'}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-600">Hardware variant</dt>
                <dd>{variant?.name}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-600">Quantity</dt>
                <dd>{quantityNumber} devices</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-600">Start date</dt>
                <dd>{startDate && formatDay(startDate)}</dd>
              </div>
              <p className="sm:col-span-2 text-slate-700">
                Plan, variant and quantity cannot change after the request. Need more devices? Send
                another request.
              </p>
            </dl>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            {step > 0 ? (
              <button type="button" className={SECONDARY_BUTTON} onClick={() => setStep(step - 1)}>
                Back
              </button>
            ) : (
              <Link
                to="/o/contracts"
                className={SECONDARY_BUTTON}
                onClick={(event) => {
                  if (dirty && !window.confirm(DISCARD_PROMPT)) event.preventDefault();
                }}
              >
                Back to contracts
              </Link>
            )}
            {step < 2 ? (
              <button type="button" className={PRIMARY_BUTTON} onClick={next}>
                Next
              </button>
            ) : (
              <button
                type="button"
                className={PRIMARY_BUTTON}
                disabled={pending || notActive}
                onClick={() => void send()}
              >
                {pending ? 'Sending…' : 'Send request'}
              </button>
            )}
          </div>
        </div>
        {quotePanel}
      </div>
    </section>
  );
};
