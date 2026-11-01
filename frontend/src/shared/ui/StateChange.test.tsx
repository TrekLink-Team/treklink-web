// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/apiClient';
import { MSG36, REASON_REQUIRED, StateChangeMenu, type StateTransition } from './StateChange';
import { useToast } from './toastStore';

beforeEach(() => useToast.getState().dismiss());
afterEach(cleanup);

type DeviceState = 'MAINTENANCE' | 'RETIRED';

const TRANSITIONS: StateTransition<DeviceState>[] = [
  { target: 'MAINTENANCE', label: 'Send to maintenance', successMessage: 'TL-0042 sent to maintenance.' },
  {
    target: 'RETIRED',
    label: 'Retire device',
    destructive: true,
    needsReason: true,
    description: 'The device leaves the fleet for good. This cannot be undone.',
  },
];

const setup = (onSubmit = vi.fn().mockResolvedValue(undefined), onReload = vi.fn()) => {
  render(
    <StateChangeMenu<DeviceState> subject="TL-0042" transitions={TRANSITIONS} version={7} onSubmit={onSubmit} onReload={onReload} />,
  );
  return { onSubmit, onReload, trigger: screen.getByRole('button', { name: 'Change status of TL-0042' }) };
};

const choose = (trigger: HTMLElement, label: string) => {
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
};

describe('StateChangeMenu and StateChangeDialog', () => {
  it('lists only the given transitions and renders nothing without one', () => {
    const { trigger, onSubmit } = setup();
    fireEvent.click(trigger);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Send to maintenance', 'Retire device']);
    cleanup();
    const { container } = render(<StateChangeMenu subject="TL-0042" transitions={[]} version={1} onSubmit={onSubmit} />);
    expect(container.innerHTML).toBe('');
  });

  it('titles and buttons the dialog with the action, never OK', () => {
    const { trigger } = setup();
    choose(trigger, 'Send to maintenance');
    const dialog = screen.getByRole('dialog', { name: 'Send to maintenance TL-0042?' });
    expect(dialog).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send to maintenance' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
  });

  it('sends expectedVersion, shows the success toast in a status tone and returns focus to the trigger', async () => {
    const { trigger, onSubmit } = setup();
    choose(trigger, 'Send to maintenance');
    fireEvent.click(screen.getByRole('button', { name: 'Send to maintenance' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onSubmit).toHaveBeenCalledWith({ target: 'MAINTENANCE', expectedVersion: 7 });
    expect(useToast.getState().message).toBe('TL-0042 sent to maintenance.');
    expect(useToast.getState().tone).toBe('success');
    expect(document.activeElement).toBe(trigger);
  });

  it('uses an alert dialog for a destructive change, with the consequences as its description', () => {
    const { trigger } = setup();
    choose(trigger, 'Retire device');
    const dialog = screen.getByRole('alertdialog', { name: 'Retire device TL-0042?' });
    const description = document.getElementById(dialog.getAttribute('aria-describedby')!);
    expect(description?.textContent).toBe('The device leaves the fleet for good. This cannot be undone.');
    expect(screen.getByRole('button', { name: 'Retire device' }).className).toContain('status-critical');
  });

  it('starts on the reason when one is needed, and on Cancel for a destructive change without one', () => {
    const { trigger } = setup();
    choose(trigger, 'Retire device');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /Reason/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(trigger);
    cleanup();
    render(
      <StateChangeMenu
        subject="TL-0042"
        transitions={[{ target: 'RETIRED', label: 'Retire device', destructive: true }]}
        version={1}
        onSubmit={vi.fn()}
      />,
    );
    choose(screen.getByRole('button', { name: 'Change status of TL-0042' }), 'Retire device');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('refuses an empty required reason without sending, then sends the trimmed reason', async () => {
    const { trigger, onSubmit } = setup();
    choose(trigger, 'Retire device');
    fireEvent.click(screen.getByRole('button', { name: 'Retire device' }));
    expect(onSubmit).not.toHaveBeenCalled();
    const reason = screen.getByRole('textbox', { name: /Reason/ });
    expect(screen.getByText(REASON_REQUIRED).getAttribute('role')).toBe('alert');
    expect(reason.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(reason);
    fireEvent.change(reason, { target: { value: '  Cracked housing  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retire device' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ target: 'RETIRED', expectedVersion: 7, reason: 'Cracked housing' }));
  });

  it('shows a persistent conflict notice on STALE_VERSION that keeps the reason, and Reload refetches', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ApiError(409, 'STALE_VERSION', 'Version mismatch'));
    const { trigger, onReload } = setup(onSubmit);
    choose(trigger, 'Retire device');
    const reason = screen.getByRole('textbox', { name: /Reason/ }) as HTMLTextAreaElement;
    fireEvent.change(reason, { target: { value: 'Cracked housing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retire device' }));
    const notice = await screen.findByText(new RegExp(MSG36.replace('.', '\\.')));
    expect(notice).toBeTruthy();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(reason.value).toBe('Cracked housing');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(screen.getByText(new RegExp(MSG36.replace('.', '\\.')))).toBeTruthy();
    expect(useToast.getState().message).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(reason.value).toBe('Cracked housing');
  });

  it('keeps any other refusal in the dialog with the server message', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new ApiError(409, 'INVALID_STATE_TRANSITION', 'The device is rented.'));
    const { trigger } = setup(onSubmit);
    choose(trigger, 'Send to maintenance');
    fireEvent.click(screen.getByRole('button', { name: 'Send to maintenance' }));
    expect(await screen.findByText('The device is rented.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
