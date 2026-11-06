import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { deadlineOf, SOURCE_LABEL, useIncident } from '../../entities/incident/api';
import { isReportable } from '../../entities/incident/authorityReports';
import { StateBadges } from '../../entities/incident/ui';
import { useSession } from '../../entities/session/model';
import { hasAnyRole } from '../../shared/lib/permissions';
import { useMediaQuery } from '../../shared/lib/useMediaQuery';
import { formatDateTime } from '../../shared/lib/format';
import { ApiError } from '../../shared/api/apiClient';
import { ErrorState, Fact, Loading } from '../../shared/ui/bits';
import { Button } from '../../shared/ui/Button';
import { PageHeader } from '../../shared/ui/PageHeader';
import { StickyPageHeader, PageScrollBody } from '../../shared/ui/PageChrome';
import { RecordActionBar, type RecordAction } from '../../shared/ui/RecordActionBar';
import { CARD, LINK, WARNING } from '../../shared/ui/styles';
import { ReportDialog } from '../AuthorityReports/AuthorityReports';
import { StaffFalseAlarmDialog } from '../IncidentActions/StaffFalseAlarmDialog';
import { IncidentEpisode } from '../IncidentHistory/IncidentEpisode';
import { AlertLog, TransitionTrail } from '../IncidentHistory/IncidentHistory';

export const StaffDisclaimer: React.FC = () => (
  <p className={`${WARNING} mb-4`}>
    TrekLink records the incident and reports it to the authorities. TrekLink does not coordinate
    rescue operations.
  </p>
);

// The selected incident (api-design 02). Staff never acknowledge or act as an organization's
// response owner (screen 8.2 Roles). They may report to authorities or declare UNROUTED false.
/**
 * The record body: on the incident page it is the one scroll region under the pinned title, with
 * the phone action bar below it (ui standard §7); beside the queue it is plain content.
 */
const IncidentBody: React.FC<{ page?: boolean; children: React.ReactNode }> = ({ page, children }) =>
  page ? (
    <PageScrollBody label="Incident details" className="flex flex-col gap-4">
      {children}
    </PageScrollBody>
  ) : (
    <>{children}</>
  );

export const StaffIncidentDetail: React.FC<{
  id: string;
  onBack: () => void;
  onSaved: (code: string) => void;
  onUnavailable: () => void;
  /** Opened from the row's Declare false alarm (W29): the dialog opens with the detail. */
  startWithFalseAlarm?: boolean;
  page?: boolean;
}> = ({ id, onBack, onSaved, onUnavailable, startWithFalseAlarm = false, page = false }) => {
  const { data: incident, isLoading, error, refetch, isFetching } = useIncident(id);
  const [reporting, setReporting] = useState(false);
  const [falseAlarm, setFalseAlarm] = useState(startWithFalseAlarm);
  const wide = useMediaQuery('(min-width: 600px)', true);
  const user = useSession((state) => state.user);
  useEffect(() => {
    if (error instanceof ApiError && (error.statusCode === 403 || error.statusCode === 404))
      onUnavailable();
  }, [error, onUnavailable]);
  useEffect(() => {
    if (page) document.getElementById('staff-incident-title')?.focus();
  }, [page, incident?.id]);
  if (isLoading) return <Loading />;
  if (error instanceof ApiError && (error.statusCode === 403 || error.statusCode === 404))
    return null;
  if (!incident) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const SectionHeading = page ? 'h2' : 'h3';
  const actions: RecordAction[] = [
    ...(isReportable(incident)
      ? [
          {
            key: 'report',
            label: 'Report to authorities',
            tone: 'primary' as const,
            onSelect: () => setReporting(true),
          },
        ]
      : []),
    ...(incident.state === 'UNROUTED' && user && hasAnyRole(user.roles, ['STAFF'])
      ? [
          {
            key: 'false-alarm',
            label: 'Declare false alarm',
            tone: 'danger' as const,
            onSelect: () => setFalseAlarm(true),
          },
        ]
      : []),
    {
      key: 'refresh',
      label: 'Refresh detail',
      loading: isFetching,
      onSelect: () => {
        void refetch();
      },
    },
    { key: 'back', label: 'Back to queue', onSelect: onBack },
  ];
  return (
    <section
      data-fit-page={page ? '' : undefined}
      className={`${page ? 'min-h-0 min-w-0 flex-1' : CARD} flex flex-col gap-4`}
      aria-labelledby="staff-incident-title"
    >
      {page && (
        <>
          <StickyPageHeader>
            <PageHeader
              id="staff-incident-title"
              title={incident.code}
              meta={<StateBadges incident={incident} />}
            />
            {wide && <RecordActionBar label="Incident actions" actions={actions} />}
          </StickyPageHeader>
          <StaffDisclaimer />
        </>
      )}
      <IncidentBody page={page}>
        {error && <ErrorState error={error} onRetry={() => void refetch()} />}
        {!page && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="staff-incident-title" tabIndex={-1} className="text-title-sm text-ink">
              {incident.code}
            </h2>
            <StateBadges incident={incident} />
          </div>
        )}
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
          {page && <Fact label="First event">{formatDateTime(incident.firstEventAt)}</Fact>}
          {page && incident.outcomeNote && <Fact label="Outcome">{incident.outcomeNote}</Fact>}
        </dl>
        <IncidentEpisode
          incidentId={incident.id}
          onLostAccess={refetch}
          headingLevel={page ? 2 : 3}
        />
        <div className="flex flex-wrap gap-3">
          {!page && (
            <Link to={`/t/incidents/${incident.id}`} className={LINK}>
              Open incident page
            </Link>
          )}
          {page && incident.organizationId && (
            <Link to={`/t/organizations/${incident.organizationId}`} className={LINK}>
              View organization
            </Link>
          )}
          {incident.contractId && (
            <Link to={`/t/contracts/${incident.contractId}`} className={LINK}>
              View contract
            </Link>
          )}
          <Link to="/t/map" className={LINK}>
            Fleet map
          </Link>
        </div>
        {!page && isReportable(incident) && (
          <div>
            <Button variant="primary" onClick={() => setReporting(true)}>
              Report to authorities
            </Button>
          </div>
        )}
        {reporting && (
          <ReportDialog
            entry={{ kind: 'incident', id: incident.id }}
            protectNavigation
            onClose={() => setReporting(false)}
          />
        )}
        {!page && incident.state === 'UNROUTED' && user && hasAnyRole(user.roles, ['STAFF']) && (
          <Button variant="danger" onClick={() => setFalseAlarm(true)}>
            Declare false alarm
          </Button>
        )}
        {falseAlarm && (
          <StaffFalseAlarmDialog
            incident={incident}
            onClose={() => setFalseAlarm(false)}
            onUnavailable={onUnavailable}
            onSaved={(code) => {
              setFalseAlarm(false);
              onSaved(code);
            }}
          />
        )}
        <section aria-labelledby="staff-authority-reports">
          <SectionHeading
            id="staff-authority-reports"
            className="mb-2 text-body font-semibold text-ink"
          >
            Authority reports
          </SectionHeading>
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
          <SectionHeading id="staff-status-history" className="mb-2 text-body font-semibold text-ink">
            Status updates
          </SectionHeading>
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
        <TransitionTrail incidentId={incident.id} onLostAccess={refetch} headingLevel={page ? 2 : 3} />
        <AlertLog incidentId={incident.id} onLostAccess={refetch} headingLevel={page ? 2 : 3} />
      </IncidentBody>
      {page && !wide && <RecordActionBar label="Incident actions" actions={actions} />}
      {!page && (
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => void refetch()} loading={isFetching}>
            Refresh detail
          </Button>
          <Button onClick={onBack}>Back to queue</Button>
        </div>
      )}
    </section>
  );
};
