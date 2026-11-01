// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import type { LiveMessage } from '../shared/socket/socketClient';
import { AlertBanner } from './AlertBanner';

const listeners = new Set<(message: LiveMessage) => void>();
const push = (message: LiveMessage) =>
  act(() => listeners.forEach((listener) => listener(message)));

const poll = vi.hoisted(() => ({ on: false }));
vi.mock('../shared/socket/socketClient', () => ({
  LIVE_POLL_MS: 15_000,
  livePolls: () => poll.on,
  isLivePaused: () => false,
  subscribeLive: (listener: (message: LiveMessage) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
}));

const fetchIncidents = vi.fn();
const fetchFleetIncidents = vi.fn();
vi.mock('../entities/incident/api', () => ({
  fetchIncidents: (filters: unknown) => fetchIncidents(filters),
  fetchFleetIncidents: (states: unknown, page: unknown) => fetchFleetIncidents(states, page),
}));

const incident = (state: string, owner: unknown = null) => ({
  id: `inc-${state}`,
  code: 'INC-2026-000002',
  device: { id: 'd-9', assetTag: 'TL-0009', holder: { name: 'Le Thi E', phone: null } },
  state,
  source: 'DEVICE_SOS',
  firstEventAt: '2026-11-01T08:47:00.000Z',
  owner,
});

const acknowledgeIncident = vi.fn();
vi.mock('../features/acknowledge-incident/api', () => ({
  acknowledgeIncident: (id: string) => acknowledgeIncident(id),
}));

const entry = (type: string, payload: Record<string, unknown>): LiveMessage => ({
  kind: 'entry',
  entry: { seq: 1, type, payload, createdAt: '2026-10-24T03:15:00.000Z' },
});

const alertPayload = {
  incidentId: 'inc-1',
  deviceLabel: 'TL-0042',
  holderName: 'Le Thi E',
  at: '2026-10-24T03:15:00.000Z',
};

afterEach(() => {
  cleanup();
  acknowledgeIncident.mockReset();
  fetchIncidents.mockReset();
  fetchFleetIncidents.mockReset();
  listeners.clear();
  poll.on = false;
});

describe('AlertBanner in poll mode (D-089, no socket)', () => {
  it('shows MSG31 for an unacknowledged NOTIFY_ incident of the organization and acknowledges it', async () => {
    poll.on = true;
    fetchIncidents.mockResolvedValue({
      items: [incident('NOTIFY_BACKUP'), incident('ACKNOWLEDGED', { id: 'u-1', fullName: 'Op' })],
    });
    acknowledgeIncident.mockResolvedValue(undefined);
    render(<AlertBanner />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('SOS: TL-0009 (Le Thi E)');
    expect(alert.textContent).not.toContain('more');
    expect(fetchIncidents).toHaveBeenCalledWith({ open: true });
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(acknowledgeIncident).toHaveBeenCalledWith('inc-NOTIFY_BACKUP');
  });

  it('shows Staff the unrouted and escalated incidents with a link to the queue', async () => {
    poll.on = true;
    fetchFleetIncidents.mockResolvedValue({ items: [incident('UNROUTED')] });
    render(
      <MemoryRouter>
        <AlertBanner staff />
      </MemoryRouter>,
    );
    expect((await screen.findByRole('alert')).textContent).toContain('TL-0009');
    expect(fetchFleetIncidents).toHaveBeenCalledWith(['UNROUTED', 'ESCALATED'], 1);
    expect(screen.getByRole('link', { name: 'Open queue' })).toBeTruthy();
  });

  it('reads nothing while the socket is the transport', () => {
    render(<AlertBanner />);
    expect(fetchIncidents).not.toHaveBeenCalled();
  });
});

describe('AlertBanner', () => {
  it('replaces a duplicate incident alert, so acknowledging it leaves no duplicate banner', async () => {
    acknowledgeIncident.mockResolvedValue(undefined);
    render(<AlertBanner />);
    push(entry('incident.alert', alertPayload));
    push(entry('incident.alert', { ...alertPayload, deviceLabel: 'Updated label' }));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toContain('Updated label');
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(acknowledgeIncident).toHaveBeenCalledTimes(1);
  });
  it('shows MSG32 while the socket is paused and clears it on resume (REQ-EVT-03)', () => {
    render(<AlertBanner />);
    push({ kind: 'paused', paused: true });
    expect(screen.getByRole('status').textContent).toBe('Reconnecting. Live data is paused.');
    push({ kind: 'paused', paused: false });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the MSG31 banner with a one-tap Acknowledge of at least 44 px (AC-02)', () => {
    render(<AlertBanner />);
    push(entry('incident.alert', alertPayload));
    expect(screen.getByRole('alert').textContent).toContain('SOS: TL-0042 (Le Thi E)');
    expect(screen.getByRole('alert').textContent).toContain('Acknowledge now.');
    expect(screen.getByRole('button', { name: 'Acknowledge' }).className).toContain('min-h-11');
  });

  it('leaves out a null holder label rather than printing it', () => {
    render(<AlertBanner />);
    push(entry('incident.alert', { ...alertPayload, deviceLabel: 'TL-0010', holderName: null }));
    expect(screen.getByRole('alert').textContent).toMatch(
      /^SOS: TL-0010, [^()]+\. Acknowledge now\./,
    );
  });

  it('offers TrekLink Staff the queue instead of Acknowledge (screen 8.2)', () => {
    render(
      <MemoryRouter>
        <AlertBanner staff />
      </MemoryRouter>,
    );
    push(entry('incident.alert', alertPayload));
    expect(screen.getByRole('link', { name: 'Open queue' }).getAttribute('href')).toBe(
      '/t/incidents',
    );
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
  });

  it('acknowledges, confirms with MSG03 and removes the banner', async () => {
    acknowledgeIncident.mockResolvedValue(undefined);
    render(<AlertBanner />);
    push(entry('incident.alert', alertPayload));
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(acknowledgeIncident).toHaveBeenCalledWith('inc-1');
    expect(screen.getByText('Saved.')).toBeTruthy();
  });

  it('shows the server message (MSG27) and removes the banner when another member took it', async () => {
    acknowledgeIncident.mockRejectedValue(
      new ApiError(409, 'ALREADY_OWNED', 'Tran B took this incident at 03:16.'),
    );
    render(<AlertBanner />);
    push(entry('incident.alert', alertPayload));
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() =>
      expect(screen.getByText('Tran B took this incident at 03:16.')).toBeTruthy(),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the banner and shows the message after any other failure', async () => {
    acknowledgeIncident.mockRejectedValue(
      new ApiError(500, 'INTERNAL_ERROR', 'Internal server error'),
    );
    render(<AlertBanner />);
    push(entry('incident.alert', alertPayload));
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(screen.getByText('Internal server error')).toBeTruthy());
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('keeps the banner on STALE_VERSION so the next tap reads a fresh version (MSG36)', async () => {
    acknowledgeIncident.mockRejectedValue(
      new ApiError(409, 'STALE_VERSION', 'Another user changed this incident first.'),
    );
    render(<AlertBanner />);
    push(entry('incident.alert', alertPayload));
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() =>
      expect(screen.getByText('Another user changed this incident first.')).toBeTruthy(),
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Acknowledge' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('removes the banner when the incident moves to a state nobody can acknowledge', () => {
    render(<AlertBanner />);
    push(entry('incident.alert', alertPayload));
    push(entry('incident.changed', { incidentId: 'inc-1', state: 'ACKNOWLEDGED' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
