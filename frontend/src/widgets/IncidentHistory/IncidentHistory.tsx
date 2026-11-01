import React, { useEffect } from 'react';
import {
  REASON_LABEL,
  useIncidentAlerts,
  useIncidentTransitions,
  type AlertDelivery,
} from '../../entities/incident/api';
import { ApiError } from '../../shared/api/apiClient';
import { formatDateTime } from '../../shared/lib/format';
import { Badge, ErrorState, Loading } from '../../shared/ui/bits';
import { Button } from '../../shared/ui/Button';
import { INCIDENT_STATE } from '../../shared/ui/status';
import { CARD } from '../../shared/ui/styles';

// Screen 8.1 evidence panels. Each panel fails on its own: a 403 hides it, a 404 asks the page to
// recheck the main record, any other failure offers a retry, and the rest of the page stays.
interface PanelProps {
  incidentId: string;
  onLostAccess: () => void;
}

const statusOf = (error: unknown): number | null =>
  error instanceof ApiError ? error.statusCode : null;

const usePanelAccess = (error: unknown, onLostAccess: () => void) => {
  const status = statusOf(error);
  useEffect(() => {
    if (status === 404) onLostAccess();
  }, [status, onLostAccess]);
  return status === 403 || status === 404;
};

// api-design 12: the transition trail in sequence order; a null origin means the incident was created.
export const TransitionTrail: React.FC<PanelProps> = ({ incidentId, onLostAccess }) => {
  const { data, isLoading, error, refetch } = useIncidentTransitions(incidentId);
  const hidden = usePanelAccess(error, onLostAccess);
  if (hidden) return null;

  return (
    <section className={CARD} aria-labelledby="transition-trail">
      <h2 id="transition-trail" className="mb-3 text-title-sm text-ink">
        History
      </h2>
      {isLoading ? (
        <Loading label="Loading history…" />
      ) : error || !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <p className="text-body text-ink-muted">No history recorded.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {data.map((row) => (
            <li key={row.seq}>
              <p className="text-body text-ink">
                {row.fromState === null
                  ? `Created as ${INCIDENT_STATE[row.toState].label}`
                  : `${INCIDENT_STATE[row.fromState].label} to ${INCIDENT_STATE[row.toState].label}`}
              </p>
              <p className="text-body-sm text-ink-muted">
                {REASON_LABEL[row.reason] ?? row.reason}, by{' '}
                {row.actor === 'SYSTEM' ? 'the system' : row.actor}, {formatDateTime(row.createdAt)}
              </p>
              {row.note && (
                <p className="mt-1 whitespace-pre-wrap break-words text-body text-ink">
                  {row.note}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

const CHANNEL_LABEL: Record<AlertDelivery['channel'], string> = {
  WEB: 'Web inbox',
  WEBSOCKET: 'Live alert',
  EMAIL: 'Email',
  API_EVENT: 'API event',
};

const STATUS_TONE: Record<AlertDelivery['status'], string> = {
  SENT: 'done',
  PENDING: 'attention',
  FAILED: 'critical',
};

const STATUS_LABEL: Record<AlertDelivery['status'], string> = {
  SENT: 'Sent',
  PENDING: 'Pending',
  FAILED: 'Failed',
};

// api-design 14, Org Manager only. No push announces a delivery retry, so the log has its own
// Refresh. A failed delivery never means the incident failed to move.
export const AlertLog: React.FC<PanelProps> = ({ incidentId, onLostAccess }) => {
  const { data, isLoading, isFetching, error, refetch } = useIncidentAlerts(incidentId, true);
  const hidden = usePanelAccess(error, onLostAccess);
  if (hidden) return null;

  return (
    <section className={CARD} aria-labelledby="alert-log">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="alert-log" className="text-title-sm text-ink">
          Alert deliveries
        </h2>
        <Button size="sm" loading={isFetching && !isLoading} onClick={() => void refetch()}>
          Refresh
        </Button>
      </div>
      {isLoading ? (
        <Loading label="Loading alert deliveries…" />
      ) : error || !data ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <p className="text-body text-ink-muted">No alerts sent for this incident.</p>
      ) : (
        <>
          <ol className="flex flex-col gap-3">
            {data.map((row, index) => (
              <li key={index} className="flex flex-col gap-1">
                <p className="flex flex-wrap items-center gap-2 text-body text-ink">
                  <span>
                    {row.kind === 'STALE' ? 'Device silent, ' : ''}
                    {row.tier}, {row.recipient ?? 'Organization API stream'},{' '}
                    {CHANNEL_LABEL[row.channel]}
                  </span>
                  <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                </p>
                <p className="break-words text-body-sm text-ink-muted">
                  {row.attempts} {row.attempts === 1 ? 'attempt' : 'attempts'}
                  {row.sentAt ? `, sent ${formatDateTime(row.sentAt)}` : ''}
                  {row.lastError ? `, last error: ${row.lastError}` : ''}
                </p>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-body-sm text-ink-muted">
            A failed delivery does not undo the incident's state change.
          </p>
        </>
      )}
    </section>
  );
};
