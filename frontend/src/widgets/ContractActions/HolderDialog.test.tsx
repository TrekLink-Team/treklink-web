// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  contractKeys,
  type ContractDetail,
  type ContractDevice,
} from '../../entities/contract/api';
import { ApiError } from '../../shared/api/apiClient';
import { useToast } from '../../shared/ui/toastStore';
import { HolderDialog } from './HolderDialog';

// The holder label of a handed-over device (screen 5.2, rentals api-design 13, BR-33). Only the
// API client is mocked; the dialog, the confirm step and the toast store run for real.
const api = vi.fn();
vi.mock('../../shared/api/apiClient', async (original) => ({
  ...(await original<typeof import('../../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const contract = { id: 'c-1', code: 'RC-2026-0001', status: 'ACTIVE' } as unknown as ContractDetail;
const HOLDER = { name: 'Lan Nguyen', phone: '0901234567', emergencyContact: 'Minh, 0907654321' };
const device = (extra: Partial<ContractDevice> = {}) =>
  ({ deviceId: 'd-42', assetTag: 'TL-0042', holder: null, ...extra }) as unknown as ContractDevice;

const close = vi.fn();
let client: QueryClient;
const open = (unit: ContractDevice = device()) =>
  render(
    <QueryClientProvider client={client}>
      <HolderDialog contract={contract} device={unit} onClose={close} />
    </QueryClientProvider>,
  );

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const value = (label: RegExp) => (screen.getByLabelText(label) as HTMLInputElement).value;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const sent = () => JSON.parse((api.mock.calls[0][1] as { body: string }).body) as unknown;

beforeEach(() => {
  api.mockReset();
  close.mockReset();
  client = new QueryClient();
  useToast.getState().dismiss();
});
afterEach(cleanup);

describe('HolderDialog', () => {
  describe('opening', () => {
    it('names the unit by its asset tag and starts empty when the unit has no label', () => {
      open();
      expect(screen.getByRole('dialog', { name: 'Holder of TL-0042' })).toBeTruthy();
      expect(value(/Name/)).toBe('');
      expect(value(/Phone/)).toBe('');
      expect(value(/Emergency contact/)).toBe('');
      expect(screen.getByText(/erased when the contract\s+closes/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Clear label' })).toBeNull();
    });

    it('falls back to the device id when the unit has no asset tag', () => {
      open(device({ assetTag: null }));
      expect(screen.getByRole('dialog', { name: 'Holder of d-42' })).toBeTruthy();
    });

    it('fills the saved label and offers Clear label', () => {
      open(device({ holder: HOLDER }));
      expect(value(/Name/)).toBe('Lan Nguyen');
      expect(value(/Phone/)).toBe('0901234567');
      expect(value(/Emergency contact/)).toBe('Minh, 0907654321');
      expect(button('Clear label')).toBeTruthy();
    });
  });

  describe('saving', () => {
    it('sends the trimmed label, refreshes the contract, shows Saved. and closes', async () => {
      api.mockResolvedValue({});
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      open();
      type(/Name/, '  Lan Nguyen ');
      type(/Phone/, ' 0901234567 ');
      type(/Emergency contact/, 'Minh, 0907654321');
      fireEvent.click(button('Save'));
      await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
      expect(api).toHaveBeenCalledWith('/contracts/c-1/devices/d-42/holder', {
        method: 'PUT',
        body: JSON.stringify(HOLDER),
      });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: contractKeys.detail('c-1') });
      expect(useToast.getState().message).toBe('Saved.');
    });

    it('sends null for a blank phone and a blank emergency contact', async () => {
      api.mockResolvedValue({});
      open();
      type(/Name/, 'Lan Nguyen');
      type(/Phone/, '   ');
      fireEvent.click(button('Save'));
      await waitFor(() => expect(close).toHaveBeenCalled());
      expect(sent()).toEqual({ name: 'Lan Nguyen', phone: null, emergencyContact: null });
    });

    it('clears the label when saved with an empty name, without asking', async () => {
      api.mockResolvedValue({});
      open(device({ holder: HOLDER }));
      type(/Name/, '  ');
      fireEvent.click(button('Save'));
      await waitFor(() => expect(close).toHaveBeenCalled());
      expect(sent()).toEqual({ name: null });
    });

    it('shows Saving… and disables Save and Clear label while the request runs', async () => {
      let finish: (v: unknown) => void = () => undefined;
      api.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      open(device({ holder: HOLDER }));
      fireEvent.click(button('Save'));
      expect(
        (await screen.findByRole('button', { name: 'Saving…' })).hasAttribute('disabled'),
      ).toBe(true);
      expect(button('Clear label').disabled).toBe(true);
      expect(button('Cancel').disabled).toBe(false);
      finish({});
      await waitFor(() => expect(close).toHaveBeenCalled());
    });

    it('shows the server message on a refusal and stays open with the buttons enabled', async () => {
      api.mockRejectedValue(new ApiError(409, 'CONTRACT_CLOSED', 'The contract is closed.'));
      open();
      type(/Name/, 'Lan Nguyen');
      fireEvent.click(button('Save'));
      expect((await screen.findByRole('alert')).textContent).toBe('The contract is closed.');
      expect(button('Save').disabled).toBe(false);
      expect(close).not.toHaveBeenCalled();
      expect(useToast.getState().message).toBeNull();
    });

    it('shows a generic message when the failure is not an API error', async () => {
      api.mockRejectedValue(new TypeError('Failed to fetch'));
      open();
      type(/Name/, 'Lan Nguyen');
      fireEvent.click(button('Save'));
      expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong.');
    });
  });

  describe('Clear label', () => {
    it('asks first, and Keep label leaves the label untouched', () => {
      open(device({ holder: HOLDER }));
      fireEvent.click(button('Clear label'));
      expect(
        screen.getByRole('dialog', { name: 'Remove the holder label of TL-0042?' }),
      ).toBeTruthy();
      expect(
        screen.getByText(
          'The name, phone and emergency contact on this unit are erased for everyone.',
        ),
      ).toBeTruthy();
      fireEvent.click(button('Keep label'));
      expect(screen.queryByRole('dialog', { name: /Remove the holder label/ })).toBeNull();
      expect(api).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
    });

    it('erases the label on Remove label, whatever the fields hold', async () => {
      api.mockResolvedValue({});
      open(device({ holder: HOLDER }));
      type(/Name/, 'Someone else');
      fireEvent.click(button('Clear label'));
      fireEvent.click(button('Remove label'));
      await waitFor(() => expect(close).toHaveBeenCalled());
      expect(sent()).toEqual({ name: null });
      expect(useToast.getState().message).toBe('Saved.');
    });
  });

  describe('Cancel', () => {
    it('closes at once when nothing changed', () => {
      open(device({ holder: HOLDER }));
      fireEvent.click(button('Cancel'));
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('asks before discarding a change, and Keep editing keeps the dialog and the typing', () => {
      open();
      type(/Phone/, '0901234567');
      fireEvent.click(button('Cancel'));
      expect(screen.getByRole('dialog', { name: 'Discard the label changes?' })).toBeTruthy();
      expect(screen.getByText('The label stays as it was saved.')).toBeTruthy();
      fireEvent.click(button('Keep editing'));
      expect(close).not.toHaveBeenCalled();
      expect(value(/Phone/)).toBe('0901234567');
    });

    it('closes on Discard without saving', () => {
      open();
      type(/Name/, 'Lan Nguyen');
      fireEvent.click(button('Cancel'));
      fireEvent.click(button('Discard'));
      expect(close).toHaveBeenCalledTimes(1);
      expect(api).not.toHaveBeenCalled();
    });

    it('asks the same way when Escape closes a changed dialog', () => {
      open();
      type(/Name/, 'Lan Nguyen');
      fireEvent.keyDown(screen.getByRole('dialog', { name: 'Holder of TL-0042' }), {
        key: 'Escape',
      });
      expect(screen.getByRole('dialog', { name: 'Discard the label changes?' })).toBeTruthy();
      expect(close).not.toHaveBeenCalled();
    });
  });
});
