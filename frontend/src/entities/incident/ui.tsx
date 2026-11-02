import React from 'react';
import { Badge } from '../../shared/ui/bits';
import { CONFIDENCE_LABEL, INCIDENT_STATE } from '../../shared/ui/status';
import type { Incident } from './api';

// State with its text, plus the suspected, device-silent and simulated labels (screen 8.1; screen 7.5
// "Simulated badges elsewhere": neutral tone, the word itself, never colour alone).
export const StateBadges: React.FC<{ incident: Incident }> = ({ incident }) => (
  <span className="flex flex-wrap gap-1.5">
    <Badge tone={INCIDENT_STATE[incident.state].tone}>{INCIDENT_STATE[incident.state].label}</Badge>
    {incident.confidence === 'SUSPECTED' && (
      <Badge tone="attention">{CONFIDENCE_LABEL.SUSPECTED}</Badge>
    )}
    {incident.stale && <Badge tone="attention">Device silent</Badge>}
    {incident.simulated === true && <Badge>Simulated</Badge>}
  </span>
);
