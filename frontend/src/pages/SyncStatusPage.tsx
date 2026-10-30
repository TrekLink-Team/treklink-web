import React, { useState } from 'react';
import {
  SyncStation,
  useRecentEvents,
  useSyncStatus,
  WindowMinutes,
  WINDOW_OPTIONS,
} from '../entities/gateway-sync/api';
import { formatDateTime } from '../shared/lib/format';
import { Badge, Empty, ErrorState, Loading, PageTitle } from '../shared/ui/bits';
import { Button } from '../shared/ui/Button';
import { StatCard } from '../shared/ui/StatCard';
import { CARD, TABLE, TD, TH } from '../shared/ui/styles';

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

// /t/admin/sync, the MF-02 chain's screen (D-078 demo takeover): Field Station connection state,
// queue depth per priority, last flush, and the recent field-event ledger, end to end from the
// gateway bridge to ingestion (gateway-sync api-design 07 and 03). TrekLink Staff and Admin only.
export const SyncStatusPage: React.FC = () => {
  const [windowMinutes, setWindowMinutes] = useState<WindowMinutes>(60);
  const { data, isLoading, error, refetch, isFetching } = useSyncStatus(windowMinutes);
  const events = useRecentEvents();

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
              label="Unknown device"
              value={data.ingestion.unknownDevice}
              tone={data.ingestion.unknownDevice > 0 ? 'attention' : undefined}
            />
          </div>

          <h2 className="mb-2 text-title-sm text-ink">Field Stations</h2>
          {data.fieldStations.length === 0 ? (
            <Empty>
              <p>No Field Stations are registered yet.</p>
            </Empty>
          ) : (
            <div className="mb-6 overflow-x-auto">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Station</th>
                    <th className={TH}>Organization</th>
                    <th className={TH}>Connection</th>
                    <th className={TH}>Last sync</th>
                    <th className={TH}>Last flush</th>
                    <th className={TH}>Queue depth (P0 to P3)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.fieldStations.map((station) => (
                    <tr key={station.id}>
                      <td className={TD}>{station.name}</td>
                      <td className={TD}>{station.organization.name}</td>
                      <td className={TD}>
                        <Badge tone={CONNECTION_TONE[station.connection]}>
                          {CONNECTION_LABEL[station.connection]}
                        </Badge>
                      </td>
                      <td className={TD}>{relative(station.lastSyncAt)}</td>
                      <td className={TD}>{relative(station.lastFlushAt)}</td>
                      <td className={TD}>
                        {station.queueDepth.p0}, {station.queueDepth.p1}, {station.queueDepth.p2},{' '}
                        {station.queueDepth.p3}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <h2 className="mb-2 text-title-sm text-ink">Recent field events</h2>
      {events.isLoading && <Loading label="Loading recent events…" />}
      {events.error && <ErrorState error={events.error} onRetry={() => void events.refetch()} />}
      {events.data && events.data.items.length === 0 && (
        <Empty>
          <p>No field events have been ingested yet.</p>
        </Empty>
      )}
      {events.data && events.data.items.length > 0 && (
        <div className={`${CARD} overflow-x-auto p-0`}>
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Received</th>
                <th className={TH}>Device</th>
                <th className={TH}>Kind</th>
                <th className={TH}>Ingress</th>
                <th className={TH}>Attribution</th>
              </tr>
            </thead>
            <tbody>
              {events.data.items.map((event) => (
                <tr key={event.eventId}>
                  <td className={TD}>{formatDateTime(event.receivedAt)}</td>
                  <td className={TD}>{event.assetTag ?? event.deviceId}</td>
                  <td className={TD}>{event.kind}</td>
                  <td className={TD}>{event.ingress === 'FIELD_STATION' ? 'Field Station' : 'Node uplink'}</td>
                  <td className={TD}>{event.attribution === 'ATTRIBUTED' ? 'Attributed' : 'Unattributed'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
