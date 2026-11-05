import React, { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  incidentKeys,
  useFleetIncidents,
  type Incident,
  type FleetIncidentFilters,
  INCIDENT_SORT_FIELDS,
  type IncidentSortField,
} from '../entities/incident/api';
import { collectionSortOf, sortParamsOf, type SortParams } from '../shared/api/query';
import { isReportable } from '../entities/incident/authorityReports';
import { IncidentFlags, StateBadges } from '../entities/incident/ui';
import { AuthorityReportsPanel, ReportDialog } from '../widgets/AuthorityReports/AuthorityReports';
import {
  StaffIncidentDetail,
  StaffDisclaimer,
} from '../widgets/StaffIncidentDetail/StaffIncidentDetail';
import { IncidentFiltersDialog } from '../features/filter-incidents/IncidentFiltersDialog';
import { useSession } from '../entities/session/model';
import { hasAnyRole } from '../shared/lib/permissions';
import { useToast } from '../shared/ui/toastStore';
import { formatDateTime } from '../shared/lib/format';
import { ErrorState, PageTitle } from '../shared/ui/bits';
import { Pagination } from '../shared/ui/DataTable';
import { FileWarning, Siren } from 'lucide-react';
import {
  CollectionView,
  pageInfoOf,
  type CollectionField,
  type CollectionTransition,
} from '../shared/ui/collection-view';
import { Button } from '../shared/ui/Button';
import { cn } from '../shared/ui/cn';
import { TabPanel, Tabs } from '../shared/ui/Tabs';
import { INCIDENT_STATE, type IncidentState } from '../shared/ui/status';
import { LINK } from '../shared/ui/styles';

const SCOPES: { id: string; label: string; states: IncidentState[] }[] = [
  { id: 'both', label: 'Unrouted and escalated', states: ['UNROUTED', 'ESCALATED'] },
  { id: 'unrouted', label: 'Unrouted', states: ['UNROUTED'] },
  { id: 'escalated', label: 'Escalated', states: ['ESCALATED'] },
  { id: 'all', label: 'All incidents', states: [] },
];

const holderOf = (incident: Incident) => incident.device.holder?.name ?? 'No holder label';

type Tab = 'queue' | 'reports';

// /t/incidents, StaffIncidentsPage of screen 8.2: the unrouted and escalated queue with inline
// detail (api-design 01 and 02). Rows keep the server order (D-059 rule 7) until a header asks the
// server for another (W26: code, state, latest event). Escalation is
// automatic; Staff do not manually create or escalate incidents here. The Authority reports tab is
// screen 8.3 (api-design 08 to 11).
export const StaffIncidentsPage: React.FC = () => {
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>('queue');
  const [scope, setScope] = useState(SCOPES[0]);
  const [pageNumber, setPageNumber] = useState(1);
  const [filters, setFilters] = useState<FleetIncidentFilters>({});
  // The header sort, apart from the filter dialog's device and date so a filter change keeps it.
  const [sort, setSort] = useState<SortParams<IncidentSortField>>({});
  const [filtering, setFiltering] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [startWithFalseAlarm, setStartWithFalseAlarm] = useState(false);
  const [reportingId, setReportingId] = useState<string | null>(null);
  const user = useSession((state) => state.user);
  const isStaff = Boolean(user && hasAnyRole(user.roles, ['STAFF']));
  // The code button of each row, so Back returns focus to the row that opened the detail.
  const lastTrigger = useRef<HTMLElement | null>(null);
  const { data, isLoading, error, refetch, isFetching } = useFleetIncidents(
    scope.states,
    pageNumber,
    { ...filters, ...sort },
  );

  const open = (incident: Incident, falseAlarm = false) => {
    lastTrigger.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setStartWithFalseAlarm(falseAlarm);
    setSelected(incident.id);
  };

  const back = () => {
    setSelected(null);
    lastTrigger.current?.focus();
  };

  // Item actions of screen 8.2 (W29) on CollectionView (chapter 06 §9.5, §9.6): Staff report a
  // reportable incident to the authorities (api-design 08) and declare an UNROUTED one a false alarm,
  // a state change confirmed in the detail, which holds the reviewed version (api-design 07). Staff
  // never acknowledge or resolve.
  const transitions = (incident: Incident): CollectionTransition<Incident>[] =>
    incident.state === 'UNROUTED' && isStaff
      ? [
          {
            key: 'false-alarm',
            label: 'Declare false alarm',
            destructive: true,
            onSelect: () => open(incident, true),
          },
        ]
      : [];
  const fields: CollectionField<Incident>[] = [
    {
      key: 'device',
      label: 'Device and holder',
      render: (incident) =>
        `${incident.device.assetTag ?? 'Unknown device'}, ${holderOf(incident)}`,
      compact: true,
    },
    {
      key: 'state',
      label: 'State',
      render: (incident) => <StateBadges incident={incident} />,
      compact: true,
      sortable: true,
    },
    {
      key: 'lastEventAt',
      label: 'Latest event',
      render: (incident) => formatDateTime(incident.lastEventAt),
      sortable: true,
    },
  ];
  return (
    <section aria-labelledby="staff-incidents-title" data-fit-page="" className="flex min-h-0 flex-1 flex-col">
      <PageTitle
        id="staff-incidents-title"
        title={scope.id === 'all' ? 'All incidents' : 'Incident queue'}
        action={
          <>
            <Button onClick={() => setFiltering(true)}>
              Filter incidents{filters.deviceId || filters.from ? ' (active)' : ''}
            </Button>
            <Button onClick={() => void refetch()} loading={isFetching && !isLoading}>
              Refresh
            </Button>
          </>
        }
      />
      <StaffDisclaimer />
      {filtering && (
        <IncidentFiltersDialog
          value={filters}
          onClose={() => setFiltering(false)}
          onApply={(next) => {
            setFilters(next);
            setPageNumber(1);
            setFiltering(false);
          }}
        />
      )}
      {saved && (
        <p role="status" className="mb-4 text-body text-ink">
          Saved. {saved} marked as false alarm.
        </p>
      )}

      <Tabs<Tab>
        label="Incident views"
        idPrefix="staff-incidents"
        items={[
          { key: 'queue', label: 'Incident queue' },
          { key: 'reports', label: 'Authority reports' },
        ]}
        value={tab}
        onChange={setTab}
        className="mb-4"
      />

      {tab === 'reports' && (
        <TabPanel idPrefix="staff-incidents" tabKey="reports" className="flex min-h-0 flex-1 flex-col">
          <AuthorityReportsPanel
            onViewIncident={(id) => {
              setSelected(id);
              setTab('queue');
            }}
          />
        </TabPanel>
      )}

      {tab === 'queue' && (
        <TabPanel idPrefix="staff-incidents" tabKey="queue" className="flex min-h-0 flex-1 flex-col">
          {/* One row: the queue table and the incident beside it each scroll inside themselves. */}
          <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
            <div data-fit-page="" className={cn('min-h-0 flex-col', selected ? 'hidden lg:flex' : 'flex')}>
              {/* The incident detail of screen 8.2 opens beside the queue, from the code or from
                  Show details: it is this queue's details view, in place of the built-in pane. */}
              <CollectionView<Incident>
                icon={<Siren />}
                label="Incidents"
                items={data?.items}
                loading={isLoading}
                error={
                  error ? <ErrorState error={error} onRetry={() => void refetch()} /> : undefined
                }
                itemId={(incident) => incident.id}
                itemName={(incident) => incident.code}
                itemTitle={(incident) => (
                  <button
                    type="button"
                    aria-pressed={selected === incident.id}
                    onClick={() => open(incident)}
                    className={`${LINK} inline-flex min-h-6 items-center`}
                  >
                    {incident.code}
                  </button>
                )}
                fields={fields}
                noun={{ one: 'incident', other: 'incidents' }}
                itemActions={[
                  {
                    key: 'report',
                    label: 'Report to authorities',
                    icon: <FileWarning />,
                    allowed: isReportable,
                    onSelect: (incident) => setReportingId(incident.id),
                  },
                ]}
                transitions={transitions}
                status={{
                  field: 'state',
                  value: (incident) => INCIDENT_STATE[incident.state],
                  extra: (incident) => <IncidentFlags incident={incident} />,
                }}
                filters={SCOPES.map((option) => ({ key: option.id, label: option.label }))}
                query={{ search: '', filter: scope.id, sort: collectionSortOf(sort) }}
                titleSort="code"
                onQueryChange={(next) => {
                  setScope(SCOPES.find((option) => option.id === next.filter) ?? SCOPES[0]);
                  setSort(sortParamsOf(next.sort, INCIDENT_SORT_FIELDS));
                  setPageNumber(1);
                }}
                hideCommandBar={false}
                pageInfo={pageInfoOf(data)}
                onShowDetails={(incident) => open(incident)}
                emptyState={{
                  title:
                    scope.id !== 'both' || filters.deviceId || filters.from
                      ? 'No results match your filters.'
                      : 'No unrouted or escalated incidents need attention.',
                  action:
                    scope.id !== 'both' || filters.deviceId || filters.from ? (
                      <Button
                        onClick={() => {
                          setFilters({});
                          setScope(SCOPES[0]);
                          setPageNumber(1);
                          document.getElementById('staff-incidents-title')?.focus();
                        }}
                      >
                        Reset filters
                      </Button>
                    ) : undefined,
                }}
                footer={
                  data && data.totalPages > 1 ? (
                    <Pagination
                      pageNumber={data.pageNumber}
                      totalPages={data.totalPages}
                      totalItems={data.totalCount}
                      pageSize={data.pageSize}
                      onPage={setPageNumber}
                    />
                  ) : undefined
                }
              />
            </div>
            {selected && (
              <div className="min-h-0 overflow-y-auto overscroll-contain">
                <StaffIncidentDetail
                  key={`${selected}-${startWithFalseAlarm}`}
                  id={selected}
                  startWithFalseAlarm={startWithFalseAlarm}
                  onBack={back}
                  onUnavailable={() => {
                    setSelected(null);
                    setSaved(null);
                    client.removeQueries({ queryKey: incidentKeys.detail(selected) });
                    void client.invalidateQueries({ queryKey: incidentKeys.all });
                    useToast.getState().show('You do not have access to this.');
                    requestAnimationFrame(() =>
                      document.getElementById('staff-incidents-title')?.focus(),
                    );
                  }}
                  onSaved={(code) => {
                    setSaved(code);
                    if (scope.id !== 'all') setSelected(null);
                    requestAnimationFrame(() =>
                      document
                        .getElementById(
                          scope.id === 'all' ? 'staff-incident-title' : 'staff-incidents-title',
                        )
                        ?.focus(),
                    );
                  }}
                />
              </div>
            )}
          </div>
        </TabPanel>
      )}
      {reportingId && (
        <ReportDialog
          entry={{ kind: 'incident', id: reportingId }}
          onClose={() => setReportingId(null)}
        />
      )}
    </section>
  );
};
