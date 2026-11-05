import React, { useState } from 'react';
import { Siren } from 'lucide-react';
import {
  deadlineOf,
  INCIDENT_SORT_FIELDS,
  SAR_DISCLAIMER,
  useIncidents,
  type Incident,
  type IncidentFilters,
} from '../entities/incident/api';
import { StateBadges } from '../entities/incident/ui';
import { collectionSortOf, sortParamsOf } from '../shared/api/query';
import { formatDateTime } from '../shared/lib/format';
import { ErrorState, PageTitle } from '../shared/ui/bits';
import { Pagination } from '../shared/ui/DataTable';
import { Button } from '../shared/ui/Button';
import { CollectionView, pageInfoOf, type CollectionField } from '../shared/ui/collection-view';
import { INCIDENT_STATE, type IncidentState } from '../shared/ui/status';
import { WARNING } from '../shared/ui/styles';

const STATES = Object.keys(INCIDENT_STATE) as IncidentState[];
const DEFAULTS: IncidentFilters = { open: true, pageNumber: 1 };

// Show holds two server filters that combine (incidents api-design 01 `state` and `open`): one state
// or all, and open only (the default) or open and closed (review of treklink-web#350).
const OPEN = 'open';
const ALL = 'all';

const deviceText = (incident: Incident) =>
  `${incident.device.assetTag ?? 'Unknown device'}, ${incident.device.holder?.name ?? 'No holder label'}`;

// /o/incidents, the organization incident queue of screen 8.1 (incidents api-design 01) on
// CollectionView (chapter 06 §9, D-096). Rows keep the server order, most urgent deadline first
// (D-059 rule 7), until a header asks the server for another (W26: code, state, latest event).
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
    <section aria-labelledby="incidents-title" data-fit-page="" className="flex min-h-0 flex-1 flex-col gap-4">
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
        icon={<Siren />}
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
          { key: '', label: 'All states' },
          ...STATES.map((state) => ({ key: state, label: INCIDENT_STATE[state].label })),
        ]}
        query={{
          search: '',
          filter: filters.state ?? '',
          sort: collectionSortOf(filters),
          groups: { open: filters.open ? OPEN : ALL },
        }}
        titleSort="code"
        onQueryChange={(next) =>
          setFilters({
            state: (next.filter || undefined) as IncidentState | undefined,
            open: next.groups?.open === OPEN ? true : undefined,
            ...sortParamsOf(next.sort, INCIDENT_SORT_FIELDS),
            pageNumber: 1,
          })
        }
        filterGroups={[
          {
            key: 'open',
            label: 'Incidents',
            options: [
              { key: ALL, label: 'Open or closed' },
              { key: OPEN, label: 'Open only' },
            ],
          },
        ]}
        noMatch={filters.open && !filters.state ? { title: 'No open incidents.' } : undefined}
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
