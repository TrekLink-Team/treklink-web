import React, { useCallback, useRef, useState } from 'react';
import { Siren } from 'lucide-react';
import { Outlet, useOutletContext } from 'react-router-dom';
import {
  deadlineOf,
  INCIDENT_SORT_FIELDS,
  SAR_DISCLAIMER,
  useIncidents,
  type Incident,
  type IncidentFilters,
} from '../entities/incident/api';
import { StateBadges } from '../entities/incident/ui';
import { IncidentFiltersDialog } from '../features/filter-incidents/IncidentFiltersDialog';
import { collectionSortOf, sortParamsOf } from '../shared/api/query';
import { flattenGroups, useDeviceGroups } from '../entities/rented-device/api';
import { formatDateTime } from '../shared/lib/format';
import { ErrorState, PageTitle } from '../shared/ui/bits';
import { Pagination } from '../shared/ui/DataTable';
import { Button } from '../shared/ui/Button';
import { CollectionView, pageInfoOf, type CollectionField } from '../shared/ui/collection-view';
import { INCIDENT_STATE, type IncidentState } from '../shared/ui/status';
import { WARNING } from '../shared/ui/styles';

const STATES = Object.keys(INCIDENT_STATE) as IncidentState[];
const DEFAULTS: IncidentFilters = { pageNumber: 1 };

interface IncidentQueueState {
  filters: IncidentFilters;
  setFilters: React.Dispatch<React.SetStateAction<IncidentFilters>>;
  readScroll: () => number;
  saveScroll: (offset: number) => void;
}

// The queue and its record route share this layout, so Back keeps the applied query and scroll.
export const OrganizationIncidentsLayout: React.FC = () => {
  const [filters, setFilters] = useState<IncidentFilters>(DEFAULTS);
  const scrollOffset = useRef(0);
  const readScroll = useCallback(() => scrollOffset.current, []);
  const saveScroll = useCallback((offset: number) => {
    scrollOffset.current = offset;
  }, []);
  return <Outlet context={{ filters, setFilters, readScroll, saveScroll } satisfies IncidentQueueState} />;
};

// Show holds two server filters that combine (incidents api-design 01 `state` and `open`): one state
// or all, and open only or open and closed (review of treklink-web#350).
const OPEN = 'open';
const ALL = 'all';

const deviceText = (incident: Incident) =>
  [
    incident.device.assetTag ?? 'Unknown device',
    incident.device.holder?.name ?? 'No holder label',
    incident.device.group?.name,
  ]
    .filter(Boolean)
    .join(', ');

// /o/incidents, the organization incident queue of screen 8.1 (incidents api-design 01) on
// CollectionView (chapter 06 §9, D-096). Rows keep the server order, most urgent deadline first
// (D-059 rule 7), until a header asks the server for another (W26: code, state, latest event).
export const IncidentsPage: React.FC = () => {
  const { filters, setFilters, readScroll, saveScroll } = useOutletContext<IncidentQueueState>();
  const [filtering, setFiltering] = useState(false);
  const hasDeviceOrDate = Boolean(filters.deviceId || filters.from);
  const groups = useDeviceGroups();
  const flatGroups = groups.data ? flattenGroups(groups.data.groups) : [];
  const groupId =
    !groups.data || flatGroups.some(({ group }) => group.id === filters.groupId)
      ? filters.groupId
      : undefined;
  const { data, isLoading, error, refetch, isFetching } = useIncidents(
    groupId === filters.groupId ? filters : { ...filters, groupId, pageNumber: 1 },
  );
  const scroller = useRef<HTMLDivElement | null>(null);
  const restored = useRef(false);
  const setScroller = useCallback(
    (node: HTMLDivElement | null) => {
      scroller.current = node;
      if (node && data && !restored.current) {
        node.scrollTop = readScroll();
        restored.current = true;
      }
    },
    [data, readScroll],
  );
  const resetScroll = () => {
    saveScroll(0);
    if (scroller.current) scroller.current.scrollTop = 0;
  };
  const fields: CollectionField<Incident>[] = [
    { key: 'device', label: 'Device and holder', render: deviceText, compact: true },
    {
      key: 'state',
      label: 'State',
      render: (incident) => <StateBadges incident={incident} />,
      compact: true,
      sortable: true,
    },
    {
      key: 'owner',
      label: 'Owner',
      render: (incident) => incident.owner?.fullName ?? 'Unclaimed',
      hideWithPane: true,
    },
    { key: 'deadline', label: 'Deadline', render: deadlineOf, compact: true },
    {
      key: 'lastEventAt',
      label: 'Latest event',
      render: (incident) => formatDateTime(incident.lastEventAt),
      hideWithPane: true,
      sortable: true,
    },
  ];

  return (
    <section
      aria-labelledby="incidents-title"
      data-fit-page=""
      className="flex min-h-0 flex-1 flex-col gap-4"
      onScrollCapture={(event) => {
        if (scroller.current && event.target === scroller.current)
          saveScroll(scroller.current.scrollTop);
      }}
    >
      <PageTitle
        id="incidents-title"
        title="Incidents"
        action={
          <>
            <Button onClick={() => setFiltering(true)}>
              Filter incidents{hasDeviceOrDate ? ' (active)' : ''}
            </Button>
            <Button onClick={() => void refetch()} loading={isFetching && !isLoading}>
              Refresh
            </Button>
          </>
        }
      />
      <p className={WARNING}>{SAR_DISCLAIMER}</p>
      {filtering && (
        <IncidentFiltersDialog
          value={filters}
          onClose={() => setFiltering(false)}
          onApply={({ deviceId, from }) => {
            resetScroll();
            setFilters((current) => ({ ...current, deviceId, from, pageNumber: 1 }));
            setFiltering(false);
          }}
        />
      )}

      <CollectionView<Incident>
        icon={<Siren />}
        label="Incidents"
        scrollContainerRef={setScroller}
        resetKey={JSON.stringify([filters.deviceId, filters.from])}
        items={data?.items}
        loading={isLoading}
        error={error ? <ErrorState error={error} onRetry={() => void refetch()} /> : undefined}
        itemId={(incident) => incident.id}
        itemName={(incident) => incident.code}
        itemHref={(incident) => `/o/incidents/${incident.id}`}
        fields={fields}
        noun={{ one: 'incident', other: 'incidents' }}
        filters={[
          { key: '', label: 'All states' },
          ...STATES.map((state) => ({ key: state, label: INCIDENT_STATE[state].label })),
        ]}
        query={{
          search: '',
          filter: filters.state ?? '',
          sort: collectionSortOf(filters),
          groups: { open: filters.open ? OPEN : ALL, group: groupId ?? '' },
        }}
        titleSort="code"
        onQueryChange={(next) => {
          resetScroll();
          setFilters({
            deviceId: filters.deviceId,
            from: filters.from,
            state: (next.filter || undefined) as IncidentState | undefined,
            open: next.groups?.open === OPEN ? true : undefined,
            ...sortParamsOf(next.sort, INCIDENT_SORT_FIELDS),
            groupId: next.groups?.group || undefined,
            pageNumber: 1,
          });
        }}
        filterGroups={[
          {
            key: 'open',
            label: 'Incidents',
            options: [
              { key: ALL, label: 'Open or closed' },
              { key: OPEN, label: 'Open only' },
            ],
          },
          ...(flatGroups.length
            ? [
                {
                  key: 'group',
                  label: 'Group',
                  options: [
                    { key: '', label: 'All groups' },
                    ...flatGroups.map(({ group, depth }) => ({
                      key: group.id,
                      label: `${'↳ '.repeat(depth)}${group.name}`,
                    })),
                  ],
                },
              ]
            : []),
        ]}
        noMatch={
          filters.open && !filters.state && !groupId && !hasDeviceOrDate
            ? { title: 'No open incidents.' }
            : undefined
        }
        hideCommandBar={false}
        pageInfo={pageInfoOf(data)}
        details={{
          href: (incident) => `/o/incidents/${incident.id}`,
          hrefLabel: 'Open the incident',
        }}
        emptyState={
          hasDeviceOrDate
            ? {
                title: 'No results match your filters.',
                action: (
                  <Button
                    onClick={() => {
                      resetScroll();
                      setFilters(DEFAULTS);
                      document.getElementById('incidents-title')?.focus();
                    }}
                  >
                    Reset filters
                  </Button>
                ),
              }
            : { title: 'No incidents recorded.' }
        }
        footer={
          data && data.totalPages > 1 ? (
            <Pagination
              pageNumber={data.pageNumber}
              totalPages={data.totalPages}
              totalItems={data.totalCount}
              pageSize={data.pageSize}
              onPage={(pageNumber) => {
                resetScroll();
                setFilters({ ...filters, groupId, pageNumber });
              }}
            />
          ) : undefined
        }
      />
    </section>
  );
};
