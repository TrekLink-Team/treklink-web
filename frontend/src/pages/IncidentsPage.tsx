import React, { useState } from 'react';
import {
  deadlineOf,
  SAR_DISCLAIMER,
  useIncidents,
  type Incident,
  type IncidentFilters,
} from '../entities/incident/api';
import { StateBadges } from '../entities/incident/ui';
import { formatDateTime } from '../shared/lib/format';
import { ErrorState, PageTitle } from '../shared/ui/bits';
import { Pagination } from '../shared/ui/DataTable';
import { Button } from '../shared/ui/Button';
import { CollectionView, pageInfoOf, type CollectionField } from '../shared/ui/collection-view';
import { INCIDENT_STATE, type IncidentState } from '../shared/ui/status';
import { WARNING } from '../shared/ui/styles';

const STATES = Object.keys(INCIDENT_STATE) as IncidentState[];
const DEFAULTS: IncidentFilters = { open: true, pageNumber: 1 };

// The Show filter: open incidents (the default), every incident, or one state (incidents api-design
// 01 `open` and `state`).
const OPEN = 'open';
const ALL = 'all';
const showOf = (filters: IncidentFilters) => filters.state ?? (filters.open ? OPEN : ALL);
const filtersOf = (show: string): IncidentFilters =>
  show === OPEN
    ? { open: true, pageNumber: 1 }
    : show === ALL
      ? { pageNumber: 1 }
      : { state: show as IncidentState, pageNumber: 1 };

const deviceText = (incident: Incident) =>
  `${incident.device.assetTag ?? 'Unknown device'}, ${incident.device.holder?.name ?? 'No holder label'}`;

// /o/incidents, the organization incident queue of screen 8.1 (incidents api-design 01) on
// CollectionView (chapter 06 §9, D-096). Rows keep the server order, most urgent deadline first;
// there is no client sort (D-059 rule 7).
export const IncidentsPage: React.FC = () => {
  const [filters, setFilters] = useState<IncidentFilters>(DEFAULTS);
  const { data, isLoading, error, refetch, isFetching } = useIncidents(filters);
  const fields: CollectionField<Incident>[] = [
    { key: 'device', label: 'Device and holder', render: deviceText, compact: true },
    {
      key: 'state',
      label: 'State',
      render: (incident) => <StateBadges incident={incident} />,
      compact: true,
    },
    {
      key: 'owner',
      label: 'Owner',
      render: (incident) => incident.owner?.fullName ?? 'Unclaimed',
      hideWithPane: true,
    },
    { key: 'deadline', label: 'Deadline', render: deadlineOf, compact: true },
    {
      key: 'latest',
      label: 'Latest event',
      render: (incident) => formatDateTime(incident.lastEventAt),
      hideWithPane: true,
    },
  ];

  return (
    <section aria-labelledby="incidents-title" className="flex flex-col gap-4">
      <PageTitle
        id="incidents-title"
        title="Incidents"
        action={
          <Button onClick={() => void refetch()} loading={isFetching && !isLoading}>
            Refresh
          </Button>
        }
      />
      <p className={WARNING}>{SAR_DISCLAIMER}</p>

      <CollectionView<Incident>
        label="Incidents"
        items={data?.items}
        loading={isLoading}
        error={error ? <ErrorState error={error} onRetry={() => void refetch()} /> : undefined}
        itemId={(incident) => incident.id}
        itemName={(incident) => incident.code}
        itemHref={(incident) => `/o/incidents/${incident.id}`}
        fields={fields}
        noun={{ one: 'incident', other: 'incidents' }}
        filters={[
          { key: OPEN, label: 'Open incidents' },
          { key: ALL, label: 'All incidents' },
          ...STATES.map((state) => ({ key: state, label: INCIDENT_STATE[state].label })),
        ]}
        query={{ search: '', filter: showOf(filters), sort: null }}
        onQueryChange={(next) => setFilters(filtersOf(next.filter))}
        hideCommandBar={false}
        pageInfo={pageInfoOf(data)}
        details={{
          href: (incident) => `/o/incidents/${incident.id}`,
          hrefLabel: 'Open the incident',
        }}
        emptyState={{ title: 'No open incidents.' }}
        footer={
          data && data.totalPages > 1 ? (
            <Pagination
              pageNumber={data.pageNumber}
              totalPages={data.totalPages}
              totalItems={data.totalCount}
              pageSize={data.pageSize}
              onPage={(pageNumber) => setFilters({ ...filters, pageNumber })}
            />
          ) : undefined
        }
      />
    </section>
  );
};
