import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  Field,
  Input,
  PageHeader,
  Pagination,
  Select,
  type Column,
} from '../shared/ui';
import { invalid, messageOf } from '../shared/ui/errors';
import { LINK } from '../shared/ui/styles';
import { AuditTabs } from './AuditTabs';

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
  organizations: OrganizationReview[];
  onApply: (filters: AuthEventFilters) => void;
  onClear: () => void;
}> = ({ applied, organizations, onApply, onClear }) => {
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

  const organizationList = useMemo(
    () =>
      [...(organizations.data?.items ?? [])].sort((a, b) => a.legalName.localeCompare(b.legalName)),
    [organizations.data],
  );

  const apply = (next: AuthEventFilters) => setParams(paramsOf(next));
  const goToPage = (page: number) => {
    const next = new URLSearchParams(params);
    if (page > 1) next.set('page', String(page));
    else next.delete('page');
    setParams(next);
  };

  const columns: Column<AuthEventItem>[] = [
    {
      key: 'time',
      header: 'Time',
      cell: (row) => <span title={`${row.createdAt} UTC`}>{withSeconds(row.createdAt)}</span>,
    },
    { key: 'type', header: 'Event', cell: (row) => <EventBadge type={row.type} /> },
    { key: 'email', header: 'Email', cell: (row) => row.email ?? '–' },
    {
      key: 'organization',
      header: 'Organization',
      cell: (row) => row.organization?.name ?? 'None',
      hideOnMobile: true,
    },
    {
      key: 'account',
      header: 'Account',
      cell: (row) =>
        row.userId ? (
          <button
            type="button"
            className={LINK}
            aria-label={`Filter by the account of ${row.email ?? row.userId}`}
            onClick={() => apply({ ...filters, userId: row.userId ?? undefined })}
          >
            Filter by this account
          </button>
        ) : (
          <span>–</span>
        ),
      hideOnMobile: true,
    },
    {
      key: 'ip',
      header: 'IP address',
      cell: (row) => <span className="font-mono">{row.ip ?? '–'}</span>,
      hideOnMobile: true,
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
    <AuditTabs current="sign-ins">
      <section aria-labelledby="auth-events-title" className="flex flex-col gap-4">
        <PageHeader
          id="auth-events-title"
          title="Sign-in events"
          description="Every sign-in, refresh, reset and lock, newest first. No password is ever stored here."
        />
        <Card aria-labelledby="auth-events-filters">
          <CardHeader title="Filters" id="auth-events-filters" />
          <FilterBar
            key={params.toString()}
            applied={filters}
            organizations={organizationList}
            onApply={apply}
            onClear={() => setParams(new URLSearchParams())}
          />
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

        <p aria-live="polite" className="text-body-sm text-ink-muted">
          {data ? `${data.totalCount} events` : ''}
        </p>

        <DataTable
          caption="Sign-in events"
          columns={columns}
          rows={data?.items}
          rowId={(row) => row.id}
          loading={events.isPending}
          empty={{
            title: 'No results match your filters.',
            action: hasFilters(filters) ? (
              <Button variant="secondary" onClick={() => setParams(new URLSearchParams())}>
                Clear filters
              </Button>
            ) : undefined,
          }}
          renderCard={(row) => (
            <div className="flex flex-col gap-1 text-body">
              <div className="flex items-center justify-between gap-2">
                <EventBadge type={row.type} />
                <span className="text-body-sm text-ink-muted">{withSeconds(row.createdAt)}</span>
              </div>
              <span className="text-body-sm text-ink-muted">
                {row.email ?? '–'}, {row.ip ?? '–'}
              </span>
            </div>
          )}
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
