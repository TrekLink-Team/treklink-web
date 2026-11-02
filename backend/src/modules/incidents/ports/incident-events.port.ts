import { EventKind } from '@prisma/client';

// R2-b, issue #118: incidents owns the read contract; gateway-sync owns FieldEvent storage.
export const INCIDENT_EVENTS = Symbol('INCIDENT_EVENTS');

export interface EpisodeEvent {
  eventId: string;
  kind: EventKind;
  observedAt: Date | null;
  latitude: number | null;
  longitude: number | null;
}

// An absent organization filter is reserved for an unconditioned read Incident ability.
export interface IncidentEventScope {
  organizationId?: string;
}

export interface IncidentEvents {
  eventsOfIncident(incidentId: string, scope: IncidentEventScope): Promise<EpisodeEvent[]>;
}
