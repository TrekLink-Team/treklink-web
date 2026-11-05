import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import type { SnapshotDevice, UnitState } from '../entities/live-map/api';
import { byUnitState, unitStateOf } from '../entities/live-map/model';
import { useLiveMap } from '../entities/live-map/useLiveMap';
import { useOrganizations } from '../entities/organization/api';
import { flattenGroups, useDeviceGroups } from '../entities/rented-device/api';
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
  MARKER_LABEL,
  MapLegend,
  Select,
  Skeleton,
  type IncidentState,
} from '../shared/ui';
import { cn } from '../shared/ui/cn';
import { messageOf } from '../shared/ui/errors';
import { LINK } from '../shared/ui/styles';
import { LiveMapWidget, type MapMarker } from '../widgets/LiveMapWidget/LiveMapWidget';
import { GroupOptions } from '../widgets/RentedDevices/GroupTree';

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

const incidentPath = (scope: 'o' | 't', incidentId: string) => `/${scope}/incidents/${incidentId}`;
const incidentLinkText = (incident: NonNullable<SnapshotDevice['openIncident']>) =>
  `Open incident${incident.code ? ` ${incident.code}` : ''}`;

interface Row {
  device: SnapshotDevice;
  state: UnitState;
}

// The Staff map's words for a unit held at the counter (devices design section 12.8, REQ-EVT-39).
const DOCKED_TEXT = 'Docked at the counter';

const statusLine = ({ device, state }: Row): string => {
  if (state === 'DOCKED' || device.docked) {
    return device.docked?.byName ? `${DOCKED_TEXT}, ${device.docked.byName}` : DOCKED_TEXT;
  }
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

// The state part of a marker's accessible name, from the list's own words: "live, last seen {time}",
// "offline, last seen {time}" or "not heard since handover" (screen 9.1, WCAG 1.1.1). The list shows no
// word for a live unit, so the marker legend's "Live" leads its status line.
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const stateName = (row: Row): string =>
  [row.state === 'LIVE' ? MARKER_LABEL.fresh : null, statusLine(row)]
    .filter((part): part is string => part !== null)
    .map(lowerFirst)
    .join(', ');

// A unit not heard since handover is pinned at the counter that handed it over, the last place it was
// known to be; a live or offline unit at its last position from the custody interval.
const pointOf = ({ device, state }: Row): [number, number] | null => {
  // A docked unit is pinned at the counter while the browser holds its port (devices design 11.8).
  if (state === 'NOT_HEARD' || state === 'DOCKED' || device.docked)
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
    // The word travels in the title, so the popup and the marker's accessible name both carry it.
    title: device.simulated === true ? `${device.assetTag} (Simulated)` : device.assetTag,
    subtitle: [device.group?.name, holderOf(device), incident].filter(Boolean).join(', '),
    // Asset tag, state, holder and any incident: the state is read before the rest (screen 9.1). An
    // open SOS is the most urgent state, so it comes right after the asset tag, with the incident's
    // state label ("TL-0018, SOS, Acknowledged, live, ..."; review of treklink-web#367). A settled
    // incident keeps its badge text at the end.
    name: [
      device.simulated === true ? `${device.assetTag} (Simulated)` : device.assetTag,
      ...(sosOf(device) && device.openIncident
        ? [
            MARKER_LABEL.sos,
            INCIDENT_STATE[device.openIncident.state]?.label ?? device.openIncident.state,
          ]
        : []),
      stateName(row),
      device.group?.name,
      holderOf(device),
      sosOf(device) ? null : incident,
    ]
      .filter(Boolean)
      .join(', '),
    status: sosOf(device)
      ? 'incident'
      : state === 'DOCKED' || device.docked
        ? 'docked'
        : state === 'NOT_HEARD'
        ? 'unheard'
        : state === 'OFFLINE'
          ? 'stale'
          : 'ok',
    details: [
      device.contractCode ? `Contract ${device.contractCode}` : 'No contract',
      `Variant ${device.hardwareVariant}`,
      device.batteryPct === null ? 'Battery unknown' : `Battery ${device.batteryPct}%`,
      statusLine(row),
      ...(state === 'NOT_HEARD' && !device.docked && device.counterLocation
        ? [`Pinned at ${device.counterLocation.name}, the handover location`]
        : []),
      ...((state === 'DOCKED' || device.docked) && device.counterLocation
        ? [`${DOCKED_TEXT}: ${device.counterLocation.name}`]
        : []),
    ],
    // Screen 9.1: the popup opens the device's telemetry history (screen 9.2) in the same scope; the
    // asset tag travels along for the history heading.
    // An open incident comes first: it is the urgent page. It opens `/o/incidents/:id` (screen 8.1) or,
    // for Staff, `/t/incidents/:id` (screen 8.2).
    links: [
      ...(device.openIncident
        ? [
            {
              label: incidentLinkText(device.openIncident),
              to: incidentPath(scope, device.openIncident.id),
            },
          ]
        : []),
      {
        label: 'Position history',
        to: `/${scope}/devices/${device.id}/telemetry`,
        state: { assetTag: device.assetTag },
      },
    ],
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
          {device.simulated === true && <Badge>Simulated</Badge>}{' '}
          {state === 'OFFLINE' && <Badge tone="waiting">Offline</Badge>}
          {state === 'NOT_HEARD' && !device.docked && <Badge tone="ended">Not heard</Badge>}{' '}
          {(state === 'DOCKED' || device.docked) && <Badge tone="waiting">Docked</Badge>}{' '}
          {device.batteryPct !== null && (
            <span className="ml-auto text-body-sm text-ink-muted">{device.batteryPct}%</span>
          )}
        </span>{' '}
        <span className="block text-body-sm text-ink-muted">{holderOf(device)}</span>{' '}
        {device.group && (
          <span className="block text-body-sm text-ink-muted">Group {device.group.name} </span>
        )}
        <span className="block text-body-sm text-ink-muted">{statusLine(row)}</span>
      </button>
      {device.openIncident && (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-body-sm">
          <Badge tone={sosOf(device) ? 'critical' : 'done'}>{incidentText(device)}</Badge>
          <Link to={incidentPath(scope, device.openIncident.id)} className={LINK}>
            {incidentLinkText(device.openIncident)}
          </Link>
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
  const [groupId, setGroupId] = useState('');
  const groups = useDeviceGroups(scope === 'o');
  const selectedGroup =
    groupId &&
    (!groups.data || flattenGroups(groups.data.groups).some(({ group }) => group.id === groupId))
      ? groupId
      : undefined;
  const { snapshot, state, paused } = useLiveMap(
    scope === 't' ? organizationId : null,
    scope === 'o' ? selectedGroup : undefined,
  );
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
        [device.assetTag, device.holder?.name ?? '', device.contractCode ?? ''].some((text) =>
          text.toLowerCase().includes(needle),
        ),
      )
    : rows;
  const fieldStations = snapshot.data?.fieldStations ?? [];
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
  // A fit page (ui standard §7): the map fills the content area and only the device list scrolls.
  // Below 1024 px the list sits under the map and scrolls with its header as one region.
  return (
    <div data-fit-page="" className="flex min-h-0 flex-1 flex-col gap-3 p-2">
      <h1 className="sr-only">{title}</h1>
      {paused && <Alert tone="warning">{MSG32}</Alert>}
      {error && (
        <Alert
          tone="error"
          action={
            invalidFilter ||
            (selectedGroup && error instanceof ApiError && error.statusCode === 404) ? (
              <Button
                size="sm"
                onClick={() => {
                  setOrganizationId(null);
                  setGroupId('');
                }}
              >
                {scope === 't' ? 'Show all organizations' : 'Show all groups'}
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
        <div className="relative min-h-[10rem] flex-1 overflow-hidden rounded-panel border border-line">
          <LiveMapWidget
            markers={markers}
            selectedId={selectedId}
            onLink={(link) => navigate(link.to, { state: link.state })}
            className="h-full rounded-none border-0"
          />
          <MapLegend
            className="absolute bottom-3 left-3 z-[500]"
            // The Staff map also shows units docked at the counter (devices design section 12.8).
            states={
              scope === 't'
                ? ['fresh', 'stale', 'unheard', 'docked', 'sos']
                : ['fresh', 'stale', 'unheard', 'sos']
            }
          />
        </div>
        <aside
          aria-label="Devices"
          className="relative flex max-h-[45%] shrink-0 flex-col overflow-y-auto rounded-panel border border-line bg-surface lg:max-h-none lg:w-[22rem] lg:overflow-hidden"
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
            {scope === 'o' && !!groups.data?.groups.length && (
              <Field id="map-device-group" label="Group">
                <Select
                  id="map-device-group"
                  value={selectedGroup ?? ''}
                  onChange={(event) => {
                    setGroupId(event.target.value);
                    setSelectedId(null);
                  }}
                >
                  <GroupOptions groups={groups.data.groups} />
                </Select>
              </Field>
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
          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
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
            {/* Inside the list's own scroll region, so the page never grows with the stations
                (chapter 06 §11.1: only nested lists and panes scroll; review of #385). */}
            {fieldStations.length > 0 && (
              <section aria-labelledby="map-field-stations" className="border-t border-line p-4">
                <h3 id="map-field-stations" className="text-body-sm font-semibold text-ink">
                  Field Stations
                </h3>
                <ul className="mt-2 space-y-2">
                  {fieldStations.map((station) => (
                    <li key={station.id} className="flex flex-wrap items-center gap-2 text-body-sm">
                      <span className="font-semibold text-ink">{station.name}</span>
                      {station.stale && <Badge tone="waiting">Stale</Badge>}
                      <span className="w-full text-ink-muted">
                        Last sync{' '}
                        {station.lastSyncAt ? formatDateTime(station.lastSyncAt) : 'Never'}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};
