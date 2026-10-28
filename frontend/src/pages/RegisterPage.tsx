import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { registerOrganization, type RegistrationInput } from '../entities/organization/api';
import { ApiError } from '../shared/api/apiClient';
import { Alert, Button, Card, Field, Input } from '../shared/ui';
import { invalid } from '../shared/ui/errors';
import { LINK } from '../shared/ui/styles';

const EMPTY: RegistrationInput = {
  legalName: '',
  taxCode: '',
  address: '',
  contactPhone: '',
  managerFullName: '',
  managerEmail: '',
  managerPhone: '',
};

const FIELDS: { name: keyof RegistrationInput; label: string; type?: string; hint?: string }[] = [
  { name: 'legalName', label: 'Registered company name' },
  { name: 'taxCode', label: 'Tax code', hint: '10 or 13 digits.' },
  { name: 'address', label: 'Registered address' },
  { name: 'contactPhone', label: 'Company phone', type: 'tel' },
  { name: 'managerFullName', label: 'Manager full name' },
  { name: 'managerEmail', label: 'Manager email', type: 'email', hint: 'Becomes the sign-in.' },
  { name: 'managerPhone', label: 'Manager phone', type: 'tel' },
];

// The server names the failing fields in its VALIDATION_FAILED message ("taxCode must be ...").
const fieldErrors = (message: string): Partial<Record<keyof RegistrationInput, string>> =>
  Object.fromEntries(
    message
      .split('; ')
      .map((part) => [FIELDS.find((field) => part.startsWith(`${field.name} `))?.name, part])
      .filter(([name]) => name),
  ) as Partial<Record<keyof RegistrationInput, string>>;

// /register, screen 3.1 (organizations api-design 01, UC-01, FR-ORG-01): an organization registers
// itself with its Manager; it stays PENDING until TrekLink verifies it at the counter (MSG04).
export const RegisterPage: React.FC = () => {
  const [form, setForm] = useState<RegistrationInput>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof RegistrationInput, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const set = (name: keyof RegistrationInput, value: string) => {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const missing = Object.fromEntries(
      FIELDS.filter((field) => form[field.name].trim() === '').map((field) => [
        field.name,
        `${field.label} is required.`,
      ]),
    );
    setErrors(missing);
    setFailure(null);
    if (Object.keys(missing).length > 0) return;
    setPending(true);
    try {
      const registered = await registerOrganization({
        ...form,
        taxCode: form.taxCode.trim(),
        managerEmail: form.managerEmail.trim(),
      });
      setDone(registered.code);
    } catch (error) {
      setPending(false);
      if (error instanceof ApiError && error.errorCode === 'VALIDATION_FAILED') {
        setErrors(fieldErrors(error.message));
      } else {
        setFailure(error instanceof ApiError ? error.message : 'Something went wrong.');
      }
    }
  };

  if (done) {
    return (
      <section aria-labelledby="register-title" className="mx-auto max-w-lg">
        <Card className="flex flex-col gap-4">
          <h1 id="register-title" className="text-title-lg text-ink">
            Registration received
          </h1>
          <Alert tone="success">
            Registration received. Visit the TrekLink counter or call us to verify your
            organization.
          </Alert>
          <p className="text-body text-ink-muted">
            Your organization code is{' '}
            <span className="font-mono font-semibold text-ink">{done}</span>. The Manager receives
            an email to set a password.
          </p>
          <Link to="/sign-in" className={`${LINK} self-start`}>
            Back to sign in
          </Link>
        </Card>
      </section>
    );
  }

  return (
    <section aria-labelledby="register-title" className="mx-auto max-w-lg">
      <form onSubmit={submit} noValidate>
        <Card className="flex flex-col gap-4">
          <h1 id="register-title" className="text-title-lg text-ink">
            Register your organization
          </h1>
          <p className="-mt-2 text-body text-ink-muted">
            TrekLink verifies every organization at the counter or by phone before it can rent
            devices.
          </p>
          {failure && <Alert tone="error">{failure}</Alert>}
          {FIELDS.map((field) => (
            <Field
              key={field.name}
              id={`register-${field.name}`}
              label={field.label}
              error={errors[field.name]}
              hint={field.hint}
              required
            >
              <Input
                id={`register-${field.name}`}
                type={field.type ?? 'text'}
                value={form[field.name]}
                onChange={(event) => set(field.name, event.target.value)}
                {...invalid(`register-${field.name}`, errors[field.name])}
              />
            </Field>
          ))}
          <Button type="submit" variant="primary" loading={pending} loadingLabel="Sending">
            Register
          </Button>
          <Link to="/sign-in" className={`${LINK} self-start text-body-sm`}>
            Already registered? Sign in
          </Link>
        </Card>
      </form>
    </section>
  );
};
