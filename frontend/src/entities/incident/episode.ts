import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';

// Same wire kinds as gateway-sync's FieldEventRow; no cross-entity runtime dependency.
export type EpisodeEventKind = 'TEXT' | 'POSITION' | 'TELEMETRY' | 'SOS' | 'FALL_SOS' | 'CHAT';

export const EPISODE_EVENT_LABELS: Record<EpisodeEventKind, string> = {
  FALL_SOS: 'Fall SOS',
  SOS: 'SOS button',
  POSITION: 'Position',
  TELEMETRY: 'Telemetry',
  TEXT: 'Text',
  CHAT: 'Chat',
};

export const episodeEventLabel = (kind: string): string =>
  Object.hasOwn(EPISODE_EVENT_LABELS, kind) ? EPISODE_EVENT_LABELS[kind as EpisodeEventKind] : kind;

export interface EpisodeEvent {
  eventId: string;
  kind: string;
  observedAt: string | null;
  latitude: number | null;
  longitude: number | null;
}

// API 13 is an ordered array, scoped by the server. Never substitute current-device history.
export const useEpisodeEvents = (id: string) =>
  useQuery({
    queryKey: ['incident', id, 'events'],
    queryFn: () => apiClient<EpisodeEvent[]>(`/incidents/${id}/events`),
  });
