import React from 'react';
import { Link } from 'react-router-dom';
import { useIncidents } from '../../entities/incident/api';
import { formatDateTime } from '../../shared/lib/format';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  INCIDENT_STATE,
  Skeleton,
  StatusBadge,
} from '../../shared/ui';
import { messageOf } from '../../shared/ui/errors';
import { LINK } from '../../shared/ui/styles';

// The `IncidentQueue` widget of screen 5.6 (frontend design §1): the organization's open incidents
// from incidents api-design 01 with `open=true`, five rows, each opening screen 8.1. It uses the
// `['incidents', ...]` key, so `incident.changed` refreshes it. Its loading, error and empty states
// are its own, so a failed read never looks like an empty queue.
export const IncidentQueue: React.FC = () => {
  const incidents = useIncidents({ open: true });
  const items = incidents.data?.items ?? [];

  return (
    <Card>
      <CardHeader
        title="Open incidents"
        action={
          <Link to="/o/incidents" className={LINK}>
            All incidents
          </Link>
        }
      />
      {incidents.isLoading ? (
        <Skeleton className="h-20" />
      ) : incidents.error ? (
        <Alert
          tone="error"
          action={
            <Button size="sm" onClick={() => void incidents.refetch()}>
              Try again
            </Button>
          }
        >
          {messageOf(incidents.error)}
        </Alert>
      ) : items.length === 0 ? (
        <p className="text-body text-ink-muted">No open incidents.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {items.slice(0, 5).map((incident) => (
            <li key={incident.id} className="flex flex-col gap-1 py-2">
              <span className="flex items-center justify-between gap-3">
                <Link to={`/o/incidents/${incident.id}`} className={LINK}>
                  {incident.code}
                </Link>
                <StatusBadge entry={INCIDENT_STATE[incident.state]} />
              </span>
              <span className="text-body-sm text-ink-muted">
                {incident.device.assetTag ?? 'Unknown device'}
                {incident.device.holder ? `, ${incident.device.holder.name}` : ''}, since{' '}
                {formatDateTime(incident.firstEventAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};
