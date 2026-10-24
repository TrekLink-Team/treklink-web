// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../shared/api/apiClient';
import type { LiveMessage } from '../shared/socket/socketClient';
import { AlertBanner } from './AlertBanner';

const listeners = new Set<(message: LiveMessage) => void>();
const push = (message: LiveMessage) => act(() => listeners.forEach((listener) => listener(message)));

vi.mock('../shared/socket/socketClient', () => ({
  isLivePaused: () => false,
  subscribeLive: (listener: (message: LiveMessage) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
}));

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
  listeners.clear();
});

describe('AlertBanner', () => {
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
    acknowledgeIncident.mockRejectedValue(new ApiError(409, 'ALREADY_OWNED', 'Tran B took this incident at 03:16.'));
    render(<AlertBanner />);
    push(entry('incident.alert', alertPayload));
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(screen.getByText('Tran B took this incident at 03:16.')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the banner and shows the message after any other failure', async () => {
    acknowledgeIncident.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'Internal server error'));
    render(<AlertBanner />);
    push(entry('incident.alert', alertPayload));
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(screen.getByText('Internal server error')).toBeTruthy());
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('removes the banner when the incident moves to a state nobody can acknowledge', () => {
    render(<AlertBanner />);
    push(entry('incident.alert', alertPayload));
    push(entry('incident.changed', { incidentId: 'inc-1', state: 'ACKNOWLEDGED' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
