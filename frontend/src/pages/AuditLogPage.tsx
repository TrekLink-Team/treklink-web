import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '../shared/ui/cn';
import {
  AUDIT_PAGE_SIZE,
  useAuditLogs,
  type AuditFilters,
  type AuditLogItem,
} from '../entities/audit/api';
import {
  filterErrors,
  filtersOf,
  fromLocalInput,
  hasFilters,
  pageOf,
  paramsOf,
  snapshotText,
  toLocalInput,
} from '../entities/audit/model';
import { useOrganizations, type OrganizationReview } from '../entities/organization/api';
import { AccountPicker } from '../features/account-picker/AccountPicker';
import { ApiError } from '../shared/api/apiClient';
import {
  Alert,
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

const actorNameIn = (items: AuditLogItem[] | undefined, actorId: string): string | undefined =>
  items?.find((row) => row.actor?.id === actorId)?.actor?.fullName;

const withSeconds = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

// The before and after of one entry, side by side on a wide screen.
const Snapshots: React.FC<{ row: AuditLogItem; className?: string }> = ({ row, className }) => (
  <div className={`grid gap-2 lg:grid-cols-2 ${className ?? ''}`}>
    {(['Before', 'After'] as const).map((label) => (
      <figure key={label} className="m-0">
        <figcaption className="text-body-sm font-semibold text-ink">{label}</figcaption>
        <pre className="max-h-64 overflow-auto rounded-control bg-sunken p-2 font-mono text-body-sm">
          {snapshotText(label === 'Before' ? row.before : row.after)}
        </pre>
      </figure>
    ))}
  </div>
);

// The seven filters in two rows, applied with one button. The parent keys it by the URL query, so a
// filter set from a link or a click on an actor name starts the bar again from the URL.
// The actor is picked by name from the TrekLink accounts (AccountPicker, auth api-design 09); an
// organization member is set by a click on its name in a row, and the picker then shows that name.
const FilterBar: React.FC<{
  applied: AuditFilters;
  actorLabel?: string;
  organizations: OrganizationReview[];
  /** The errors of filters taken from the address, shown at once under their fields. */
  initialErrors: { actorId?: string; to?: string };
  onApply: (filters: AuditFilters) => void;
  onClear: () => void;
}> = ({ applied, actorLabel, organizations, initialErrors, onApply, onClear }) => {
  const [actorId, setActorId] = useState(applied.actorId ?? '');
  const [organizationId, setOrganizationId] = useState(applied.organizationId ?? '');
  const [subjectType, setSubjectType] = useState(applied.subjectType ?? '');
  const [subjectId, setSubjectId] = useState(applied.subjectId ?? '');
  const [action, setAction] = useState(applied.action ?? '');
  const [from, setFrom] = useState(toLocalInput(applied.from));
  const [to, setTo] = useState(toLocalInput(applied.to));
  const [errors, setErrors] = useState<{ actorId?: string; to?: string }>(initialErrors);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const next: AuditFilters = {
      actorId: actorId.trim() || undefined,
      organizationId: organizationId || undefined,
      subjectType: subjectType.trim() || undefined,
      subjectId: subjectId.trim() || undefined,
      action: action.trim() || undefined,
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
      aria-label="Audit log filters"
      className="flex flex-col gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          id="audit-actor"
          label="Actor"
          hint="A TrekLink account by name or email; click a name below for anyone else."
          error={errors.actorId}
        >
          <AccountPicker
            id="audit-actor"
            value={actorId}
            label={actorLabel}
            onChange={setActorId}
            invalid={Boolean(errors.actorId)}
            aria-describedby={errors.actorId ? 'audit-actor-error' : 'audit-actor-hint'}
          />
        </Field>
        <Field id="audit-organization" label="Organization">
          <Select
            id="audit-organization"
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
        <Field id="audit-subject-type" label="Subject type">
          <Input
            id="audit-subject-type"
            value={subjectType}
            onChange={(event) => setSubjectType(event.target.value)}
            placeholder="RentalContract"
          />
        </Field>
        <Field id="audit-subject-id" label="Subject id">
          <Input
            id="audit-subject-id"
            value={subjectId}
            onChange={(event) => setSubjectId(event.target.value)}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="audit-action" label="Action starts with">
          <Input
            id="audit-action"
            value={action}
            onChange={(event) => setAction(event.target.value)}
            placeholder="contract."
          />
        </Field>
        <Field id="audit-from" label="From">
          <Input
            id="audit-from"
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </Field>
        <Field id="audit-to" label="To" error={errors.to}>
          <Input
            id="audit-to"
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            {...invalid('audit-to', errors.to)}
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

// `/t/admin/audit/changes`, screen 7.4 (platform api-design 05, UC-58, FR-AUTH-08): the generic audit
// log, newest first, with seven filters kept in the URL and a before and after for each entry. TrekLink
// Admin only. The server has already replaced secrets in the snapshots.
export const AuditLogPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersOf(params), [params]);
  const pageNumber = pageOf(params);
  // Filters from the address that fail the form's check (a hand-edited actor id) are not sent: the
  // field says what to fix instead of a banner naming the query parameter (W21).
  const addressErrors = useMemo(() => filterErrors(filters), [filters]);
  const addressValid = Object.keys(addressErrors).length === 0;
  const logs = useAuditLogs(filters, pageNumber, addressValid);
  // Below 1280 by 800 CSS px the filters sit behind a Filters button, so the entries keep their room
  // in the fit page (screen 7.4, ui standard §7); they open by themselves when a filter needs fixing.
  const [filtersOpen, setFiltersOpen] = useState(!addressValid);
  const organizations = useOrganizations(undefined);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const organizationList = useMemo(
    () =>
      [...(organizations.data?.items ?? [])].sort((a, b) => a.legalName.localeCompare(b.legalName)),
    [organizations.data],
  );
  const nameOf = (id: string | null): string =>
    id === null
      ? '–'
      : (organizationList.find((organization) => organization.id === id)?.legalName ?? id);

  // The name of the actor filter, from a loaded row; the picker looks a TrekLink account up itself.
  const actorLabel = filters.actorId
    ? actorNameIn(logs.data?.items, filters.actorId)
    : undefined;

  const apply = (next: AuditFilters) => setParams(paramsOf(next));
  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };
  const goToPage = (page: number) => {
    const next = new URLSearchParams(params);
    if (page > 1) next.set('page', String(page));
    else next.delete('page');
    setParams(next);
  };

  const fields: CollectionField<AuditLogItem>[] = [
    { key: 'time', label: 'Time', render: (row) => withSeconds(row.createdAt), compact: true },
    {
      key: 'actor',
      label: 'Actor',
      render: (row) =>
        row.actor ? (
          <div className="py-1.5">
            <button
              type="button"
              className={`${LINK} inline-flex min-h-6 items-center`}
              aria-label={`Filter by actor ${row.actor.fullName}`}
              onClick={() => apply({ ...filters, actorId: row.actor?.id })}
            >
              {row.actor.fullName}
            </button>
            <span className="block text-body-sm text-ink-muted">{row.actorRoles.join(', ')}</span>
          </div>
        ) : (
          <span>SYSTEM</span>
        ),
    },
    {
      key: 'organization',
      label: 'Organization',
      render: (row) => nameOf(row.organizationId),
      hideWithPane: true,
    },
    {
      key: 'subject',
      label: 'Subject',
      render: (row) => (
        <div className="py-1.5">
          <span>{row.subjectType}</span>
          {row.subjectId && (
            <span className="block break-all font-mono text-body-sm text-ink-muted">
              {row.subjectId}
            </span>
          )}
        </div>
      ),
      hideWithPane: true,
    },
    {
      key: 'details',
      label: 'Before and after',
      // The details pane shows the before and after itself.
      hideWithPane: true,
      render: (row) => {
        const expanded = open.has(row.id);
        return (
          <div className="py-1.5">
            <button
              type="button"
              className={`${LINK} inline-flex min-h-6 items-center`}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Hide' : 'Show'} before and after of ${row.action} at ${withSeconds(row.createdAt)}`}
              onClick={() => toggle(row.id)}
            >
              {expanded ? 'Hide' : 'Show'}
            </button>
            {expanded && <Snapshots row={row} className="mt-2" />}
          </div>
        );
      },
    },
    {
      key: 'request',
      label: 'Request id',
      render: (row) => <span className="font-mono text-body-sm">{row.requestId ?? '–'}</span>,
      hideWithPane: true,
    },
  ];

  const failure = logs.error;
  if (failure instanceof ApiError && (failure.statusCode === 403 || failure.statusCode === 404)) {
    return (
      <div role="alert" className="flex justify-center py-16">
        <p className="text-lg font-semibold text-ink">{messageOf(failure)}</p>
      </div>
    );
  }

  const data = logs.data;
  return (
    <AuditTabs>
      <section aria-labelledby="audit-title" data-fit-page="" className="flex min-h-0 flex-1 flex-col gap-4">
        <PageHeader
          id="audit-title"
          title="Audit log"
          description="Who changed what, newest first. Secrets are replaced before they are stored."
        />
        <Card aria-labelledby="audit-filters" className="p-2 roomy:p-5">
          <div className="hidden roomy:block">
            <CardHeader title="Filters" id="audit-filters" />
          </div>
          <Button
            variant="secondary"
            className="w-full roomy:hidden"
            aria-expanded={filtersOpen || !addressValid}
            aria-controls="audit-filter-bar"
            onClick={() => setFiltersOpen((now) => !now)}
          >
            {hasFilters(filters) ? 'Filters (on)' : 'Filters'}
          </Button>
          <div
            id="audit-filter-bar"
            // Open on a short screen, the filters scroll inside themselves so the list keeps its room.
            className={cn(
              filtersOpen || !addressValid ? 'mt-2 block roomy:mt-0' : 'hidden roomy:block',
              '-mx-1 max-h-[45dvh] overflow-y-auto overscroll-contain px-1 roomy:mx-0 roomy:max-h-none roomy:overflow-visible roomy:px-0',
            )}
          >
            <FilterBar
              key={params.toString()}
              applied={filters}
              actorLabel={actorLabel}
              organizations={organizationList}
              initialErrors={addressErrors}
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
                <Button variant="secondary" size="sm" onClick={() => void logs.refetch()}>
                  Retry
                </Button>
              )
            }
          >
            {messageOf(failure)}
          </Alert>
        )}

        {/* The filter form above queries the server; the list renders on CollectionView (chapter 06
            §9, D-096), with the before and after in the details pane as well as in its column. */}
        <CollectionView<AuditLogItem>
          label="Audit log"
          items={addressValid ? data?.items : []}
          loading={addressValid && logs.isPending}
          itemId={(row) => row.id}
          itemName={(row) => `${row.action} at ${withSeconds(row.createdAt)}`}
          itemTitle={(row) => <span className="font-mono font-semibold text-ink">{row.action}</span>}
          fields={fields}
          noun={{ one: 'entry', other: 'entries' }}
          views={['details', 'list']}
          pageInfo={pageInfoOf(data ? { ...data, pageSize: AUDIT_PAGE_SIZE } : undefined)}
          details={{ fields: ['time', 'actor', 'organization', 'subject', 'request'], extra: (row) => <Snapshots row={row} /> }}
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
                pageSize={AUDIT_PAGE_SIZE}
                onPage={goToPage}
              />
            ) : undefined
          }
        />
      </section>
    </AuditTabs>
  );
};
