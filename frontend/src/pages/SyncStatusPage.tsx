import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AUDIT_PAGE_SIZE,
  SYNC_OUTCOMES,
  SyncAuditRow,
  SyncOutcome,
  syncAuditKeys,
  SyncStation,
  type EventOrder,
  type FieldEventRow,
  useRecentEvents,
  useSyncAudit,
  useSyncStatus,
  WindowMinutes,
  WINDOW_OPTIONS,
} from '../entities/gateway-sync/api';
import { formatDateTime } from '../shared/lib/format';
import { Badge, ErrorState, Loading, PageTitle } from '../shared/ui/bits';
import { Button } from '../shared/ui/Button';
import { DataTable, Pagination, type Column, type SortState } from '../shared/ui/DataTable';
import { Field, Select } from '../shared/ui/Field';
import { StatCard } from '../shared/ui/StatCard';
import type { StatusTone } from '../shared/ui/status';
import { Toolbar } from '../shared/ui/Toolbar';

const CONNECTION_LABEL: Record<SyncStation['connection'], string> = {
  CONNECTED: 'Connected',
  STALE: 'Stale',
  NEVER_REPORTED: 'Never reported',
};

const CONNECTION_TONE: Record<SyncStation['connection'], 'active' | 'attention' | 'waiting'> = {
  CONNECTED: 'active',
  STALE: 'attention',
  NEVER_REPORTED: 'waiting',
};

const relative = (iso: string | null): string => (iso ? formatDateTime(iso) : 'Never');

// The audit outcomes in words, with a text badge tone (gateway-sync design §2, REQ-ERR-01 to ERR-06).
const OUTCOME_LABEL: Record<SyncOutcome, string> = {
  ACCEPTED: 'Accepted',
  ACCEPTED_UNATTRIBUTED: 'Accepted, unattributed',
  DUPLICATE_REJECTED: 'Duplicate rejected',
  MALFORMED_ENVELOPE: 'Malformed',
  NORMALIZATION_FAILED: 'Normalization failed',
  UNKNOWN_DEVICE: 'Unknown device',
  NOT_RENTED_TO_STATION_ORG: 'Not rented to the station organization',
  INVALID_POSITION: 'Invalid position',
  IMPLAUSIBLE_POSITION: 'Implausible position',
  QUEUE_REPORT: 'Queue report',
};

const OUTCOME_TONE: Record<SyncOutcome, StatusTone> = {
  ACCEPTED: 'done',
  ACCEPTED_UNATTRIBUTED: 'waiting',
  DUPLICATE_REJECTED: 'ended',
  MALFORMED_ENVELOPE: 'attention',
  NORMALIZATION_FAILED: 'attention',
  UNKNOWN_DEVICE: 'attention',
  NOT_RENTED_TO_STATION_ORG: 'attention',
  INVALID_POSITION: 'waiting',
  IMPLAUSIBLE_POSITION: 'waiting',
  QUEUE_REPORT: 'ended',
};

// The device of an audit row: its asset tag, else the Meshtastic node id of an unregistered node.
const deviceOf = (row: SyncAuditRow): string => {
  if (row.assetTag) return row.assetTag;
  if (row.nodeNum !== null) return `!${row.nodeNum.toString(16).padStart(8, '0')}`;
  return 'Not decoded';
};

const ingressOf = (ingress: SyncAuditRow['ingress']): string =>
  ingress === 'FIELD_STATION' ? 'Field Station' : 'Node uplink';

// The audit detail, and for a malformed message the start of its raw payload as the server cut it.
const DetailCell: React.FC<{ row: SyncAuditRow }> = ({ row }) => (
  <div className="flex min-w-0 flex-col gap-1">
    <span>{row.detail ?? 'No detail'}</span>
    {row.rawExcerpt !== null && (
      <code
        className="block max-w-md truncate rounded-control bg-sunken px-2 py-1 font-mono text-body-sm text-ink-muted"
        title={row.rawExcerpt}
      >
        {row.rawExcerpt}
      </code>
    )}
    {row.rawTruncated && (
      <span className="text-body-sm text-ink-muted">Raw payload cut by the server.</span>
    )}
  </div>
);

const AUDIT_COLUMNS: Column<SyncAuditRow>[] = [
  { key: 'createdAt', header: 'Time', cell: (row) => formatDateTime(row.createdAt), width: '11rem' },
  {
    key: 'outcome',
    header: 'Outcome',
    cell: (row) => <Badge tone={OUTCOME_TONE[row.outcome]}>{OUTCOME_LABEL[row.outcome]}</Badge>,
  },
  { key: 'device', header: 'Device', cell: deviceOf },
  { key: 'uplink', header: 'Uplink', cell: (row) => row.uplinkKey ?? 'None', hideOnMobile: true },
  { key: 'ingress', header: 'Ingress', cell: (row) => ingressOf(row.ingress), hideOnMobile: true },
  { key: 'detail', header: 'Detail', cell: (row) => <DetailCell row={row} /> },
];

const AuditCard: React.FC<{ row: SyncAuditRow }> = ({ row }) => (
  <div className="flex flex-col gap-1 text-body-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Badge tone={OUTCOME_TONE[row.outcome]}>{OUTCOME_LABEL[row.outcome]}</Badge>
      <span className="text-ink-muted">{formatDateTime(row.createdAt)}</span>
    </div>
    <span className="text-ink">
      {deviceOf(row)}, {ingressOf(row.ingress)}
    </span>
    <DetailCell row={row} />
  </div>
);

// The sync audit list (gateway-sync api-design 04): every ingestion attempt with its outcome, newest
// first, filtered by outcome and paged by the server.
const SyncAuditSection: React.FC = () => {
  const [outcome, setOutcome] = useState<SyncOutcome | ''>('');
  const [pageNumber, setPageNumber] = useState(1);
  const audit = useSyncAudit({ outcome: outcome || undefined, pageNumber });
  const page = audit.data;

  return (
    <section aria-labelledby="sync-audit-title" className="mt-6">
      <h2 id="sync-audit-title" className="mb-2 text-title-sm text-ink">
        Sync audit
      </h2>
      <Toolbar
        label="Sync audit filters"
        start={
          <Field id="sync-audit-outcome" label="Outcome" hideLabel className="w-full sm:w-72">
            <Select
              id="sync-audit-outcome"
              value={outcome}
              onChange={(event) => {
                setOutcome(event.target.value as SyncOutcome | '');
                setPageNumber(1);
              }}
            >
              <option value="">Every outcome</option>
              {SYNC_OUTCOMES.map((key) => (
                <option key={key} value={key}>
                  {OUTCOME_LABEL[key]}
                </option>
              ))}
            </Select>
          </Field>
        }
      />
      <DataTable
        caption="Sync audit records, newest first"
        columns={AUDIT_COLUMNS}
        rows={page?.items}
        rowId={(row) => row.id}
        loading={audit.isLoading}
        error={
          audit.error ? (
            <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
          ) : undefined
        }
        empty={{
          title: outcome ? 'No audit records with this outcome.' : 'No ingestion attempts yet.',
          description: outcome
            ? 'Choose Every outcome to see the whole audit.'
            : 'Each message the backend receives writes one record here.',
        }}
        renderCard={(row) => <AuditCard row={row} />}
        footer={
          page && page.totalPages > 1 ? (
            <Pagination
              pageNumber={page.pageNumber}
              totalPages={page.totalPages}
              totalItems={page.totalCount}
              pageSize={page.pageSize ?? AUDIT_PAGE_SIZE}
              onPage={setPageNumber}
            />
          ) : undefined
        }
      />
    </section>
  );
};

// /t/admin/sync, the MF-02 chain's screen (D-078 demo takeover): Field Station connection state,
// queue depth per priority, last flush, the window's ingestion outcomes, the recent field-event ledger
// and the sync audit, end to end from the gateway bridge to ingestion (gateway-sync api-design 07, 03
// and 04; screen 9.5). TrekLink Staff and Admin only.
export const SyncStatusPage: React.FC = () => {
  const [windowMinutes, setWindowMinutes] = useState<WindowMinutes>(60);
  const { data, isLoading, error, refetch, isFetching } = useSyncStatus(windowMinutes);
  // The ledger sorts on the time received only, the one order api-design 03 takes.
  const [eventSort, setEventSort] = useState<SortState<'receivedAt'>>({ key: 'receivedAt', direction: 'desc' });
  const [eventPage, setEventPage] = useState(1);
  const events = useRecentEvents(eventSort.direction satisfies EventOrder, eventPage);
  const queryClient = useQueryClient();

  const stationColumns: Column<SyncStation>[] = [
    { key: 'name', header: 'Station', cell: (station) => station.name },
    { key: 'organization', header: 'Organization', cell: (station) => station.organization.name },
    {
      key: 'connection',
      header: 'Connection',
      cell: (station) => <Badge tone={CONNECTION_TONE[station.connection]}>{CONNECTION_LABEL[station.connection]}</Badge>,
    },
    { key: 'lastSync', header: 'Last sync', cell: (station) => relative(station.lastSyncAt) },
    { key: 'lastFlush', header: 'Last flush', cell: (station) => relative(station.lastFlushAt), hideOnMobile: true },
    {
      key: 'queue',
      header: 'Queue depth (P0 to P3)',
      cell: (station) => `${station.queueDepth.p0}, ${station.queueDepth.p1}, ${station.queueDepth.p2}, ${station.queueDepth.p3}`,
    },
  ];

  const eventColumns: Column<FieldEventRow, 'receivedAt' | 'device' | 'kind' | 'ingress' | 'attribution'>[] = [
    { key: 'receivedAt', header: 'Received', sortable: true, cell: (event) => formatDateTime(event.receivedAt) },
    { key: 'device', header: 'Device', cell: (event) => event.assetTag ?? event.deviceId },
    { key: 'kind', header: 'Kind', cell: (event) => event.kind },
    { key: 'ingress', header: 'Ingress', cell: (event) => (event.ingress === 'FIELD_STATION' ? 'Field Station' : 'Node uplink') },
    { key: 'attribution', header: 'Attribution', cell: (event) => (event.attribution === 'ATTRIBUTED' ? 'Attributed' : 'Unattributed') },
  ];

  return (
    <section aria-labelledby="sync-status-title">
      <PageTitle
        id="sync-status-title"
        title="Field data sync"
        action={
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-body-sm text-ink-muted">
              Window
              <select
                className="h-9 rounded-control border border-line-strong bg-surface px-2 text-body-sm text-ink"
                value={windowMinutes}
                onChange={(event) => setWindowMinutes(Number(event.target.value) as WindowMinutes)}
              >
                {WINDOW_OPTIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    Last {minutes} minutes
                  </option>
                ))}
              </select>
            </label>
            <Button
              onClick={() => {
                void refetch();
                void events.refetch();
                void queryClient.invalidateQueries({ queryKey: syncAuditKeys.all });
              }}
              loading={isFetching && !isLoading}
            >
              Refresh
            </Button>
          </div>
        }
      />

      {isLoading && <Loading label="Loading sync status…" />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      {data && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="MQTT subscriber"
              value={data.broker.subscriber.toUpperCase()}
              tone={data.broker.subscriber === 'down' ? 'critical' : undefined}
            />
            <StatCard label="Accepted" value={data.ingestion.accepted} hint={`Last ${data.ingestion.windowMinutes} min`} />
            <StatCard label="Duplicates rejected" value={data.ingestion.duplicates} />
            <StatCard
              label="Malformed"
              value={data.ingestion.malformed}
              hint="Not decodable, audited raw"
              tone={data.ingestion.malformed > 0 ? 'attention' : undefined}
            />
            <StatCard
              label="Normalization failed"
              value={data.ingestion.normalizationFailed}
              tone={data.ingestion.normalizationFailed > 0 ? 'attention' : undefined}
            />
            <StatCard
              label="Unattributed"
              value={data.ingestion.acceptedUnattributed}
              hint="Stored with no organization, not in Accepted"
            />
            <StatCard
              label="Unknown device"
              value={data.ingestion.unknownDevice}
              tone={data.ingestion.unknownDevice > 0 ? 'attention' : undefined}
            />
          </div>

          <h2 className="mb-2 text-title-sm text-ink">Field Stations</h2>
          <DataTable<SyncStation>
            className="mb-6"
            caption="Field Stations"
            columns={stationColumns}
            rows={data.fieldStations}
            rowId={(station) => station.id}
            empty={{ title: 'No Field Stations are registered yet.' }}
          />
        </>
      )}

      <h2 className="mb-2 text-title-sm text-ink">Recent field events</h2>
      <DataTable<FieldEventRow, 'receivedAt' | 'device' | 'kind' | 'ingress' | 'attribution'>
        className="mb-6"
        caption="Recent field events"
        columns={eventColumns}
        rows={events.data?.items}
        rowId={(event) => event.eventId}
        loading={events.isLoading}
        error={events.error ? <ErrorState error={events.error} onRetry={() => void events.refetch()} /> : undefined}
        empty={{ title: 'No field events have been ingested yet.' }}
        sort={eventSort}
        onSortChange={(next) => {
          setEventSort({ key: 'receivedAt', direction: next.direction });
          setEventPage(1);
        }}
        footer={
          events.data && events.data.totalPages > 1 ? (
            <Pagination
              pageNumber={events.data.pageNumber}
              totalPages={events.data.totalPages}
              totalItems={events.data.totalCount}
              pageSize={events.data.pageSize}
              onPage={setEventPage}
            />
          ) : undefined
        }
      />

      <SyncAuditSection />
    </section>
  );
};
