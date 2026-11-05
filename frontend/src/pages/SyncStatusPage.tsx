import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageScrollBody } from '../shared/ui/PageChrome';
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
import { Pagination } from '../shared/ui/DataTable';
import { CollectionView, pageInfoOf, type CollectionField } from '../shared/ui/collection-view';
import { StatCard } from '../shared/ui/StatCard';
import type { StatusTone } from '../shared/ui/status';

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

const AUDIT_FIELDS: CollectionField<SyncAuditRow>[] = [
  {
    key: 'outcome',
    label: 'Outcome',
    render: (row) => <Badge tone={OUTCOME_TONE[row.outcome]}>{OUTCOME_LABEL[row.outcome]}</Badge>,
    compact: true,
  },
  { key: 'device', label: 'Device', render: deviceOf, compact: true },
  { key: 'uplink', label: 'Uplink', render: (row) => row.uplinkKey ?? 'None', hideWithPane: true },
  { key: 'ingress', label: 'Ingress', render: (row) => ingressOf(row.ingress), hideWithPane: true },
  { key: 'detail', label: 'Detail', render: (row) => <DetailCell row={row} /> },
];

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
      <CollectionView<SyncAuditRow>
        label="Sync audit records, newest first"
        items={page?.items}
        loading={audit.isLoading}
        error={audit.error ? <ErrorState error={audit.error} onRetry={() => void audit.refetch()} /> : undefined}
        itemId={(row) => row.id}
        itemName={(row) => `${OUTCOME_LABEL[row.outcome]} at ${formatDateTime(row.createdAt)}`}
        itemTitle={(row) => <span className="whitespace-nowrap font-normal text-ink">{formatDateTime(row.createdAt)}</span>}
        fields={AUDIT_FIELDS}
        noun={{ one: 'record', other: 'records' }}
        filters={[
          { key: '', label: 'Every outcome' },
          ...SYNC_OUTCOMES.map((key) => ({ key, label: OUTCOME_LABEL[key] })),
        ]}
        query={{ search: '', filter: outcome, sort: null }}
        onQueryChange={(next) => {
          setOutcome(next.filter as SyncOutcome | '');
          setPageNumber(1);
        }}
        pageInfo={pageInfoOf(page ? { ...page, pageSize: page.pageSize ?? AUDIT_PAGE_SIZE } : undefined)}
        emptyState={{
          title: 'No ingestion attempts yet.',
          description: 'Each message the backend receives writes one record here.',
        }}
        noMatch={{
          title: 'No audit records with this outcome.',
          description: 'Choose Every outcome to see the whole audit.',
        }}
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
  const [eventOrder, setEventOrder] = useState<EventOrder>('desc');
  const [eventPage, setEventPage] = useState(1);
  const events = useRecentEvents(eventOrder, eventPage);
  const queryClient = useQueryClient();

  const stationFields: CollectionField<SyncStation>[] = [
    { key: 'organization', label: 'Organization', render: (station) => station.organization.name, compact: true },
    {
      key: 'connection',
      label: 'Connection',
      render: (station) => <Badge tone={CONNECTION_TONE[station.connection]}>{CONNECTION_LABEL[station.connection]}</Badge>,
      compact: true,
    },
    { key: 'lastSync', label: 'Last sync', render: (station) => relative(station.lastSyncAt), compact: true },
    { key: 'lastFlush', label: 'Last flush', render: (station) => relative(station.lastFlushAt), hideWithPane: true },
    {
      key: 'queue',
      label: 'Queue depth (P0 to P3)',
      render: (station) => `${station.queueDepth.p0}, ${station.queueDepth.p1}, ${station.queueDepth.p2}, ${station.queueDepth.p3}`,
    },
  ];

  // The ledger sorts on the time received only, on the server (gateway-sync api-design 03).
  const eventFields: CollectionField<FieldEventRow>[] = [
    { key: 'receivedAt', label: 'Received', sortable: true, render: (event) => formatDateTime(event.receivedAt), compact: true },
    { key: 'kind', label: 'Kind', render: (event) => event.kind, compact: true },
    { key: 'ingress', label: 'Ingress', render: (event) => (event.ingress === 'FIELD_STATION' ? 'Field Station' : 'Node uplink'), hideWithPane: true },
    { key: 'attribution', label: 'Attribution', render: (event) => (event.attribution === 'ATTRIBUTED' ? 'Attributed' : 'Unattributed') },
  ];

  return (
    <section aria-labelledby="sync-status-title" data-fit-page="" className="flex min-h-0 flex-1 flex-col">
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

      <PageScrollBody label="Sync status">
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
            <CollectionView<SyncStation>
              className="mb-6"
              label="Field Stations"
              items={data.fieldStations}
              itemId={(station) => station.id}
              itemName={(station) => station.name}
              fields={stationFields}
              noun={{ one: 'station', other: 'stations' }}
              emptyState={{ title: 'No Field Stations are registered yet.' }}
            />
          </>
        )}

        <h2 className="mb-2 text-title-sm text-ink">Recent field events</h2>
        <CollectionView<FieldEventRow>
          className="mb-6"
          label="Recent field events"
          items={events.data?.items}
          loading={events.isLoading}
          error={events.error ? <ErrorState error={events.error} onRetry={() => void events.refetch()} /> : undefined}
          itemId={(event) => event.eventId}
          itemName={(event) => `${event.kind} of ${event.assetTag ?? event.deviceId}`}
          itemTitle={(event) => <span className="font-normal text-ink">{event.assetTag ?? event.deviceId}</span>}
          fields={eventFields}
          noun={{ one: 'event', other: 'events' }}
          query={{ search: '', filter: '', sort: { key: 'receivedAt', direction: eventOrder } }}
          defaultSort={{ key: 'receivedAt', direction: 'desc' }}
          onQueryChange={(next) => {
            setEventOrder(next.sort?.direction ?? 'desc');
            setEventPage(1);
          }}
          pageInfo={pageInfoOf(events.data)}
          emptyState={{ title: 'No field events have been ingested yet.' }}
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
      </PageScrollBody>
    </section>
  );
};
