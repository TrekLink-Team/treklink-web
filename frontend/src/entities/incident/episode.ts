import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';

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
