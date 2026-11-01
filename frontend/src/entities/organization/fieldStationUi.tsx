import React from 'react';
import { formatDate } from '../../shared/lib/format';
import { Badge } from '../../shared/ui';
import type { FieldStation } from './fieldStations';

// Cells of a Field Station row (screen 3.5), shared by the organization's page and the TrekLink view.

export const queueText = (station: FieldStation) =>
  station.queueDepth
    ? `${station.queueDepth.p0} / ${station.queueDepth.p1} / ${station.queueDepth.p2} / ${station.queueDepth.p3}`
    : 'No data yet';

export const VersionCell: React.FC<{ station: FieldStation }> = ({ station }) => (
  <span className="flex flex-wrap items-center gap-2">
    <span className="font-mono">{station.version ?? 'Not reported'}</span>
    {!station.revokedAt &&
      (station.outdated ? <Badge tone="attention">Outdated</Badge> : <Badge tone="done">Current</Badge>)}
  </span>
);

export const StatusCell: React.FC<{ station: FieldStation }> = ({ station }) =>
  station.revokedAt ? (
    <Badge tone="ended">Revoked {formatDate(station.revokedAt)}</Badge>
  ) : (
    <Badge tone="active">Active</Badge>
  );
