import React from 'react';
import { Siren } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useFleetIncidents, type Incident } from '../../entities/incident/api';
import { formatDateTime } from '../../shared/lib/format';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  CollectionView,
  INCIDENT_STATE,
  Skeleton,
  StatusBadge,
  type CollectionField,
} from '../../shared/ui';
import { messageOf } from '../../shared/ui/errors';
import type { IncidentState } from '../../shared/ui/status';
import { LINK } from '../../shared/ui/styles';

// The `IncidentQueue` widget of screen 5.6 (frontend design §1): the organization's open incidents
// from incidents api-design 01 filtered to the states that need action, five rows, each opening screen 8.1. It uses the
// `['incidents', ...]` key, so `incident.changed` refreshes it. Its loading, error and empty states
// are its own, so a failed read never looks like an empty queue. The rows render through CollectionView
// (chapter 06 §9, D-096) in its list view, without a command bar.
// Every state that still needs someone. `open=true` would also return RESOLVED and FALSE_ALARM (they stay
// open until CLOSED because they may reopen), and filtering them out after the server's page could hide
// an older incident that still needs action (Codex review, 2026-10-31). The server filters by state.
const ACTIONABLE: readonly IncidentState[] = [
  'DETECTED',
  'NOTIFY_PRIMARY',
  'NOTIFY_BACKUP',
  'NOTIFY_MANAGER',
  'UNROUTED',
  'ESCALATED',
  'REPORTED',
  'ACKNOWLEDGED',
  'RESPONDING',
];

const deviceText = (incident: Incident) =>
  `${incident.device.assetTag ?? 'Unknown device'}${incident.device.holder ? `, ${incident.device.holder.name}` : ''}`;

// A short state badge with the start time as muted text beside it (handoff item 12), then the device.
const FIELDS: CollectionField<Incident>[] = [
  {
    key: 'state',
    label: 'State',
    render: (incident) => (
      <StatusBadge entry={INCIDENT_STATE[incident.state]} after={`since ${formatDateTime(incident.firstEventAt)}`} />
    ),
    text: (incident) => INCIDENT_STATE[incident.state].label,
    compact: true,
  },
  { key: 'device', label: 'Device', render: deviceText, compact: true },
];

export const IncidentQueue: React.FC = () => {
  const incidents = useFleetIncidents(ACTIONABLE, 1);
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
        <CollectionView<Incident>
          icon={<Siren />}
          label="Open incidents"
          items={items.slice(0, 5)}
          itemId={(incident) => incident.id}
          itemName={(incident) => incident.code}
          itemHref={(incident) => `/o/incidents/${incident.id}`}
          fields={FIELDS}
          noun={{ one: 'incident', other: 'incidents' }}
          details={false}
          hideCommandBar
          emptyState={{ title: 'No open incidents.' }}
        />
      )}
    </Card>
  );
};
