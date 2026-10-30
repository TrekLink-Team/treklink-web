// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncidentDetail } from '../../entities/incident/api';
import { ApiError } from '../../shared/api/apiClient';
import { StaffFalseAlarmDialog } from './StaffFalseAlarmDialog';

const api = vi.fn();
vi.mock('../../shared/api/apiClient', async (original) => ({
  ...(await original<typeof import('../../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));
const incident = {
  id: 'i-1',
  code: 'INC-1',
  state: 'UNROUTED',
  version: 4,
  device: { assetTag: 'TL-1' },
} as IncidentDetail;
const close = vi.fn();
const saved = vi.fn();
const unavailable = vi.fn();
const open = (row = incident) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <StaffFalseAlarmDialog
        incident={row}
        onClose={close}
        onSaved={saved}
        onUnavailable={unavailable}
      />
    </QueryClientProvider>,
  );
const typeReason = (value = 'Confirmed safe') =>
  fireEvent.change(screen.getByLabelText(/Reason/), { target: { value } });
const submit = () =>
  fireEvent.submit(screen.getByRole('button', { name: 'Declare false alarm' }).closest('form')!);
beforeEach(() => {
  api.mockReset();
  close.mockReset();
  saved.mockReset();
  unavailable.mockReset();
});
afterEach(cleanup);

describe('Staff false alarm dialog', () => {
  it('names the incident/device and validates a trimmed reason', async () => {
    open();
    expect(screen.getByRole('dialog').textContent).toContain('INC-1 on TL-1');
    typeReason('  ');
    submit();
    expect(await screen.findByText('reason is required.')).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
    typeReason(' Confirmed safe ');
    api.mockResolvedValue({});
    submit();
    await waitFor(() => expect(saved).toHaveBeenCalledWith('INC-1'));
    expect(api).toHaveBeenCalledWith('/incidents/i-1/false-alarm', {
      method: 'POST',
      body: JSON.stringify({ expectedVersion: 4, reason: 'Confirmed safe' }),
    });
  });

  it('cancels an empty form and confirms discarding a dirty reason with Escape', () => {
    open({ ...incident, device: { ...incident.device, assetTag: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledTimes(1);
    typeReason();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText(/Reason/) as HTMLTextAreaElement).value).toBe('Confirmed safe');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard reason' }));
    expect(close).toHaveBeenCalledTimes(2);
    expect(api).not.toHaveBeenCalled();
  });

  it('blocks duplicate submits and Escape while saving', async () => {
    let resolve!: (value: object) => void;
    api.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    open();
    typeReason();
    submit();
    submit();
    const reason = screen.getByLabelText(/Reason/) as HTMLTextAreaElement;
    expect(reason.readOnly).toBe(true);
    expect(document.activeElement).toBe(reason);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(reason);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(close).not.toHaveBeenCalled();
    expect(api).toHaveBeenCalledTimes(1);
    resolve({});
    await waitFor(() => expect(saved).toHaveBeenCalled());
  });

  it.each([
    new ApiError(409, 'STALE_VERSION', 'This was changed by someone else. Reload and try again.'),
    new ApiError(400, 'VALIDATION_FAILED', 'reason is required.'),
    new Error('Network lost'),
  ])('preserves the draft and explicitly reloads before retrying: %s', async (error) => {
    api
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ ...incident, version: 7 })
      .mockResolvedValueOnce({});
    open();
    typeReason();
    submit();
    await screen.findByRole('alert');
    expect((screen.getByLabelText(/Reason/) as HTMLTextAreaElement).value).toBe('Confirmed safe');
    submit();
    expect(api).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reload incident' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Reload incident' })).toBeNull(),
    );
    submit();
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(JSON.parse(api.mock.calls[2][1].body)).toEqual({
      expectedVersion: 7,
      reason: 'Confirmed safe',
    });
  });

  it.each([403, 404])('removes the submit after %s', async (status) => {
    api.mockRejectedValue(new ApiError(status, 'FORBIDDEN', 'Denied'));
    open();
    typeReason();
    submit();
    expect(await screen.findByText('You do not have access to this.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Declare false alarm' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reload incident' })).toBeNull();
    expect(unavailable).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft but removes submit when a live update changes the state', () => {
    const view = open();
    typeReason();
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <StaffFalseAlarmDialog
          incident={{ ...incident, state: 'REPORTED', version: 5 }}
          onClose={close}
          onSaved={saved}
          onUnavailable={unavailable}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Declare false alarm' })).toBeNull();
    expect(screen.getByText('This cannot be done while it is Reported to authority.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload incident' })).toBeTruthy();
    expect((screen.getByLabelText(/Reason/) as HTMLTextAreaElement).value).toBe('Confirmed safe');
    expect(api).not.toHaveBeenCalled();
  });

  it('keeps the reason when reload finds a changed state, and handles a failed reload', async () => {
    api
      .mockRejectedValueOnce(new ApiError(409, 'INVALID_STATE_TRANSITION', 'State changed'))
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({ ...incident, state: 'REPORTED', version: 5 });
    open();
    typeReason();
    submit();
    fireEvent.click(await screen.findByRole('button', { name: 'Reload incident' }));
    await screen.findByText('Something went wrong. Please try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Reload incident' }));
    await screen.findByText('This cannot be done while it is Reported to authority.');
    expect(screen.queryByRole('button', { name: 'Declare false alarm' })).toBeNull();
    expect((screen.getByLabelText(/Reason/) as HTMLTextAreaElement).value).toBe('Confirmed safe');
  });
});
