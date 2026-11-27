// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device } from '../../entities/device/api';
import { ApiError } from '../../shared/api/apiClient';
import { DisposeDialog, IntakeDialog, ResetDialog } from './DeviceDialogs';

// The data-entry dialogs of a device's lifecycle (screen 4.2): intake check (devices api-design 09),
// reset (10) and disposal (23). Only the API client is mocked. DeviceDetailPage.test opens each
// dialog once through the page; this file covers their own fields, refusals and buttons.
const api = vi.fn();
vi.mock('../../shared/api/apiClient', async (original) => ({
  ...(await original<typeof import('../../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const device = (extra: Partial<Device> = {}, motion = true) =>
  ({
    id: 'd-1',
    assetTag: 'TL-0042',
    status: 'RETURNED',
    version: 3,
    hardwareVariant: { id: 'v-3', hasMotionSensor: motion },
    ...extra,
  }) as unknown as Device;

const done = vi.fn();
const cancel = vi.fn();
const props = (unit: Device = device()) => ({ device: unit, onDone: done, onCancel: cancel });
const sentTo = (endpoint: string) => {
  const call = api.mock.calls.find(([url]) => url === endpoint);
  return call ? (JSON.parse((call[1] as { body: string }).body) as unknown) : undefined;
};
const tick = (dialog: HTMLElement, ...steps: string[]) =>
  steps.forEach((step) => fireEvent.click(within(dialog).getByLabelText(step)));
const ALL_STEPS = ['Key removed', 'Node database cleared', 'Owner cleared'];

beforeEach(() => {
  api.mockReset();
  done.mockReset();
  cancel.mockReset();
});
afterEach(cleanup);

describe('IntakeDialog', () => {
  const open = (unit?: Device) => {
    render(<IntakeDialog {...props(unit)} />);
    return screen.getByRole('dialog', { name: 'Record intake check' });
  };

  it('starts with every check passing, the motion sensor included on a motion variant', () => {
    const dialog = open();
    const switches = within(dialog).getAllByRole('switch');
    expect(switches.map((each) => each.id)).toEqual([
      'intake-gps',
      'intake-radio',
      'intake-battery',
      'intake-motion',
    ]);
    switches.forEach((each) => expect(each.getAttribute('aria-checked')).toBe('true'));
  });

  it('sends the checks with the version it saw and closes', async () => {
    api.mockResolvedValue({ check: { passed: true } });
    const dialog = open();
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Radio' }));
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Motion sensor' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(api.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(sentTo('/devices/d-1/intake-checks')).toEqual({
      gpsFixOk: true,
      radioOk: false,
      batteryOk: true,
      motionOk: false,
      expectedVersion: 3,
    });
  });

  it('leaves the motion field out for a variant without the sensor', async () => {
    api.mockResolvedValue({ check: { passed: true } });
    const dialog = open(device({}, false));
    expect(within(dialog).queryByRole('switch', { name: 'Motion sensor' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(sentTo('/devices/d-1/intake-checks')).not.toHaveProperty('motionOk');
  });

  it('sends a trimmed note, and none when the note is blank', async () => {
    api.mockResolvedValue({ check: { passed: true } });
    const dialog = open();
    const note = within(dialog).getByLabelText(/Note/) as HTMLTextAreaElement;
    expect(note.maxLength).toBe(500);
    fireEvent.change(note, { target: { value: '  Antenna loose  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(sentTo('/devices/d-1/intake-checks')).toMatchObject({ note: 'Antenna loose' });
    cleanup();
    api.mockClear();
    const again = open();
    fireEvent.change(within(again).getByLabelText(/Note/), { target: { value: '   ' } });
    fireEvent.click(within(again).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(sentTo('/devices/d-1/intake-checks')).not.toHaveProperty('note');
  });

  it('names the state when the server refuses the transition, and stays open', async () => {
    api.mockRejectedValue(new ApiError(409, 'INVALID_STATE_TRANSITION', 'Invalid transition'));
    const dialog = open(device({ status: 'RENTED' } as Partial<Device>));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'This cannot be done while it is RENTED.',
    );
    expect(done).not.toHaveBeenCalled();
    expect(
      (within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('disables Cancel and busies Save while the request runs', async () => {
    api.mockReturnValue(new Promise(() => undefined));
    const dialog = open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(
        (within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    expect(within(dialog).getByRole('button', { name: 'Save' }).getAttribute('aria-busy')).toBe(
      'true',
    );
  });

  it('closes on Cancel without sending', () => {
    const dialog = open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(api).not.toHaveBeenCalled();
  });
});

describe('ResetDialog', () => {
  const open = () => {
    render(<ResetDialog {...props()} />);
    return screen.getByRole('dialog', { name: 'Record reset' });
  };
  const save = (dialog: HTMLElement) =>
    within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement;

  it('names the unit and keeps Save disabled until all three steps are ticked', () => {
    const dialog = open();
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(within(dialog).getByText('TL-0042')).toBeTruthy();
    expect(save(dialog).disabled).toBe(true);
    tick(dialog, 'Key removed', 'Node database cleared');
    expect(save(dialog).disabled).toBe(true);
    tick(dialog, 'Owner cleared');
    expect(save(dialog).disabled).toBe(false);
    tick(dialog, 'Key removed');
    expect(save(dialog).disabled).toBe(true);
  });

  it('records the reset with every step and closes', async () => {
    api.mockResolvedValue({});
    const dialog = open();
    tick(dialog, ...ALL_STEPS);
    fireEvent.click(save(dialog));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(sentTo('/devices/d-1/reset')).toEqual({
      keyRemoved: true,
      nodeDbCleared: true,
      ownerCleared: true,
    });
  });

  it('shows the dependency message when a maintenance record is open', async () => {
    api.mockRejectedValue(new ApiError(409, 'MAINTENANCE_OPEN', 'open'));
    const dialog = open();
    tick(dialog, ...ALL_STEPS);
    fireEvent.click(save(dialog));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Finish the open maintenance record first.',
    );
    expect(done).not.toHaveBeenCalled();
  });

  it('closes on Cancel without sending', () => {
    const dialog = open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
  });
});

describe('DisposeDialog', () => {
  const open = () => {
    render(
      <DisposeDialog {...props(device({ status: 'RETIRED', version: 7 } as Partial<Device>))} />,
    );
    return screen.getByRole('alertdialog', { name: 'Dispose of TL-0042?' });
  };
  const dispose = (dialog: HTMLElement) =>
    within(dialog).getByRole('button', { name: 'Dispose' }) as HTMLButtonElement;

  it('asks as an alert dialog and keeps Dispose disabled until the wipe steps are ticked', () => {
    const dialog = open();
    expect(dispose(dialog).disabled).toBe(true);
    tick(dialog, 'Key removed', 'Owner cleared');
    expect(dispose(dialog).disabled).toBe(true);
    tick(dialog, 'Node database cleared');
    expect(dispose(dialog).disabled).toBe(false);
  });

  it('asks for the method before sending anything', () => {
    const dialog = open();
    tick(dialog, ...ALL_STEPS);
    fireEvent.change(within(dialog).getByLabelText(/Method/), { target: { value: '   ' } });
    fireEvent.click(dispose(dialog));
    expect(within(dialog).getByRole('alert').textContent).toBe('Please fill in this field.');
    expect(api).not.toHaveBeenCalled();
  });

  it('sends the steps, the trimmed method and the version, then closes', async () => {
    api.mockResolvedValue({});
    const dialog = open();
    tick(dialog, ...ALL_STEPS);
    fireEvent.change(within(dialog).getByLabelText(/Method/), {
      target: { value: ' Recycled by vendor ' },
    });
    fireEvent.click(dispose(dialog));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(sentTo('/devices/d-1/dispose')).toEqual({
      keyRemoved: true,
      nodeDbCleared: true,
      ownerCleared: true,
      method: 'Recycled by vendor',
      expectedVersion: 7,
    });
  });

  it('clears the method prompt on a new try and shows a refusal from the server', async () => {
    api.mockRejectedValue(new ApiError(400, 'WIPE_INCOMPLETE', 'Complete every wipe step first.'));
    const dialog = open();
    tick(dialog, ...ALL_STEPS);
    fireEvent.click(dispose(dialog));
    expect(within(dialog).getByRole('alert').textContent).toBe('Please fill in this field.');
    fireEvent.change(within(dialog).getByLabelText(/Method/), { target: { value: 'Shredded' } });
    fireEvent.click(dispose(dialog));
    await waitFor(() =>
      expect(within(dialog).getByRole('alert').textContent).toBe('Complete every wipe step first.'),
    );
    expect(done).not.toHaveBeenCalled();
    expect(dispose(dialog).disabled).toBe(false);
  });

  it('closes on Cancel without sending', () => {
    const dialog = open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
  });
});
