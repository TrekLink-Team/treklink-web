import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DEFAULT_HEALTH_WINDOW,
  HEALTH_WINDOWS,
  useSystemHealth,
  type HealthStation,
  type HealthWindow,
} from '../entities/system-health/api';
import {
  COMPONENT_LABEL,
  componentNote,
  depthText,
  plural,
  sortStations,
} from '../entities/system-health/model';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime } from '../shared/lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  PageHeader,
  Select,
  Skeleton,
  type Column,
} from '../shared/ui';
import { ErrorState } from '../shared/ui/bits';
import { messageOf } from '../shared/ui/errors';
import { LINK } from '../shared/ui/styles';

const timeOf = (millis: number): string =>
  new Date(millis).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

// A figure with its label, for the small counts inside a card.
const Figure: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex flex-col">
    <dt className="text-body-sm text-ink-muted">{label}</dt>
    <dd className="m-0 font-display text-kpi tabular-nums text-ink">{value}</dd>
  </div>
);

// A status word with its tone: text always, never colour alone (convention 06 §8 item 3).
const Status: React.FC<{
  tone: 'done' | 'attention' | 'critical' | 'ended';
  children: React.ReactNode;
}> = ({ tone, children }) => <Badge tone={tone}>{children}</Badge>;

const VersionCell: React.FC<{ station: HealthStation; current: string | null }> = ({
  station,
  current,
}) => (
  <span className="flex flex-wrap items-center gap-2">
    <span className="font-mono">{station.version ?? 'Unknown'}</span>
    {station.outdated ? (
      <Status tone="attention">Outdated</Status>
    ) : station.version !== null && current !== null ? (
      <Status tone="done">Current</Status>
    ) : null}
  </span>
);

const LastSync: React.FC<{ station: HealthStation }> = ({ station }) => (
  <span className="flex flex-wrap items-center gap-2">
    <span>{station.lastSyncAt ? formatDateTime(station.lastSyncAt) : 'Never'}</span>
    {station.stale && <Status tone="attention">Stale</Status>}
  </span>
);

const OrganizationLink: React.FC<{ station: HealthStation }> = ({ station }) => (
  // The per-organization page does not exist yet, so the link opens the organizations list.
  <Link to="/t/organizations" className={LINK}>
    {station.organization.name}
  </Link>
);

// `/t/admin/health`, screen 9.3 (monitoring api-design 06, UC-42, FR-MON-10, FR-EVT-13): the platform
// health, the alert outbox, the Field Stations, the ingestion of the window and the buffering devices,
// polled every 30 s and refreshed at once by `station.stale`. Read-only. TrekLink Admin only.
export const SystemHealthPage: React.FC = () => {
  const [windowMinutes, setWindowMinutes] = useState<HealthWindow>(DEFAULT_HEALTH_WINDOW);
  const health = useSystemHealth(windowMinutes);
  const [announcement, setAnnouncement] = useState('');

  const failure = health.error;
  const data = health.data;
  const forbidden =
    failure instanceof ApiError && (failure.statusCode === 403 || failure.statusCode === 404);
  if (forbidden && !data) {
    return (
      <div role="alert" className="flex justify-center py-16">
        <p className="text-lg font-semibold text-ink">{messageOf(failure)}</p>
      </div>
    );
  }

  const refresh = async () => {
    const result = await health.refetch();
    if (result.data) setAnnouncement(`Health updated at ${timeOf(Date.now())}`);
  };

  const badWindow = failure instanceof ApiError && failure.statusCode === 400;
  const stations = data ? sortStations(data.fieldStations.items) : [];
  const current = data?.fieldStations.currentRelease ?? null;

  const columns: Column<HealthStation>[] = [
    {
      key: 'name',
      header: 'Field Station',
      cell: (row) => <span className="font-semibold">{row.name}</span>,
    },
    {
      key: 'organization',
      header: 'Organization',
      cell: (row) => <OrganizationLink station={row} />,
    },
    { key: 'lastSync', header: 'Last sync', cell: (row) => <LastSync station={row} /> },
    {
      key: 'depth',
      header: 'Queue depth',
      cell: (row) => <span className="font-mono text-body-sm">{depthText(row.queueDepth)}</span>,
    },
    {
      key: 'retry',
      header: 'Oldest retry',
      cell: (row) => row.oldestRetryCount ?? 'None',
      hideOnMobile: true,
    },
    {
      key: 'version',
      header: 'Version',
      cell: (row) => <VersionCell station={row} current={current} />,
    },
  ];

  return (
    <section aria-labelledby="health-title" className="flex flex-col gap-4">
      <PageHeader
        id="health-title"
        title="System health"
        meta={health.dataUpdatedAt ? `Last updated ${timeOf(health.dataUpdatedAt)}` : undefined}
        description="Platform status, alerts, Field Stations and ingestion, refreshed every 30 seconds."
        actions={
          <div className="flex flex-col gap-1">
            <label htmlFor="health-window" className="sr-only">
              Window
            </label>
            <Select
              id="health-window"
              value={windowMinutes}
              onChange={(event) => setWindowMinutes(Number(event.target.value) as HealthWindow)}
            >
              {HEALTH_WINDOWS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  Last {minutes} minutes
                </option>
              ))}
            </Select>
          </div>
        }
        primaryAction={
          <Button
            variant="secondary"
            loading={health.isFetching && !health.isPending}
            onClick={() => void refresh()}
          >
            Refresh
          </Button>
        }
      />
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {failure && data && (
        <Alert tone="error">
          {messageOf(failure)} Showing the data loaded at {timeOf(health.dataUpdatedAt)}.
        </Alert>
      )}
      {failure && !data && badWindow && (
        <Alert
          tone="error"
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setWindowMinutes(DEFAULT_HEALTH_WINDOW)}
            >
              Use 60 minutes
            </Button>
          }
        >
          {messageOf(failure)}
        </Alert>
      )}
      {failure && !data && !badWindow && (
        <ErrorState error={failure} onRetry={() => void health.refetch()} />
      )}

      {health.isPending && (
        <div
          role="status"
          aria-label="Loading system health"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-36 w-full" rounded="panel" />
          ))}
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card aria-labelledby="health-platform">
              <CardHeader
                title="Platform"
                id="health-platform"
                action={
                  <Status tone={data.health.status === 'ok' ? 'done' : 'attention'}>
                    {data.health.status === 'ok' ? 'OK' : 'DEGRADED'}
                  </Status>
                }
              />
              <dl className="m-0 flex flex-col gap-2">
                {(['database', 'mqtt'] as const).map((name) => {
                  const state = data.health.components[name];
                  const note = componentNote(name, state);
                  return (
                    <div key={name} className="flex flex-wrap items-center justify-between gap-2">
                      <dt className="text-body text-ink">
                        {name === 'database' ? 'Database' : 'MQTT broker'}
                      </dt>
                      <dd className="m-0 flex flex-col items-end">
                        <Status
                          tone={state === 'up' ? 'done' : state === 'down' ? 'critical' : 'ended'}
                        >
                          {COMPONENT_LABEL[state]}
                        </Status>
                        {note && <span className="text-body-sm text-ink-muted">{note}</span>}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </Card>

            <Card aria-labelledby="health-alerts">
              <CardHeader title="Alert delivery" id="health-alerts" />
              <dl className="m-0 grid grid-cols-2 gap-3">
                <Figure label="Pending" value={data.alerts.pending} />
                <Figure label="Failed" value={data.alerts.failed} />
              </dl>
              {data.alerts.failed > 0 && (
                <p className="mt-3 text-body-sm text-status-attention-fg">
                  {plural(data.alerts.failed, 'alert')} could not be delivered.{' '}
                  <Link to="/t/incidents" className={LINK}>
                    View failed alerts
                  </Link>
                </p>
              )}
            </Card>

            <Card aria-labelledby="health-stations">
              <CardHeader title="Field Stations" id="health-stations" />
              <dl className="m-0 grid grid-cols-2 gap-3">
                <Figure
                  label="Stale"
                  value={`${data.fieldStations.stale} of ${data.fieldStations.total}`}
                />
                <Figure label="Outdated" value={data.fieldStations.outdated} />
              </dl>
              <p className="mt-3 text-body-sm text-ink-muted">
                Deepest queue: {depthText(data.fieldStations.maxQueueDepth)}
              </p>
              <p className="text-body-sm text-ink-muted">
                {data.fieldStations.outdated > 0
                  ? `${data.fieldStations.outdated} outdated, current release ${current ?? 'unknown'}`
                  : `Current release ${current ?? 'unknown'}`}
              </p>
              {data.fieldStations.stale > 0 && (
                <p className="mt-2 text-body-sm text-status-attention-fg">
                  {plural(data.fieldStations.stale, 'Field Station')} not heard from.{' '}
                  <Link to="/t/organizations" className={LINK}>
                    View Field Stations
                  </Link>
                </p>
              )}
            </Card>

            <Card aria-labelledby="health-ingestion">
              <CardHeader
                title="Ingestion"
                id="health-ingestion"
                description={`Last ${windowMinutes} minutes`}
              />
              <dl className="m-0 grid grid-cols-2 gap-3">
                <Figure label="Per minute" value={data.ingestion.perMinute} />
                <Figure label="Accepted" value={data.ingestion.accepted} />
                <Figure label="Duplicates" value={data.ingestion.duplicates} />
                <Figure label="Malformed" value={data.ingestion.malformed} />
                <Figure label="Unknown device" value={data.ingestion.unknownDevice} />
              </dl>
            </Card>

            <Card aria-labelledby="health-buffering">
              <CardHeader title="Devices buffering" id="health-buffering" />
              <dl className="m-0">
                <Figure label="Holding messages" value={data.devicesBuffering} />
              </dl>
              <p className="mt-3 text-body-sm text-ink-muted">
                Devices holding messages that have not reached a Field Station.
              </p>
            </Card>
          </div>

          {stations.length === 0 ? (
            <p className="text-body text-ink-muted">No Field Stations are registered yet.</p>
          ) : (
            <DataTable<HealthStation>
              caption="Field Stations"
              columns={columns}
              rows={stations}
              rowId={(row) => row.id}
              empty={{ title: 'No Field Stations are registered yet.' }}
              renderCard={(row) => (
                <div className="flex flex-col gap-1.5 text-body">
                  <span className="font-semibold">{row.name}</span>
                  <OrganizationLink station={row} />
                  <LastSync station={row} />
                  <span className="font-mono text-body-sm">{depthText(row.queueDepth)}</span>
                  <VersionCell station={row} current={current} />
                </div>
              )}
            />
          )}
        </>
      )}
    </section>
  );
};
