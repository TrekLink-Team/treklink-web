import React, { useState } from 'react';
import { Link } from 'react-router-dom';
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
import { DataTable, Pagination, type Column } from '../shared/ui/DataTable';
import { Button } from '../shared/ui/Button';
import { Checkbox, Select } from '../shared/ui/Field';
import { INCIDENT_STATE, type IncidentState } from '../shared/ui/status';
import { LINK, WARNING } from '../shared/ui/styles';

const STATES = Object.keys(INCIDENT_STATE) as IncidentState[];
const DEFAULTS: IncidentFilters = { open: true, pageNumber: 1 };

const deviceText = (incident: Incident) =>
  `${incident.device.assetTag ?? 'Unknown device'}, ${incident.device.holder?.name ?? 'No holder label'}`;

// /o/incidents, the organization incident queue of screen 8.1 (incidents api-design 01). Rows keep
// the server order, most urgent deadline first; there is no client sort (D-059 rule 7).
export const IncidentsPage: React.FC = () => {
  const [filters, setFilters] = useState<IncidentFilters>(DEFAULTS);
  const { data, isLoading, error, refetch, isFetching } = useIncidents(filters);
  const filtered = filters.state !== undefined || filters.open !== true;
  const columns: Column<Incident>[] = [
    { key: 'code', header: 'Code', cell: (incident) => incident.code },
    { key: 'device', header: 'Device and holder', cell: deviceText },
    { key: 'state', header: 'State', cell: (incident) => <StateBadges incident={incident} /> },
    { key: 'owner', header: 'Owner', cell: (incident) => incident.owner?.fullName ?? 'Unclaimed' },
    { key: 'deadline', header: 'Deadline', cell: deadlineOf },
    { key: 'latest', header: 'Latest event', cell: (incident) => formatDateTime(incident.lastEventAt), hideOnMobile: true },
  ];

  return (
    <section aria-labelledby="incidents-title">
      <PageTitle
        id="incidents-title"
        title="Incidents"
        action={
          <Button onClick={() => void refetch()} loading={isFetching && !isLoading}>
            Refresh
          </Button>
        }
      />
      <p className={`${WARNING} mb-4`}>{SAR_DISCLAIMER}</p>

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-body-sm font-semibold text-ink">
          State
          <Select
            value={filters.state ?? ''}
            onChange={(event) =>
              setFilters({
                ...filters,
                state: (event.target.value || undefined) as IncidentState | undefined,
                pageNumber: 1,
              })
            }
          >
            <option value="">Any state</option>
            {STATES.map((state) => (
              <option key={state} value={state}>
                {INCIDENT_STATE[state].label}
              </option>
            ))}
          </Select>
        </label>
        <Checkbox
          label="Open incidents only"
          checked={filters.open === true}
          onChange={(event) =>
            setFilters({ ...filters, open: event.target.checked || undefined, pageNumber: 1 })
          }
        />
        {filtered && <Button onClick={() => setFilters(DEFAULTS)}>Reset</Button>}
      </div>

      <DataTable<Incident>
        caption="Incidents"
        columns={columns}
        rows={data?.items}
        rowId={(incident) => incident.id}
        rowLabel={(incident) => incident.code}
        rowHref={(incident) => `/o/incidents/${incident.id}`}
        loading={isLoading}
        error={error ? <ErrorState error={error} onRetry={() => void refetch()} /> : undefined}
        empty={{
          title: filtered ? 'No results match your filters.' : 'No open incidents.',
          action: filtered ? <Button onClick={() => setFilters(DEFAULTS)}>Reset</Button> : undefined,
        }}
        renderCard={(incident) => (
          <div>
            <div className="flex items-center justify-between gap-2">
              <Link to={`/o/incidents/${incident.id}`} className={LINK}>
                {incident.code}
              </Link>
              <StateBadges incident={incident} />
            </div>
            <p className="mt-1 text-body-sm text-ink">{deviceText(incident)}</p>
            <p className="text-body-sm text-ink-muted">{deadlineOf(incident)}</p>
          </div>
        )}
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
