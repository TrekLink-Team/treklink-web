import { apiClient } from '../../shared/api/apiClient';

// GET /api/incidents/:id (incidents api-design 02): only the version is needed to acknowledge.
const readVersion = async (incidentId: string): Promise<number> =>
  (await apiClient<{ version: number }>(`/incidents/${incidentId}`)).version;

// POST /api/incidents/:id/acknowledge (incidents api-design 03). The alert payload carries no version,
// so the banner reads it first. A POST is never retried after a network loss.
export const acknowledgeIncident = async (incidentId: string): Promise<void> => {
  const expectedVersion = await readVersion(incidentId);
  await apiClient(`/incidents/${incidentId}/acknowledge`, {
    method: 'POST',
    body: JSON.stringify({ expectedVersion }),
  });
};
