import React, { useState } from 'react';
import {
  createAccount,
  deactivateAccount,
  reactivateAccount,
  sendAccountReset,
  updateAccount,
  type AccountItem,
  type AccountRole,
  type UpdateAccountInput,
} from '../../entities/account/api';
import { ROLE_OPTIONS, phoneError, roleLabel, roleOf } from '../../entities/account/model';
import { ApiError } from '../../shared/api/apiClient';
import { Alert, Button, Dialog, Field, Input, Select } from '../../shared/ui';
import { invalid, messageOf } from '../../shared/ui/errors';

// Screen 7.1 shows the server's message for these codes: the dialogs of MSG37 and MSG39 are the backstop
// of a control that is already disabled, and a reset can be refused for a deactivated account or inside
// the cooldown.
const SERVER_TEXT = new Set([
  'SELF_DEMOTION',
  'LAST_ADMIN',
  'NOT_FOUND',
  'INVALID_STATE_TRANSITION',
  'OTP_COOLDOWN',
  'CONFLICT_UNIQUE',
]);
const serverMessage = (error: unknown): string =>
  error instanceof ApiError && SERVER_TEXT.has(error.errorCode) ? error.message : messageOf(error);

const isNotFound = (error: unknown): boolean =>
  error instanceof ApiError && error.errorCode === 'NOT_FOUND';

type FormField = 'email' | 'fullName' | 'phoneNumber' | 'role';
const FORM_FIELDS: FormField[] = ['email', 'fullName', 'phoneNumber', 'role'];

// The field a VALIDATION_FAILED message starts with ("email must be an email"), if it is one of ours.
const fieldOf = (message: string): FormField | undefined =>
  FORM_FIELDS.find((field) => message.startsWith(`${field} `));

interface Done {
  onNotFound: () => void;
  onClose: () => void;
}

const Footer: React.FC<{
  pending: boolean;
  onClose: () => void;
  confirm: React.ReactNode;
}> = ({ pending, onClose, confirm }) => (
  <>
    <Button variant="ghost" onClick={onClose} disabled={pending}>
      Cancel
    </Button>
    {confirm}
  </>
);

// New account, auth api-design 10: one step, three fields. No password is set here: the invitation email
// carries a code (FR-AUTH-05).
export const NewAccountDialog: React.FC<{
  onCreated: (account: AccountItem) => void;
  onClose: () => void;
}> = ({ onCreated, onClose }) => {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<AccountRole>('STAFF');
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const found: Partial<Record<FormField, string>> = {};
    if (email.trim() === '') found.email = 'Email is required.';
    if (fullName.trim() === '') found.fullName = 'Full name is required.';
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;
    setPending(true);
    try {
      onCreated(
        await createAccount({ email: email.trim().toLowerCase(), fullName: fullName.trim(), role }),
      );
    } catch (caught) {
      setPending(false);
      const field =
        caught instanceof ApiError && caught.errorCode === 'VALIDATION_FAILED'
          ? fieldOf(caught.message)
          : undefined;
      if (caught instanceof ApiError && caught.errorCode === 'CONFLICT_UNIQUE')
        setErrors({ email: caught.message });
      else if (field && caught instanceof ApiError) setErrors({ [field]: caught.message });
      else setFailure(serverMessage(caught));
    }
  };

  return (
    <Dialog
      titleId="new-account-title"
      title="New account"
      description="They receive an email with a code to set their password."
      onClose={onClose}
      footer={
        <Footer
          pending={pending}
          onClose={onClose}
          confirm={
            <Button variant="primary" loading={pending} onClick={() => void submit()}>
              Create account
            </Button>
          }
        />
      }
    >
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
        {failure && <Alert tone="error">{failure}</Alert>}
        <Field id="account-email" label="Email" error={errors.email} required>
          <Input
            id="account-email"
            type="email"
            autoComplete="off"
            value={email}
            maxLength={254}
            onChange={(event) => setEmail(event.target.value)}
            {...invalid('account-email', errors.email)}
          />
        </Field>
        <Field id="account-name" label="Full name" error={errors.fullName} required>
          <Input
            id="account-name"
            autoComplete="off"
            value={fullName}
            maxLength={120}
            onChange={(event) => setFullName(event.target.value)}
            {...invalid('account-name', errors.fullName)}
          />
        </Field>
        <Field
          id="account-role"
          label="Role"
          error={errors.role}
          hint="No password is set here. The invitation email carries a code."
          required
        >
          <Select
            id="account-role"
            value={role}
            onChange={(event) => setRole(event.target.value as AccountRole)}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Dialog>
  );
};

// Edit name, phone or role, auth api-design 11. A role change asks first and says when it applies.
// The role control is disabled on the signed-in Admin's own row (SELF_DEMOTION is the backstop).
export const EditAccountDialog: React.FC<
  Done & { account: AccountItem; isSelf: boolean; onSaved: () => void }
> = ({ account, isSelf, onSaved, onNotFound, onClose }) => {
  const current = roleOf(account);
  const [fullName, setFullName] = useState(account.fullName);
  const [phone, setPhone] = useState(account.phoneNumber ?? '');
  const [role, setRole] = useState<AccountRole>(current);
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  const changes = (): UpdateAccountInput => ({
    ...(fullName.trim() !== account.fullName ? { fullName: fullName.trim() } : {}),
    ...(phone.trim() !== (account.phoneNumber ?? '') && phone.trim() !== ''
      ? { phoneNumber: phone.trim() }
      : {}),
    ...(role !== current ? { role } : {}),
  });

  const save = async () => {
    setFailure(null);
    setPending(true);
    try {
      await updateAccount(account.id, changes());
      onSaved();
    } catch (caught) {
      setPending(false);
      setConfirming(false);
      const field =
        caught instanceof ApiError && caught.errorCode === 'VALIDATION_FAILED'
          ? fieldOf(caught.message)
          : undefined;
      if (field && caught instanceof ApiError) setErrors({ [field]: caught.message });
      else setFailure(serverMessage(caught));
      if (isNotFound(caught)) onNotFound();
    }
  };

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    const found: Partial<Record<FormField, string>> = {};
    if (fullName.trim() === '') found.fullName = 'Full name is required.';
    const phoneProblem = phoneError(phone);
    if (phoneProblem) found.phoneNumber = phoneProblem;
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length > 0) return;
    if (role !== current) setConfirming(true);
    else void save();
  };

  const unchanged = Object.keys(changes()).length === 0;

  if (confirming) {
    return (
      <Dialog
        titleId="edit-account-confirm-title"
        title={`Change ${account.fullName} from ${roleLabel(current)} to ${roleLabel(role)}?`}
        description="It applies on their next request."
        onClose={() => setConfirming(false)}
        size="sm"
        footer={
          <Footer
            pending={pending}
            onClose={() => setConfirming(false)}
            confirm={
              <Button variant="primary" loading={pending} onClick={() => void save()}>
                Change role
              </Button>
            }
          />
        }
      >
        {failure && <Alert tone="error">{failure}</Alert>}
      </Dialog>
    );
  }

  return (
    <Dialog
      titleId="edit-account-title"
      title={`Edit ${account.fullName}`}
      onClose={onClose}
      footer={
        <Footer
          pending={pending}
          onClose={onClose}
          confirm={
            <Button
              variant="primary"
              loading={pending}
              disabled={unchanged}
              onClick={() => submit()}
            >
              Save
            </Button>
          }
        />
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {failure && <Alert tone="error">{failure}</Alert>}
        <Field id="edit-email" label="Email" hint="The email cannot be changed.">
          <Input id="edit-email" value={account.email} readOnly />
        </Field>
        <Field id="edit-name" label="Full name" error={errors.fullName} required>
          <Input
            id="edit-name"
            autoComplete="off"
            value={fullName}
            maxLength={120}
            onChange={(event) => setFullName(event.target.value)}
            {...invalid('edit-name', errors.fullName)}
          />
        </Field>
        <Field id="edit-phone" label="Phone" error={errors.phoneNumber}>
          <Input
            id="edit-phone"
            type="tel"
            autoComplete="off"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            {...invalid('edit-phone', errors.phoneNumber)}
          />
        </Field>
        <Field
          id="edit-role"
          label="Role"
          error={errors.role}
          hint={isSelf ? 'You cannot change your own role.' : undefined}
        >
          <Select
            id="edit-role"
            value={role}
            disabled={isSelf}
            onChange={(event) => setRole(event.target.value as AccountRole)}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Dialog>
  );
};

// Deactivate, auth api-design 12: names the account, says sessions end at once and requires a reason.
// LAST_ADMIN (MSG37) shows as the server's message in this dialog.
export const DeactivateAccountDialog: React.FC<
  Done & { account: AccountItem; onDone: () => void }
> = ({ account, onDone, onNotFound, onClose }) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const confirm = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setFailure(null);
    if (reason.trim() === '') {
      setError('Reason is required.');
      return;
    }
    setError(undefined);
    setPending(true);
    try {
      await deactivateAccount(account.id, reason.trim());
      onDone();
    } catch (caught) {
      setPending(false);
      if (caught instanceof ApiError && caught.errorCode === 'VALIDATION_FAILED')
        setError(caught.message);
      else setFailure(serverMessage(caught));
      if (isNotFound(caught)) onNotFound();
    }
  };

  return (
    <Dialog
      titleId="deactivate-account-title"
      title={`Deactivate ${account.fullName}?`}
      description="Their sign-in sessions end at once and they can no longer sign in."
      onClose={onClose}
      size="sm"
      footer={
        <Footer
          pending={pending}
          onClose={onClose}
          confirm={
            <Button variant="danger" loading={pending} onClick={() => void confirm()}>
              Deactivate
            </Button>
          }
        />
      }
    >
      <form onSubmit={(event) => void confirm(event)} noValidate className="flex flex-col gap-4">
        {failure && <Alert tone="error">{failure}</Alert>}
        <Field id="deactivate-account-reason" label="Reason" error={error} required>
          <Input
            id="deactivate-account-reason"
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            {...invalid('deactivate-account-reason', error)}
          />
        </Field>
      </form>
    </Dialog>
  );
};

// The two confirmations with no field: reactivate (auth api-design 13) and send a reset code (14).
export const ConfirmAccountDialog: React.FC<
  Done & {
    kind: 'reactivate' | 'reset';
    account: AccountItem;
    onDone: () => void;
  }
> = ({ kind, account, onDone, onNotFound, onClose }) => {
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const confirm = async () => {
    setFailure(null);
    setPending(true);
    try {
      if (kind === 'reactivate') await reactivateAccount(account.id);
      else await sendAccountReset(account.id);
      onDone();
    } catch (caught) {
      setPending(false);
      setFailure(serverMessage(caught));
      if (isNotFound(caught)) onNotFound();
    }
  };

  const reactivate = kind === 'reactivate';
  return (
    <Dialog
      titleId="confirm-account-title"
      title={
        reactivate ? `Reactivate ${account.fullName}?` : `Send a reset code to ${account.email}?`
      }
      description={reactivate ? 'They can sign in again.' : 'You will not see the password.'}
      onClose={onClose}
      size="sm"
      footer={
        <Footer
          pending={pending}
          onClose={onClose}
          confirm={
            <Button variant="primary" loading={pending} onClick={() => void confirm()}>
              {reactivate ? 'Reactivate' : 'Send reset code'}
            </Button>
          }
        />
      }
    >
      {failure && <Alert tone="error">{failure}</Alert>}
    </Dialog>
  );
};
