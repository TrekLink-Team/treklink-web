import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '../shared/ui/cn';
import { fromLocalInput, toLocalInput } from '../entities/audit/model';
import {
  AUTH_EVENT_PAGE_SIZE,
  AUTH_EVENT_TYPES,
  useAuthEvents,
  type AuthEventFilters,
  type AuthEventItem,
} from '../entities/auth-event/api';
import {
  SECURITY_SIGNALS,
  filterErrors,
  filtersOf,
  hasFilters,
  isEventType,
  paramsOf,
} from '../entities/auth-event/model';
import { useOrganizations, type OrganizationReview } from '../entities/organization/api';
import { AccountPicker } from '../features/account-picker/AccountPicker';
import { ApiError } from '../shared/api/apiClient';
import { formatUtc } from '../shared/lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CollectionView,
  Field,
  Input,
  PageHeader,
  Pagination,
  pageInfoOf,
  Select,
  type CollectionField,
} from '../shared/ui';
import { invalid, messageOf } from '../shared/ui/errors';
import { LINK } from '../shared/ui/styles';
import { AuditTabs } from '../widgets/AuditTabs/AuditTabs';

const withSeconds = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

const pageOf = (params: URLSearchParams): number => {
  const page = Number(params.get('page'));
  return Number.isInteger(page) && page >= 1 ? page : 1;
};

// A security signal is critical-toned; every badge carries its text (convention 06 §8 item 3).
const EventBadge: React.FC<{ type: AuthEventItem['type'] }> = ({ type }) => (
  <Badge tone={SECURITY_SIGNALS.has(type) ? 'critical' : undefined} className="font-mono">
    {type}
  </Badge>
);

// The four filters applied with one button. The parent keys it by the URL query, so a filter set from a
// link or a click on a row starts the bar again from the URL.
const FilterBar: React.FC<{
  applied: AuthEventFilters;
  accountLabel?: string;
  organizations: OrganizationReview[];
  onApply: (filters: AuthEventFilters) => void;
  onClear: () => void;
}> = ({ applied, accountLabel, organizations, onApply, onClear }) => {
  const [userId, setUserId] = useState(applied.userId ?? '');
  const [organizationId, setOrganizationId] = useState(applied.organizationId ?? '');
  const [type, setType] = useState<string>(applied.type ?? '');
  const [from, setFrom] = useState(toLocalInput(applied.from));
  const [to, setTo] = useState(toLocalInput(applied.to));
  const [errors, setErrors] = useState<{ userId?: string; to?: string }>({});

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const next: AuthEventFilters = {
      userId: userId || undefined,
      organizationId: organizationId || undefined,
      type: isEventType(type) ? type : undefined,
      from: fromLocalInput(from),
      to: fromLocalInput(to),
    };
    const found = filterErrors(next);
    setErrors(found);
    if (Object.keys(found).length === 0) onApply(next);
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      aria-label="Sign-in event filters"
      className="flex flex-col gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id="auth-account" label="Account" error={errors.userId}>
          <AccountPicker
            id="auth-account"
            value={userId}
            label={accountLabel}
            onChange={setUserId}
            invalid={Boolean(errors.userId)}
            {...invalid('auth-account', errors.userId)}
          />
        </Field>
        <Field id="auth-organization" label="Organization">
          <Select
            id="auth-organization"
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
          >
            <option value="">All organizations</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.legalName}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="auth-type" label="Event type">
          <Select id="auth-type" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">All event types</option>
            {AUTH_EVENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id="auth-from" label="From">
          <Input
            id="auth-from"
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </Field>
        <Field id="auth-to" label="To" error={errors.to}>
          <Input
            id="auth-to"
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            {...invalid('auth-to', errors.to)}
          />
        </Field>
        <div className="flex items-end gap-2">
          <Button type="submit" variant="primary">
            Apply
          </Button>
          <Button type="button" variant="ghost" onClick={onClear}>
            Clear filters
          </Button>
        </div>
      </div>
    </form>
  );
};

// `/t/admin/audit/sign-ins`, screen 7.3 (auth api-design 17, UC-58, FR-AUTH-08): the append-only
// authentication log, newest first, with five filters kept in the URL. Read-only, so there is no primary
// action. TrekLink Admin only.
export const AuthEventsPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersOf(params), [params]);
  const pageNumber = pageOf(params);
  const events = useAuthEvents(filters, pageNumber);
  const organizations = useOrganizations(undefined);
  // Below 1280 by 900 CSS px the filters sit behind a disclosure (screen 7.3), so the list keeps its
  // room in the fit page (ui standard §7).
  const [filtersOpen, setFiltersOpen] = useState(false);
  // After Apply, focus moves to the result count, which a polite live region announces.
  const countRef = useRef<HTMLParagraphElement>(null);
  const [applied, setApplied] = useState(0);
  useEffect(() => {
    if (applied > 0) countRef.current?.focus();
  }, [applied]);

  const organizationList = useMemo(
    () =>
      [...(organizations.data?.items ?? [])].sort((a, b) => a.legalName.localeCompare(b.legalName)),
    [organizations.data],
  );

  const apply = (next: AuthEventFilters) => {
    setParams(paramsOf(next));
    setApplied((now) => now + 1);
  };
  // An account chosen from a link is named by the email of one of its rows when the page has one.
  const accountLabel = filters.userId
    ? (events.data?.items.find((row) => row.userId === filters.userId)?.email ?? undefined)
    : undefined;
  const goToPage = (page: number) => {
    const next = new URLSearchParams(params);
    if (page > 1) next.set('page', String(page));
    else next.delete('page');
    setParams(next);
  };

  const fields: CollectionField<AuthEventItem>[] = [
    { key: 'type', label: 'Event', render: (row) => <EventBadge type={row.type} />, compact: true },
    { key: 'email', label: 'Email', render: (row) => row.email ?? '–', compact: true },
    {
      key: 'organization',
      label: 'Organization',
      render: (row) => row.organization?.name ?? 'None',
      hideWithPane: true,
    },
    {
      key: 'account',
      label: 'Account',
      render: (row) =>
        row.userId ? (
          <button
            type="button"
            className={`${LINK} inline-flex min-h-6 items-center`}
            aria-label={`Filter by this account: ${row.email ?? row.userId}`}
            onClick={() => apply({ ...filters, userId: row.userId ?? undefined })}
          >
            Filter by this account
          </button>
        ) : (
          <span>–</span>
        ),
      hideWithPane: true,
    },
    {
      key: 'ip',
      label: 'IP address',
      render: (row) => <span className="font-mono">{row.ip ?? '–'}</span>,
      hideWithPane: true,
    },
  ];

  const failure = events.error;
  if (failure instanceof ApiError && (failure.statusCode === 403 || failure.statusCode === 404)) {
    return (
      <div role="alert" className="flex justify-center py-16">
        <p className="text-lg font-semibold text-ink">{messageOf(failure)}</p>
      </div>
    );
  }

  const data = events.data;
  return (
    <AuditTabs>
      <section aria-labelledby="auth-events-title" data-fit-page="" className="flex min-h-0 flex-1 flex-col gap-4 [@media(min-height:480px)_and_(max-height:640px)]:gap-2">
        <PageHeader
          id="auth-events-title"
          title="Sign-in events"
          description="Every sign-in, refresh, reset and lock, newest first. No password is ever stored here."
        />
        {/* The count row leads: on a short screen it also holds the Filters toggle, so the folded
            filters take no band of their own and the list keeps a full row (review of #397). */}
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0 roomy:hidden"
            aria-expanded={filtersOpen}
            aria-controls="auth-events-filter-bar"
            onClick={() => setFiltersOpen((now) => !now)}
          >
            {hasFilters(filters) ? 'Filters (on)' : 'Filters'}
          </Button>
          <p
            ref={countRef}
            tabIndex={-1}
            aria-live="polite"
            className="min-w-0 flex-1 text-body-sm text-ink-muted outline-none focus-visible:outline-2 focus-visible:outline-focus"
          >
            {data ? `${data.totalCount} ${data.totalCount === 1 ? 'event' : 'events'}` : ''}
          </p>
          <Button
            variant="ghost"
            size="sm"
            loading={events.isFetching}
            onClick={() => void events.refetch()}
          >
            Refresh
          </Button>
        </div>

        <Card
          aria-labelledby="auth-events-filters"
          className={cn('p-2 roomy:p-5', !filtersOpen && 'hidden roomy:block')}
        >
          <div className="hidden roomy:block">
            <CardHeader title="Filters" id="auth-events-filters" />
          </div>
          <div
            id="auth-events-filter-bar"
            // Open on a short screen, the filters scroll inside themselves so the list keeps its room.
            className={cn(
              filtersOpen ? 'block' : 'hidden roomy:block',
              '-mx-1 max-h-[45dvh] overflow-y-auto overscroll-contain px-1 roomy:mx-0 roomy:max-h-none roomy:overflow-visible roomy:px-0',
            )}
          >
            <FilterBar
              key={params.toString()}
              applied={filters}
              accountLabel={accountLabel}
              organizations={organizationList}
              onApply={apply}
              onClear={() => setParams(new URLSearchParams())}
            />
          </div>
        </Card>

        {failure && (
          <Alert
            tone="error"
            action={
              failure instanceof ApiError && failure.statusCode === 400 ? undefined : (
                <Button variant="secondary" size="sm" onClick={() => void events.refetch()}>
                  Retry
                </Button>
              )
            }
          >
            {messageOf(failure)}
          </Alert>
        )}


        {/* The filter form above queries the server; the events render on CollectionView (chapter 06
            §9, D-096), each titled by its time, with the UTC time on hover. */}
        <CollectionView<AuthEventItem>
          label="Sign-in events"
          items={data?.items}
          loading={events.isPending}
          itemId={(row) => row.id}
          itemName={(row) => `${row.type} at ${withSeconds(row.createdAt)}`}
          itemTitle={(row) => (
            <span title={formatUtc(row.createdAt)} className="whitespace-nowrap font-normal text-ink">
              {withSeconds(row.createdAt)}
            </span>
          )}
          fields={fields}
          noun={{ one: 'event', other: 'events' }}
          views={['details', 'list']}
          pageInfo={pageInfoOf(data ? { ...data, pageSize: AUTH_EVENT_PAGE_SIZE } : undefined)}
          emptyState={{
            title: 'No results match your filters.',
            action: hasFilters(filters) ? (
              <Button variant="secondary" onClick={() => setParams(new URLSearchParams())}>
                Clear filters
              </Button>
            ) : undefined,
          }}
          footer={
            data && data.totalPages > 1 ? (
              <Pagination
                pageNumber={data.pageNumber}
                totalPages={data.totalPages}
                totalItems={data.totalCount}
                pageSize={AUTH_EVENT_PAGE_SIZE}
                onPage={goToPage}
              />
            ) : undefined
          }
        />
      </section>
    </AuditTabs>
  );
};
