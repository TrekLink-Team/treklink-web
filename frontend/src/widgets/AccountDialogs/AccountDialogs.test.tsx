// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountItem } from '../../entities/account/api';
import { ApiError } from '../../shared/api/apiClient';
import {
  ConfirmAccountDialog,
  DeactivateAccountDialog,
  EditAccountDialog,
  NewAccountDialog,
} from './AccountDialogs';

// The account dialogs of screen 7.1 (auth api-design 10 to 14). Only the API client is mocked.
// AccountsPage.test drives each dialog's main flow through the page; this file covers what the
// dialogs decide on their own: where a refusal is shown, which fields are sent, and the role step.
const api = vi.fn();
vi.mock('../../shared/api/apiClient', async (original) => ({
  ...(await original<typeof import('../../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const account = (extra: Partial<AccountItem> = {}): AccountItem =>
  ({
    id: 'u-7',
    email: 'linh@treklink.vn',
    fullName: 'Linh Tran',
    phoneNumber: '0901234567',
    accountType: 'TREKLINK',
    roles: ['STAFF'],
    isActive: true,
    lastLoginAt: null,
    ...extra,
  }) as AccountItem;

const refusal = (code: string, message: string, status = 409) =>
  new ApiError(status, code, message);
const sent = () => {
  const [endpoint, init] = api.mock.calls[0] as [string, { method: string; body?: string }];
  return {
    endpoint,
    method: init.method,
    body: init.body ? (JSON.parse(init.body) as unknown) : undefined,
  };
};
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const type = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
// The message Field renders under a control, linked to it by id.
const errorOf = (label: RegExp | string) =>
  document.getElementById(`${screen.getByLabelText(label).id}-error`)?.textContent ?? null;
// The refusal shown above the form: an alert that is not a field message.
const alertText = () =>
  Array.from(screen.getByRole('dialog').querySelectorAll('[role="alert"]')).find(
    (alert) => !alert.id.endsWith('-error'),
  )?.textContent ?? null;

const onClose = vi.fn();
const onNotFound = vi.fn();
const onDone = vi.fn();

beforeEach(() => {
  api.mockReset();
  [onClose, onNotFound, onDone].forEach((fn) => fn.mockReset());
});
afterEach(cleanup);

describe('NewAccountDialog', () => {
  const onCreated = vi.fn();
  const open = () => render(<NewAccountDialog onCreated={onCreated} onClose={onClose} />);
  beforeEach(() => onCreated.mockReset());

  it('says how the password is set and starts as Staff', () => {
    open();
    expect(screen.getByRole('dialog', { name: 'New account' })).toBeTruthy();
    expect(
      screen.getByText('They receive an email with a code to set their password.'),
    ).toBeTruthy();
    expect((screen.getByLabelText(/Role/) as HTMLSelectElement).value).toBe('STAFF');
    expect(
      Array.from((screen.getByLabelText(/Role/) as HTMLSelectElement).options).map((o) => o.text),
    ).toEqual(['Staff', 'Admin']);
  });

  it('names both missing fields and sends nothing', () => {
    open();
    fireEvent.click(button('Create account'));
    expect(errorOf(/Email/)).toBe('Email is required.');
    expect(errorOf(/Full name/)).toBe('Full name is required.');
    const email = screen.getByLabelText(/Email/);
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(email.getAttribute('aria-describedby')).toBe('account-email-error');
    expect(api).not.toHaveBeenCalled();
  });

  it('creates an Admin with a trimmed lower-cased email and hands back the account', async () => {
    const created = account({ id: 'u-9', roles: ['ADMIN'] });
    api.mockResolvedValue(created);
    open();
    type(/Email/, '  Minh@TrekLink.VN ');
    type(/Full name/, ' Minh Le ');
    fireEvent.change(screen.getByLabelText(/Role/), { target: { value: 'ADMIN' } });
    fireEvent.click(button('Create account'));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(sent()).toEqual({
      endpoint: '/accounts',
      method: 'POST',
      body: { email: 'minh@treklink.vn', fullName: 'Minh Le', role: 'ADMIN' },
    });
  });

  it('puts a validation refusal under the field it names', async () => {
    api.mockRejectedValue(refusal('VALIDATION_FAILED', 'fullName must be shorter', 400));
    open();
    type(/Email/, 'minh@treklink.vn');
    type(/Full name/, 'Minh Le');
    fireEvent.click(button('Create account'));
    await waitFor(() => expect(errorOf(/Full name/)).toBe('fullName must be shorter'));
    expect(alertText()).not.toBe('fullName must be shorter');
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('shows a validation refusal on no field of ours, and any other refusal, above the form', async () => {
    api.mockRejectedValueOnce(refusal('VALIDATION_FAILED', 'role must be one of', 400));
    open();
    type(/Email/, 'minh@treklink.vn');
    type(/Full name/, 'Minh Le');
    fireEvent.click(button('Create account'));
    await waitFor(() => expect(errorOf(/Role/)).toBe('role must be one of'));
    api.mockRejectedValueOnce(refusal('RATE_LIMITED', 'Too many requests.', 429));
    fireEvent.click(button('Create account'));
    await waitFor(() => expect(alertText()).toBe('Too many requests.'));
    expect(errorOf(/Role/)).toBeNull();
  });

  it('closes on Cancel', () => {
    open();
    fireEvent.click(button('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('EditAccountDialog', () => {
  const onSaved = vi.fn();
  const open = (extra: Partial<AccountItem> = {}, isSelf = false) =>
    render(
      <EditAccountDialog
        account={account(extra)}
        isSelf={isSelf}
        onSaved={onSaved}
        onNotFound={onNotFound}
        onClose={onClose}
      />,
    );
  beforeEach(() => onSaved.mockReset());

  it('shows the email read-only and keeps Save disabled until something changes', () => {
    open();
    expect(screen.getByRole('dialog', { name: 'Edit Linh Tran' })).toBeTruthy();
    expect((screen.getByLabelText('Email') as HTMLInputElement).readOnly).toBe(true);
    expect(button('Save').disabled).toBe(true);
    type(/Full name/, 'Linh Tran ');
    expect(button('Save').disabled).toBe(true);
    type(/Full name/, 'Linh T. Tran');
    expect(button('Save').disabled).toBe(false);
  });

  it('sends only the phone when the phone changes', async () => {
    api.mockResolvedValue(account());
    open();
    type(/Phone/, ' +84 901 234 568 ');
    fireEvent.click(button('Save'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sent()).toEqual({
      endpoint: '/accounts/u-7',
      method: 'PATCH',
      body: { phoneNumber: '+84 901 234 568' },
    });
  });

  it('keeps the current phone when the field is emptied', () => {
    open();
    type(/Phone/, '');
    expect(button('Save').disabled).toBe(true);
  });

  it('checks the phone format before sending', () => {
    open();
    type(/Phone/, '09-01');
    fireEvent.click(button('Save'));
    expect(errorOf(/Phone/)).toBe('Enter 8 to 20 digits, with a leading + if needed.');
    expect(api).not.toHaveBeenCalled();
  });

  it('requires a name', () => {
    open();
    type(/Full name/, '  ');
    fireEvent.click(button('Save'));
    expect(errorOf(/Full name/)).toBe('Full name is required.');
    expect(api).not.toHaveBeenCalled();
  });

  it('asks before a role change, and going back returns to the form with the edits', () => {
    open();
    type(/Full name/, 'Linh T. Tran');
    fireEvent.change(screen.getByLabelText(/Role/), { target: { value: 'ADMIN' } });
    fireEvent.click(button('Save'));
    expect(
      screen.getByRole('dialog', { name: 'Change Linh Tran from Staff to Admin?' }),
    ).toBeTruthy();
    expect(screen.getByText('It applies on their next request.')).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(button('Cancel'));
    expect(screen.getByRole('dialog', { name: 'Edit Linh Tran' })).toBeTruthy();
    expect((screen.getByLabelText(/Full name/) as HTMLInputElement).value).toBe('Linh T. Tran');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sends the role and the name together once the change is confirmed', async () => {
    api.mockResolvedValue(account());
    open({ roles: ['ADMIN', 'STAFF'] });
    type(/Full name/, 'Linh T. Tran');
    fireEvent.change(screen.getByLabelText(/Role/), { target: { value: 'STAFF' } });
    fireEvent.click(button('Save'));
    expect(
      screen.getByRole('dialog', { name: 'Change Linh Tran from Admin to Staff?' }),
    ).toBeTruthy();
    fireEvent.click(button('Change role'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sent().body).toEqual({ fullName: 'Linh T. Tran', role: 'STAFF' });
  });

  it('disables the role on the Admin own account and says why', () => {
    open({ roles: ['ADMIN'] }, true);
    expect((screen.getByLabelText(/Role/) as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText('You cannot change your own role.')).toBeTruthy();
  });

  it('brings a refused role change back to the form with the server message', async () => {
    api.mockRejectedValue(refusal('LAST_ADMIN', 'At least one active Admin must remain.'));
    open({ roles: ['ADMIN'] });
    fireEvent.change(screen.getByLabelText(/Role/), { target: { value: 'STAFF' } });
    fireEvent.click(button('Save'));
    fireEvent.click(button('Change role'));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Edit Linh Tran' })).toBeTruthy(),
    );
    expect(alertText()).toBe('At least one active Admin must remain.');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('puts a validation refusal under the phone field', async () => {
    api.mockRejectedValue(refusal('VALIDATION_FAILED', 'phoneNumber must be a phone', 400));
    open();
    type(/Phone/, '0901234568');
    fireEvent.click(button('Save'));
    await waitFor(() => expect(errorOf(/Phone/)).toBe('phoneNumber must be a phone'));
  });

  it('shows Account not found. and tells the page when the account is gone', async () => {
    api.mockRejectedValue(refusal('NOT_FOUND', 'Account not found.', 404));
    open();
    type(/Phone/, '0901234568');
    fireEvent.click(button('Save'));
    await waitFor(() => expect(onNotFound).toHaveBeenCalledTimes(1));
    expect(alertText()).toBe('Account not found.');
  });
});

describe('DeactivateAccountDialog', () => {
  const open = () =>
    render(
      <DeactivateAccountDialog
        account={account()}
        onDone={onDone}
        onNotFound={onNotFound}
        onClose={onClose}
      />,
    );

  it('names the account, says sessions end at once and requires a reason', () => {
    open();
    const dialog = screen.getByRole('dialog', { name: 'Deactivate Linh Tran?' });
    expect(within(dialog).getByText(/sign-in sessions end at once/)).toBeTruthy();
    fireEvent.click(button('Deactivate'));
    expect(errorOf(/Reason/)).toBe('Reason is required.');
    expect(api).not.toHaveBeenCalled();
  });

  it('sends the trimmed reason and reports done', async () => {
    api.mockResolvedValue(account({ isActive: false }));
    open();
    type(/Reason/, '  Left the company ');
    fireEvent.click(button('Deactivate'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sent()).toEqual({
      endpoint: '/accounts/u-7/deactivate',
      method: 'POST',
      body: { reason: 'Left the company' },
    });
  });

  it('puts a validation refusal on the reason and the last Admin refusal above it', async () => {
    api.mockRejectedValueOnce(refusal('VALIDATION_FAILED', 'reason is too long', 400));
    open();
    type(/Reason/, 'x');
    fireEvent.click(button('Deactivate'));
    await waitFor(() => expect(errorOf(/Reason/)).toBe('reason is too long'));
    api.mockRejectedValueOnce(refusal('LAST_ADMIN', 'At least one active Admin must remain.'));
    fireEvent.click(button('Deactivate'));
    await waitFor(() => expect(alertText()).toBe('At least one active Admin must remain.'));
    expect(onDone).not.toHaveBeenCalled();
  });

  it('tells the page when the account is gone', async () => {
    api.mockRejectedValue(refusal('NOT_FOUND', 'Account not found.', 404));
    open();
    type(/Reason/, 'Left');
    fireEvent.click(button('Deactivate'));
    await waitFor(() => expect(onNotFound).toHaveBeenCalled());
  });
});

describe('ConfirmAccountDialog', () => {
  const open = (kind: 'reactivate' | 'reset') =>
    render(
      <ConfirmAccountDialog
        kind={kind}
        account={account()}
        onDone={onDone}
        onNotFound={onNotFound}
        onClose={onClose}
      />,
    );

  it('reactivates after naming the account', async () => {
    api.mockResolvedValue(account());
    open('reactivate');
    expect(screen.getByRole('dialog', { name: 'Reactivate Linh Tran?' })).toBeTruthy();
    expect(screen.getByText('They can sign in again.')).toBeTruthy();
    fireEvent.click(button('Reactivate'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sent()).toEqual({
      endpoint: '/accounts/u-7/reactivate',
      method: 'POST',
      body: undefined,
    });
  });

  it('sends a reset code after naming the email', async () => {
    api.mockResolvedValue(null);
    open('reset');
    expect(
      screen.getByRole('dialog', { name: 'Send a reset code to linh@treklink.vn?' }),
    ).toBeTruthy();
    expect(screen.getByText('You will not see the password.')).toBeTruthy();
    fireEvent.click(button('Send reset code'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sent().endpoint).toBe('/accounts/u-7/password-reset');
  });

  it('shows a deactivated account refusal as the server words it', async () => {
    api.mockRejectedValue(refusal('INVALID_STATE_TRANSITION', 'The account is deactivated.'));
    open('reset');
    fireEvent.click(button('Send reset code'));
    await waitFor(() => expect(alertText()).toBe('The account is deactivated.'));
    expect(onNotFound).not.toHaveBeenCalled();
    expect(button('Send reset code').disabled).toBe(false);
  });

  it('shows the access message for a 403, and the generic one for a failure that is not an API error', async () => {
    api.mockRejectedValueOnce(refusal('FORBIDDEN', 'Forbidden resource', 403));
    open('reactivate');
    fireEvent.click(button('Reactivate'));
    await waitFor(() => expect(alertText()).toBe('You do not have access to this.'));
    api.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fireEvent.click(button('Reactivate'));
    await waitFor(() => expect(alertText()).toBe('Something went wrong. Please try again.'));
    expect(onNotFound).not.toHaveBeenCalled();
  });

  it('closes on Cancel without sending', () => {
    open('reactivate');
    fireEvent.click(button('Cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
  });
});
