import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  deadlineOf,
  SOURCE_LABEL,
  useFleetIncidents,
  useIncident,
  type Incident,
} from '../entities/incident/api';
import { isReportable } from '../entities/incident/authorityReports';
import { StateBadges } from '../entities/incident/ui';
import { AuthorityReportsPanel, ReportDialog } from '../widgets/AuthorityReports/AuthorityReports';
import { formatDateTime } from '../shared/lib/format';
import { Empty, ErrorState, Fact, Loading, PageTitle, Pager } from '../shared/ui/bits';
import { Button } from '../shared/ui/Button';
import { TabPanel, Tabs } from '../shared/ui/Tabs';
import type { IncidentState } from '../shared/ui/status';
import { CARD, LINK, TABLE, TD, TH, WARNING } from '../shared/ui/styles';

// Screen 8.2 disclaimer.
const STAFF_DISCLAIMER =
  'TrekLink records the incident and reports it to the authorities. TrekLink does not coordinate rescue operations.';

const SCOPES: { id: string; label: string; states: IncidentState[] }[] = [
  { id: 'both', label: 'Unrouted and escalated', states: ['UNROUTED', 'ESCALATED'] },
  { id: 'unrouted', label: 'Unrouted', states: ['UNROUTED'] },
  { id: 'escalated', label: 'Escalated', states: ['ESCALATED'] },
  { id: 'all', label: 'All incidents', states: [] },
];

const holderOf = (incident: Incident) => incident.device.holder?.name ?? 'No holder label';

type Tab = 'queue' | 'reports';

// The selected incident (api-design 02). Staff never acknowledge or act as an organization's
// response owner (screen 8.2 Roles); their one action is the authority report of screen 8.3, on an
// UNROUTED or ESCALATED incident.
const StaffIncidentDetail: React.FC<{ id: string; onBack: () => void }> = ({ id, onBack }) => {
  const { data: incident, isLoading, error, refetch, isFetching } = useIncident(id);
  const [reporting, setReporting] = useState(false);
  if (isLoading) return <Loading />;
  if (error || !incident) return <ErrorState error={error} onRetry={() => void refetch()} />;
  return (
    <section className={`${CARD} flex flex-col gap-4`} aria-labelledby="staff-incident-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="staff-incident-title" tabIndex={-1} className="text-title-sm text-ink">
          {incident.code}
        </h2>
        <StateBadges incident={incident} />
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Fact label="Device">{incident.device.assetTag ?? 'Unknown device'}</Fact>
        <Fact label="Holder">
          {incident.device.holder
            ? `${incident.device.holder.name}${incident.device.holder.phone ? `, ${incident.device.holder.phone}` : ''}`
            : 'No holder label'}
        </Fact>
        <Fact label="Owner">{incident.owner?.fullName ?? 'TrekLink Staff queue'}</Fact>
        <Fact label="Deadline">{deadlineOf(incident)}</Fact>
        <Fact label="Source">{SOURCE_LABEL[incident.source]}</Fact>
        <Fact label="Events">
          {incident.eventCount}
          {incident.reopenCount > 0 ? `, reopened ${incident.reopenCount} times` : ''}
        </Fact>
        <Fact label="In this state since">{formatDateTime(incident.stateChangedAt)}</Fact>
        <Fact label="Latest episode event">{formatDateTime(incident.lastEventAt)}</Fact>
        <Fact label="Last known coordinates">
          {incident.lastPosition
            ? `${incident.lastPosition.lat.toFixed(5)}, ${incident.lastPosition.lon.toFixed(5)}`
            : 'Position unavailable'}
        </Fact>
      </dl>
      <div className="flex flex-wrap gap-3">
        {incident.contractId && (
          <Link to={`/t/contracts/${incident.contractId}`} className={LINK}>
            View contract
          </Link>
        )}
        <Link to="/t/map" className={LINK}>
          Fleet map
        </Link>
      </div>
      {isReportable(incident) && (
        <div>
          <Button variant="primary" onClick={() => setReporting(true)}>
            Report to authorities
          </Button>
        </div>
      )}
      {reporting && (
        <ReportDialog
          entry={{ kind: 'incident', id: incident.id }}
          onClose={() => setReporting(false)}
        />
      )}
      <section aria-labelledby="staff-authority-reports">
        <h3 id="staff-authority-reports" className="mb-2 text-body font-semibold text-ink">
          Authority reports
        </h3>
        {incident.authorityReports.length === 0 ? (
          <p className="text-body text-ink-muted">No authority reports recorded.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {incident.authorityReports.map((report) => (
              <li key={report.id} className="break-words text-body text-ink">
                {report.agency}, {report.reference}, reported {formatDateTime(report.reportedAt)}
                {report.caseClosedAt
                  ? `, case closed ${formatDateTime(report.caseClosedAt)}`
                  : ', case open'}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="staff-status-history">
        <h3 id="staff-status-history" className="mb-2 text-body font-semibold text-ink">
          Status updates
        </h3>
        {incident.statusUpdates.length === 0 ? (
          <p className="text-body text-ink-muted">No status updates recorded.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {incident.statusUpdates.map((update) => (
              <li key={update.id}>
                <p className="text-body-sm text-ink-muted">
                  {update.author.fullName ?? 'A member'}, {formatDateTime(update.createdAt)}
                </p>
                <p className="whitespace-pre-wrap break-words text-body text-ink">{update.note}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => void refetch()} loading={isFetching}>
          Refresh detail
        </Button>
        <Button onClick={onBack}>Back to queue</Button>
      </div>
    </section>
  );
};

// /t/incidents, StaffIncidentsPage of screen 8.2: the unrouted and escalated queue with inline
// detail (api-design 01 and 02). Rows keep the server order (D-059 rule 7). Escalation is
// automatic; there are no manual Staff controls on this screen. The Authority reports tab is
// screen 8.3 (api-design 08 to 11).
export const StaffIncidentsPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('queue');
  const [scope, setScope] = useState(SCOPES[0]);
  const [pageNumber, setPageNumber] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement | null>());
  const { data, isLoading, error, refetch, isFetching } = useFleetIncidents(
    scope.states,
    pageNumber,
  );

  const back = () => {
    const id = selected;
    setSelected(null);
    if (id) triggers.current.get(id)?.focus();
  };

  return (
    <section aria-labelledby="staff-incidents-title">
      <PageTitle
        id="staff-incidents-title"
        title={scope.id === 'all' ? 'All incidents' : 'Incident queue'}
        action={
          <Button onClick={() => void refetch()} loading={isFetching && !isLoading}>
            Refresh
          </Button>
        }
      />
      <p className={`${WARNING} mb-4`}>{STAFF_DISCLAIMER}</p>

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
        <TabPanel idPrefix="staff-incidents" tabKey="reports">
          <AuthorityReportsPanel
            onViewIncident={(id) => {
              setSelected(id);
              setTab('queue');
            }}
          />
        </TabPanel>
      )}

      {tab === 'queue' && (
        <TabPanel idPrefix="staff-incidents" tabKey="queue">
          <div role="group" aria-label="Queue filter" className="mb-4 flex flex-wrap gap-2">
            {SCOPES.map((option) => (
              <Button
                key={option.id}
                variant={option.id === scope.id ? 'primary' : 'secondary'}
                aria-pressed={option.id === scope.id}
                onClick={() => {
                  setScope(option);
                  setPageNumber(1);
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className={selected ? 'hidden lg:block' : ''}>
              {isLoading && <Loading />}
              {error && <ErrorState error={error} onRetry={() => void refetch()} />}
              {data && data.items.length === 0 && (
                <Empty>
                  <p>
                    {scope.id === 'all'
                      ? 'No results match your filters.'
                      : 'No unrouted or escalated incidents need attention.'}
                  </p>
                </Empty>
              )}
              {data && data.items.length > 0 && (
                <>
                  <table className={TABLE}>
                    <thead>
                      <tr>
                        <th className={TH}>Code</th>
                        <th className={TH}>Device and holder</th>
                        <th className={TH}>State</th>
                        <th className={TH}>Latest event</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((incident) => (
                        <tr key={incident.id} aria-selected={incident.id === selected}>
                          <td className={TD}>
                            <button
                              type="button"
                              ref={(node) => {
                                triggers.current.set(incident.id, node);
                              }}
                              className={LINK}
                              onClick={() => setSelected(incident.id)}
                            >
                              {incident.code}
                            </button>
                          </td>
                          <td className={TD}>
                            {incident.device.assetTag ?? 'Unknown device'}, {holderOf(incident)}
                          </td>
                          <td className={TD}>
                            <StateBadges incident={incident} />
                          </td>
                          <td className={TD}>{formatDateTime(incident.lastEventAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pager
                    pageNumber={data.pageNumber}
                    totalPages={data.totalPages}
                    onPage={setPageNumber}
                  />
                </>
              )}
            </div>
            {selected && <StaffIncidentDetail key={selected} id={selected} onBack={back} />}
          </div>
        </TabPanel>
      )}
    </section>
  );
};
