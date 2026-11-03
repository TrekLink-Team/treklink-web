// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../shared/api/apiClient';
import { IncidentEpisode } from './IncidentEpisode';

const api = vi.fn();
vi.mock('../../shared/api/apiClient', async (original) => ({
  ...(await original<typeof import('../../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));
beforeEach(() => { api.mockReset(); });
afterEach(cleanup);
const mount = (onLostAccess = vi.fn()) => {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <MemoryRouter>
        <IncidentEpisode incidentId="inc-1" onLostAccess={onLostAccess} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onLostAccess;
};

describe('API 13 episode evidence', () => {
  it('loads the incident-only array and keeps server order, timestamps, coordinates and Fleet map route', async () => {
    api.mockResolvedValue([
      {
        eventId: 'first',
        kind: 'POSITION',
        observedAt: '2026-11-03T03:00:00Z',
        latitude: 0,
        longitude: 108,
      },
      { eventId: 'second', kind: 'SOS', observedAt: null, latitude: null, longitude: null },
      { eventId: 'third', kind: 'FALL_SOS', observedAt: null, latitude: 11, longitude: null },
    ]);
    mount();
    expect(await screen.findByText('POSITION')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('/incidents/inc-1/events');
    const rows = screen.getAllByRole('listitem');
    expect(rows[0].textContent).toContain('POSITION');
    expect(rows[1].textContent).toContain('SOS');
    expect(rows[2].textContent).toContain('FALL_SOS');
    expect(screen.getByText('0.00000, 108.00000')).toBeTruthy();
    expect(screen.getAllByText('Position unavailable')).toHaveLength(2);
    expect(screen.getAllByText('Time unavailable')).toHaveLength(2);
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-03T03:00:00Z');
    expect(screen.getByRole('link', { name: 'Fleet map' }).getAttribute('href')).toBe('/t/map');
  });
  it('shows loading until the request settles, then an empty result', async () => {
    let finish!: (value: never[]) => void;
    api.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mount();
    expect(screen.getByText('Loading episode evidence…')).toBeTruthy();
    finish([]);
    expect(await screen.findByText('No events recorded for this episode.')).toBeTruthy();
  });
  it('retries an independent panel failure', async () => {
    api.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /try again|retry/i }));
    expect(await screen.findByText('No events recorded for this episode.')).toBeTruthy();
    expect(api).toHaveBeenCalledTimes(2);
  });
  it.each([403, 404])(
    'hides inaccessible evidence for %s; only a 404 rechecks main access',
    async (status) => {
      api.mockRejectedValue(
        new ApiError(status, status === 403 ? 'FORBIDDEN' : 'NOT_FOUND', 'No access'),
      );
      const lost = mount();
      await waitFor(() => expect(screen.queryByText('Episode evidence')).toBeNull());
      expect(lost).toHaveBeenCalledTimes(status === 404 ? 1 : 0);
    },
  );
});
