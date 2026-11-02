import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '../../shared/api/apiClient';
import {
  demoMessageOf,
  fetchDemoAccounts,
  fetchDemoStatus,
  stageScenario,
  switchDemoRole,
} from './api';
import {
  fetchSimulation,
  raiseSimulatedEvent,
  startSimulatedNode,
  stopSimulatedNode,
  updateSimulatedNode,
} from './simulation';

vi.mock('../../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/api/apiClient')>()),
  apiClient: vi.fn(),
}));

const api = vi.mocked(apiClient);

describe('demo api (specs/demo api-design 01 to 05)', () => {
  afterEach(() => api.mockReset());

  it('reads demo mode off (a 404) as null and passes other failures on', async () => {
    api.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'Cannot GET /api/demo/status'));
    await expect(fetchDemoStatus()).resolves.toBeNull();
    api.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'boom'));
    await expect(fetchDemoStatus()).rejects.toThrow('boom');
  });

  it('reads the test accounts list from its public route', async () => {
    api.mockResolvedValueOnce({ accounts: [{ email: 'admin@treklink.local' }] });
    await expect(fetchDemoAccounts()).resolves.toEqual([{ email: 'admin@treklink.local' }]);
    expect(api).toHaveBeenCalledWith('/demo/accounts');
  });

  it('posts a stage and a role switch to their routes', async () => {
    api.mockResolvedValue(null);
    await stageScenario('term-ended');
    expect(api).toHaveBeenCalledWith('/demo/scenarios/term-ended/stage', { method: 'POST' });
    await switchDemoRole('ORG_OPERATOR');
    expect(api).toHaveBeenCalledWith('/demo/switch-role', {
      method: 'POST',
      body: JSON.stringify({ role: 'ORG_OPERATOR' }),
    });
  });

  it('shows the server message for a demo refusal and the fallback otherwise', () => {
    const fallback = () => 'fallback';
    expect(
      demoMessageOf(new ApiError(403, 'DEMO_DATABASE_NOT_LOCAL', 'Local only.'), fallback),
    ).toBe('Local only.');
    expect(demoMessageOf(new ApiError(403, 'FORBIDDEN', 'No.'), fallback)).toBe('fallback');
  });

  it('reads the simulation off (404) or not allowed (403) as null (api-design 06)', async () => {
    api.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'Cannot GET /api/demo/simulation'));
    await expect(fetchSimulation()).resolves.toBeNull();
    api.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'You do not have access to this.'));
    await expect(fetchSimulation()).resolves.toBeNull();
    api.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'boom'));
    await expect(fetchSimulation()).rejects.toThrow('boom');
  });

  it('sends the simulation writes to api-design 07 to 10 with the expected version', async () => {
    api.mockResolvedValue(null);
    await startSimulatedNode({ deviceId: 'd', trailId: 't', pattern: 'WALK' });
    expect(api).toHaveBeenLastCalledWith('/demo/simulation/nodes', {
      method: 'POST',
      body: JSON.stringify({ deviceId: 'd', trailId: 't', pattern: 'WALK' }),
    });
    await updateSimulatedNode({ id: 'n1', version: 2 }, { pattern: 'STRAY' });
    expect(api).toHaveBeenLastCalledWith('/demo/simulation/nodes/n1', {
      method: 'PATCH',
      body: JSON.stringify({ expectedVersion: 2, pattern: 'STRAY' }),
    });
    await stopSimulatedNode({ id: 'n1', version: 3 });
    expect(api).toHaveBeenLastCalledWith('/demo/simulation/nodes/n1/stop', {
      method: 'POST',
      body: JSON.stringify({ expectedVersion: 3 }),
    });
    await raiseSimulatedEvent({ id: 'n1' }, 'SOS_CANCEL');
    expect(api).toHaveBeenLastCalledWith('/demo/simulation/nodes/n1/events', {
      method: 'POST',
      body: JSON.stringify({ kind: 'SOS_CANCEL' }),
    });
  });
});
