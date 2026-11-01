import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import type { SnapshotDevice, UnitState } from '../entities/live-map/api';
import { byUnitState, unitStateOf } from '../entities/live-map/model';
import { useLiveMap } from '../entities/live-map/useLiveMap';
import { useOrganizations } from '../entities/organization/api';
import { ApiError } from '../shared/api/apiClient';
import { MAP_CONFIG_KEY, getMapConfig } from '../shared/config/map';
import { formatDateTime } from '../shared/lib/format';
import {
  Alert,
  Badge,
  Button,
  Field,
  INCIDENT_STATE,
  Input,
  MapLegend,
  Select,
  Skeleton,
  type IncidentState,
} from '../shared/ui';
import { cn } from '../shared/ui/cn';
import { messageOf } from '../shared/ui/errors';
import { LINK } from '../shared/ui/styles';
import { LiveMapWidget, type MapMarker } from '../widgets/LiveMapWidget/LiveMapWidget';

const MSG26 = 'You do not have access to this.';
const MSG32 = 'Reconnecting. Live data is paused.';
const MSG01 = 'No results match your filters.';
const EMPTY_ORG = 'No devices are out on rent. Devices appear here from handover to check-in.';
// D-092 rule 2 (frontend REQ-UBI-10): the label of a unit not heard since its handover, and the summary.
const MSG41 = 'Not heard since handover';
const MSG42 = (live: number, offline: number, notHeard: number) =>
  `${live} live, ${offline} offline, ${notHeard} not heard since handover`;

// How often staleness is re-evaluated against the clock between stream entries.
const CLOCK_TICK_MS = 15_000;

// An incident in these states no longer needs a response; it keeps its badge but not the SOS marker.
const SETTLED: IncidentState[] = ['RESOLVED', 'FALSE_ALARM'];

const useNow = (tickMs: number): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), tickMs);
    return () => window.clearInterval(timer);
  }, [tickMs]);
  return now;
};

const holderOf = (device: SnapshotDevice) => device.holder?.name ?? 'No holder';
const sosOf = (device: SnapshotDevice) =>
  device.openIncident !== null && !SETTLED.includes(device.openIncident.state);
const incidentText = (device: SnapshotDevice) =>
  device.openIncident
    ? `SOS, state ${INCIDENT_STATE[device.openIncident.state]?.label ?? device.openIncident.state}`
    : null;

interface Row {
  device: SnapshotDevice;
  state: UnitState;
}

const statusLine = ({ device, state }: Row): string => {
  if (state === 'NOT_HEARD') {
    // Only the fleet map keeps a reading from before the handover (monitoring REQ-UBI-04).
    return device.lastSeenAt
      ? `${MSG41}, last seen ${formatDateTime(device.lastSeenAt)}, before handover`
      : MSG41;
  }
  if (!device.lastSeenAt) return 'No position yet';
  const seen = formatDateTime(device.lastSeenAt);
  if (state === 'OFFLINE') return `Offline, last seen ${seen}`;
  return device.position ? `Last seen ${seen}` : `No position yet, last seen ${seen}`;
};

// A unit not heard since handover is pinned at the counter that handed it over, the last place it was
// known to be; a live or offline unit at its last position from the custody interval.
const pointOf = ({ device, state }: Row): [number, number] | null => {
  if (state === 'NOT_HEARD')
    return device.counterLocation ? [device.counterLocation.lat, device.counterLocation.lon] : null;
  return device.position ? [device.position.lat, device.position.lon] : null;
};

const markerOf = (row: Row, scope: 'o' | 't'): MapMarker | null => {
  const { device, state } = row;
  const position = pointOf(row);
  if (!position) return null;
  const incident = incidentText(device);
  return {
    id: device.id,
    position,
    title: device.assetTag,
    subtitle: [holderOf(device), incident].filter(Boolean).join(', '),
    status: sosOf(device)
      ? 'incident'
      : state === 'NOT_HEARD'
        ? 'unheard'
        : state === 'OFFLINE'
          ? 'stale'
          : 'ok',
    details: [
      `Contract ${device.contractCode}`,
      `Variant ${device.hardwareVariant}`,
      device.batteryPct === null ? 'Battery unknown' : `Battery ${device.batteryPct}%`,
      statusLine(row),
      ...(state === 'NOT_HEARD' && device.counterLocation
        ? [`Pinned at ${device.counterLocation.name}, the handover location`]
        : []),
    ],
    // Screen 9.1: the popup opens the device's telemetry history (screen 9.2) in the same scope; the
    // asset tag travels along for the history heading.
    link: {
      label: 'Position history',
      to: `/${scope}/devices/${device.id}/telemetry`,
      state: { assetTag: device.assetTag },
    },
  };
};

// The fleet map's organization filter (screen 9.1, `/t/map` only); a member's map has none.
const OrganizationFilter: React.FC<{
  value: string | null;
  onChange: (organizationId: string | null) => void;
}> = ({ value, onChange }) => {
  const organizations = useOrganizations('ACTIVE');
  return (
    <Field id="map-organization" label="Organization">
      <Select
        id="map-organization"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">All organizations</option>
        {(organizations.data?.items ?? []).map((organization) => (
          <option key={organization.id} value={organization.id}>
            {organization.code} {organization.legalName}
          </option>
        ))}
      </Select>
    </Field>
  );
};

const DeviceRow: React.FC<{
  row: Row;
  scope: 'o' | 't';
  selected: boolean;
  onSelect: () => void;
}> = ({ row, scope, selected, onSelect }) => {
  const { device, state } = row;
  // The button's accessible name is its visible text (WCAG 2.5.3): asset tag, badge, battery, holder
  // and status line, read in that order. The spaces between the parts are not drawn in the flex and
  // block layout; they keep the parts apart in the name.
  return (
    <li className={cn('border-b border-line px-4 py-3', selected && 'bg-chrome/60')}>
      <button
        type="button"
        onClick={onSelect}
        disabled={!pointOf(row)}
        className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-default"
      >
        <span className="flex items-center gap-2">
          <span className="font-semibold text-ink">{device.assetTag}</span>{' '}
          {state === 'OFFLINE' && <Badge tone="waiting">Offline</Badge>}
          {state === 'NOT_HEARD' && <Badge tone="ended">Not heard</Badge>}{' '}
          {device.batteryPct !== null && (
            <span className="ml-auto text-body-sm text-ink-muted">{device.batteryPct}%</span>
          )}
        </span>{' '}
        <span className="block text-body-sm text-ink-muted">{holderOf(device)}</span>{' '}
        <span className="block text-body-sm text-ink-muted">{statusLine(row)}</span>
      </button>
      {device.openIncident && (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-body-sm">
          <Badge tone={sosOf(device) ? 'critical' : 'done'}>{incidentText(device)}</Badge>
          {scope === 'o' && (
            <Link to={`/o/incidents/${device.openIncident.id}`} className={LINK}>
              Open incident{device.openIncident.code ? ` ${device.openIncident.code}` : ''}
            </Link>
          )}
        </p>
      )}
    </li>
  );
};

/**
 * Screen 9.1, `/o/map` and `/t/map` (UC-38, UC-41, MF-04). The snapshot of monitoring api-design 02,
 * then the stream entries after its cursor, drawn on LiveMapWidget with a device list beside it.
 * An organization's map is scoped by the server to the caller's organization; the fleet map adds an
 * organization filter. The page changes nothing on the server.
 */
export const LiveMapPage: React.FC<{ scope: 'o' | 't' }> = ({ scope }) => {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const { snapshot, state, paused } = useLiveMap(scope === 't' ? organizationId : null);
  const config = useQuery({
    queryKey: MAP_CONFIG_KEY,
    queryFn: getMapConfig,
    retry: false,
    staleTime: Infinity,
  });
  const now = useNow(CLOCK_TICK_MS);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const navigate = useNavigate();

  const staleAfterSeconds = config.data?.staleAfterSeconds;
  // Live units first, then offline, then not heard since handover (REQ-UBI-10).
  const rows: Row[] = useMemo(
    () =>
      byUnitState(
        (state?.order ?? [])
          .map((id) => state?.devices[id])
          .filter((device): device is SnapshotDevice => device !== undefined)
          .map((device) => ({ device, state: unitStateOf(device, now, staleAfterSeconds) })),
      ),
    [state, now, staleAfterSeconds],
  );
  const markers = useMemo(
    () =>
      rows
        .map((row) => markerOf(row, scope))
        .filter((marker): marker is MapMarker => marker !== null),
    [rows, scope],
  );
  const needle = search.trim().toLowerCase();
  const listed = needle
    ? rows.filter(({ device }) =>
        [device.assetTag, device.holder?.name ?? '', device.contractCode].some((text) =>
          text.toLowerCase().includes(needle),
        ),
      )
    : rows;
  const sosCount = rows.filter(({ device }) => sosOf(device)).length;
  const count = (unit: UnitState) => rows.filter((row) => row.state === unit).length;

  const error = snapshot.error;
  // A refused filter (400) offers the way back to the whole fleet; anything else offers a reload.
  const invalidFilter = error instanceof ApiError && error.errorCode === 'VALIDATION_FAILED';

  if (error instanceof ApiError && error.statusCode === 403) {
    return (
      <div role="alert" className="flex justify-center py-16">
        <p className="text-lg font-semibold text-ink">{MSG26}</p>
      </div>
    );
  }

  const title = scope === 't' ? 'Fleet map' : 'Live map';
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-2">
      <h1 className="sr-only">{title}</h1>
      {paused && <Alert tone="warning">{MSG32}</Alert>}
      {error && (
        <Alert
          tone="error"
          action={
            invalidFilter ? (
              <Button size="sm" onClick={() => setOrganizationId(null)}>
                Show all organizations
              </Button>
            ) : (
              <Button size="sm" onClick={() => void snapshot.refetch()}>
                Reload map
              </Button>
            )
          }
        >
          {messageOf(error)}
        </Alert>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <div className="relative min-h-[60vh] flex-1 overflow-hidden rounded-panel border border-line lg:min-h-0">
          <LiveMapWidget
            markers={markers}
            selectedId={selectedId}
            onLink={(link) => navigate(link.to, { state: link.state })}
            className="h-full min-h-[60vh] rounded-none border-0 lg:min-h-0"
          />
          <MapLegend
            className="absolute bottom-3 left-3 z-[500]"
            states={['fresh', 'stale', 'unheard', 'sos']}
          />
        </div>
        <aside
          aria-label="Devices"
          className="flex max-h-[50vh] flex-col overflow-hidden rounded-panel border border-line bg-surface lg:max-h-none lg:w-[22rem]"
        >
          <div className="space-y-3 border-b border-line p-4">
            <h2 className="font-display text-body-lg font-extrabold text-ink">{title}</h2>
            <div className="text-body-sm text-ink-muted" aria-live="polite">
              <p>
                {rows.length} {rows.length === 1 ? 'device' : 'devices'}, {sosCount} SOS open
              </p>
              <p>{MSG42(count('LIVE'), count('OFFLINE'), count('NOT_HEARD'))}</p>
            </div>
            {scope === 't' && (
              <OrganizationFilter value={organizationId} onChange={setOrganizationId} />
            )}
            <Field id="map-search" label="Search devices" hideLabel>
              <Input
                id="map-search"
                type="search"
                placeholder="Search asset tag, holder or contract"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {snapshot.isPending && (
              <div className="space-y-2 p-4" aria-label="Loading the map">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            )}
            {state && listed.length === 0 && (
              <p className="p-4 text-body-sm text-ink-muted">
                {scope === 'o' && !needle ? EMPTY_ORG : MSG01}
              </p>
            )}
            <ul>
              {listed.map((row) => (
                <DeviceRow
                  key={row.device.id}
                  row={row}
                  scope={scope}
                  selected={row.device.id === selectedId}
                  onSelect={() => setSelectedId(row.device.id)}
                />
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
};
