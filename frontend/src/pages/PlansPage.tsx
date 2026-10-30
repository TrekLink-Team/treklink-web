import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../app/providers/useAuth';
import { usePlans, type Plans } from '../entities/billing/api';
import { landingRoute } from '../entities/session/model';
import { ApiError } from '../shared/api/apiClient';
import { CONTACT_EMAIL } from '../shared/config/contact';
import { formatVnd } from '../shared/lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SAR_DISCLAIMER,
  Skeleton,
  buttonClasses,
} from '../shared/ui';
import { LINK, WARNING } from '../shared/ui/styles';

// Static copy of the rental flow MF-01 and MF-02 (main flows, SRS): no endpoint.
const STEPS = [
  'Register your organization.',
  'TrekLink verifies your identity and documents at the counter.',
  'Request your plan and pay the first amount.',
  'Collect your provisioned devices at the counter and sign the handover note.',
];

const lengthsText = (days: number[]) =>
  days.length > 1
    ? `${days.slice(0, -1).join(', ')} or ${days[days.length - 1]} days`
    : `${days[0]} days`;

const percent = (ratio: number) => `${Number((ratio * 100).toFixed(1))} %`;

const Disclaimer: React.FC = () => (
  <p role="note" className={WARNING}>
    {SAR_DISCLAIMER}
  </p>
);

const SandboxLabel: React.FC = () => <Badge className="ml-2">Sandbox price</Badge>;

const Terms: React.FC<{ plans: Plans }> = ({ plans }) => (
  <Card aria-labelledby="plans-terms">
    <h2 id="plans-terms" className="mb-3 text-title-sm text-ink">
      Terms for every plan
    </h2>
    <ul className="flex list-disc flex-col gap-1.5 pl-5 text-body text-ink">
      <li>From {plans.minOrderQuantity} devices per contract.</li>
      <li>
        Day plans of {lengthsText(plans.dayPlanLengths)}, at {plans.dayPremium} times the daily
        share of the monthly price.
      </li>
      <li>
        A holding fee of {percent(plans.holdingFeeRatio)} of the first monthly term is due at the
        term start.
      </li>
    </ul>
  </Card>
);

// `/` and `/plans`, screen 2.3 (billing api-design 01, UC-15, UC-56): the public price list and how
// renting works. A signed-in user sees the same page with a link to their workspace instead of Sign in.
export const PlansPage: React.FC = () => {
  const { user } = useAuth();
  // Prices change by an Admin edit (UC-56): fresh for 5 minutes, no refetch on window focus.
  const plans = usePlans({ staleTime: 300_000, refetchOnWindowFocus: false });
  const firstCard = useRef<HTMLHeadingElement>(null);
  const retried = useRef(false);

  // After Retry succeeds, focus moves to the first variant card heading (screen 2.3, accessibility).
  // Keyed on dataUpdatedAt: a refetch that returns equal prices keeps the same `data` reference.
  useEffect(() => {
    if (retried.current && plans.data && plans.data.variants.length > 0) {
      firstCard.current?.focus();
      retried.current = false;
    }
  }, [plans.dataUpdatedAt, plans.data]);

  const retry = () => {
    retried.current = true;
    void plans.refetch();
  };

  const register = (
    <Link to="/register" className={buttonClasses('primary')}>
      Register your organization
    </Link>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Rent TrekLink devices"
        id="plans-title"
        description="LoRa mesh trekking safety devices for tour operators, rented by the month or by the day."
        actions={
          user ? (
            <Link to={landingRoute(null, user)} className={buttonClasses('secondary')}>
              Open your workspace
            </Link>
          ) : (
            <Link to="/sign-in" className={buttonClasses('secondary')}>
              Sign in
            </Link>
          )
        }
        primaryAction={user ? undefined : register}
      />
      <Disclaimer />

      <section aria-labelledby="plans-prices" className="flex flex-col gap-4">
        <h2 id="plans-prices" className="text-title text-ink">
          Prices
        </h2>
        {plans.isPending && (
          <div role="status" aria-label="Loading plans" className="grid gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} rounded="panel" className="h-40" />
            ))}
          </div>
        )}
        {plans.isError && (
          <Alert
            tone="error"
            action={
              <Button variant="secondary" size="sm" onClick={retry}>
                Retry
              </Button>
            }
          >
            {plans.error instanceof ApiError && plans.error.message
              ? plans.error.message
              : 'The prices could not be loaded.'}
          </Alert>
        )}
        {plans.data && plans.data.variants.length === 0 && (
          <Card>
            <EmptyState
              title="No plans are available right now."
              description="Contact TrekLink to ask about renting."
              action={
                <a href="#contact" className={buttonClasses('secondary')}>
                  Contact TrekLink
                </a>
              }
            />
          </Card>
        )}
        {plans.data && plans.data.variants.length > 0 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plans.data.variants.map((variant, index) => (
                <Card as="article" key={variant.id} aria-labelledby={`plan-${variant.id}`}>
                  <h3
                    id={`plan-${variant.id}`}
                    ref={index === 0 ? firstCard : undefined}
                    tabIndex={-1}
                    className="text-title-sm text-ink outline-none"
                  >
                    {variant.name}
                  </h3>
                  <p className="mt-0.5 font-mono text-caption text-ink-muted">{variant.code}</p>
                  <dl className="mt-4 flex flex-col gap-3">
                    <div>
                      <dt className="text-body-sm text-ink-muted">Monthly plan</dt>
                      <dd className="text-body font-semibold text-ink">
                        {formatVnd(variant.monthlyPriceVnd)} / device / month
                        {plans.data.sandbox && <SandboxLabel />}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-body-sm text-ink-muted">Day plan</dt>
                      <dd className="text-body font-semibold text-ink">
                        {formatVnd(variant.dayPriceVnd)} / device / day
                        {plans.data.sandbox && <SandboxLabel />}
                      </dd>
                    </div>
                  </dl>
                </Card>
              ))}
            </div>
            <Terms plans={plans.data} />
            {!user && (
              <div className="flex sm:justify-start [&>a]:w-full sm:[&>a]:w-auto">{register}</div>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="plans-how">
        <Card>
          <h2 id="plans-how" className="mb-3 text-title-sm text-ink">
            How renting works
          </h2>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-body text-ink">
            {STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Card>
      </section>

      <Disclaimer />

      <footer id="contact" className="text-body text-ink-muted">
        Contact TrekLink:{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className={LINK}>
          {CONTACT_EMAIL}
        </a>
      </footer>
    </div>
  );
};
