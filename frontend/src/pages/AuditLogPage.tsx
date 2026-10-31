import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { ApiError } from '../shared/api/apiClient';
import {
  Alert,
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
const FilterBar: React.FC<{
  applied: AuditFilters;
  organizations: OrganizationReview[];
  onApply: (filters: AuditFilters) => void;
  onClear: () => void;
}> = ({ applied, organizations, onApply, onClear }) => {
  const [actorId, setActorId] = useState(applied.actorId ?? '');
  const [organizationId, setOrganizationId] = useState(applied.organizationId ?? '');
  const [subjectType, setSubjectType] = useState(applied.subjectType ?? '');
  const [subjectId, setSubjectId] = useState(applied.subjectId ?? '');
  const [action, setAction] = useState(applied.action ?? '');
  const [from, setFrom] = useState(toLocalInput(applied.from));
  const [to, setTo] = useState(toLocalInput(applied.to));
  const [errors, setErrors] = useState<{ actorId?: string; to?: string }>({});

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
        <Field id="audit-actor" label="Actor id" error={errors.actorId}>
          <Input
            id="audit-actor"
            value={actorId}
            onChange={(event) => setActorId(event.target.value)}
            placeholder="UUID of the account"
            {...invalid('audit-actor', errors.actorId)}
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
  const logs = useAuditLogs(filters, pageNumber);
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

  const columns: Column<AuditLogItem>[] = [
    { key: 'time', header: 'Time', cell: (row) => withSeconds(row.createdAt) },
    {
      key: 'actor',
      header: 'Actor',
      cell: (row) =>
        row.actor ? (
          <div className="py-1.5">
            <button
              type="button"
              className={LINK}
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
      header: 'Organization',
      cell: (row) => nameOf(row.organizationId),
      hideOnMobile: true,
    },
    {
      key: 'action',
      header: 'Action',
      cell: (row) => <span className="font-mono">{row.action}</span>,
    },
    {
      key: 'subject',
      header: 'Subject',
      cell: (row) => (
        <div className="py-1.5">
          <span>{row.subjectType}</span>
          {row.subjectId && (
            <span className="block break-all font-mono text-body-sm text-ink-muted">
              {row.subjectId}
            </span>
          )}
        </div>
      ),
      hideOnMobile: true,
    },
    {
      key: 'details',
      header: 'Before and after',
      cell: (row) => {
        const expanded = open.has(row.id);
        return (
          <div className="py-1.5">
            <button
              type="button"
              className={LINK}
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
      header: 'Request id',
      cell: (row) => <span className="font-mono text-body-sm">{row.requestId ?? '–'}</span>,
      hideOnMobile: true,
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
      <section aria-labelledby="audit-title" className="flex flex-col gap-4">
        <PageHeader
          id="audit-title"
          title="Audit log"
          description="Who changed what, newest first. Secrets are replaced before they are stored."
        />
        <Card aria-labelledby="audit-filters">
          <CardHeader title="Filters" id="audit-filters" />
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
                <Button variant="secondary" size="sm" onClick={() => void logs.refetch()}>
                  Retry
                </Button>
              )
            }
          >
            {messageOf(failure)}
          </Alert>
        )}

        <DataTable
          caption="Audit log"
          columns={columns}
          rows={data?.items}
          rowId={(row) => row.id}
          loading={logs.isPending}
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
                <span className="font-mono">{row.action}</span>
                <span className="text-body-sm text-ink-muted">{withSeconds(row.createdAt)}</span>
              </div>
              <span className="text-body-sm text-ink-muted">
                {row.actor?.fullName ?? 'SYSTEM'}, {row.subjectType}
                {row.subjectId ? ` ${row.subjectId}` : ''}
              </span>
              <details>
                <summary className={`${LINK} cursor-pointer`}>Details</summary>
                <Snapshots row={row} className="mt-2" />
              </details>
            </div>
          )}
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
