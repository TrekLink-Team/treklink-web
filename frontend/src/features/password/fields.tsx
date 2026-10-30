import React, { useState } from 'react';
import { Alert } from '../../shared/ui/Alert';
import { FOCUS } from '../../shared/ui/styles';

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  error?: string;
}

const describedBy = (id: string, error?: string) =>
  error ? { 'aria-invalid': true, 'aria-describedby': `${id}-error` } : {};

const FieldError: React.FC<{ id: string; error?: string }> = ({ id, error }) =>
  error ? (
    <p id={`${id}-error`} role="alert" className="text-sm text-status-critical-fg">
      {error}
    </p>
  ) : null;

export const TextField: React.FC<
  FieldProps & { type?: string; inputMode?: 'numeric' | 'email'; autoFocus?: boolean }
> = ({ id, label, value, onChange, autoComplete, error, type = 'text', inputMode, autoFocus }) => (
  <div className="flex flex-col gap-1.5">
    <label htmlFor={id} className="text-sm font-semibold text-ink">
      {label}
    </label>
    <input
      id={id}
      type={type}
      inputMode={inputMode}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      required
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`h-11 rounded-lg border border-line-strong px-3 bg-surface text-ink ${FOCUS}`}
      {...describedBy(id, error)}
    />
    <FieldError id={id} error={error} />
  </div>
);

// A password with the Show toggle of screen 2.1.
export const PasswordField: React.FC<FieldProps & { toggle?: boolean }> = ({
  id,
  label,
  value,
  onChange,
  autoComplete,
  error,
  toggle = true,
}) => {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`h-11 min-w-0 flex-1 rounded-lg border border-line-strong px-3 bg-surface text-ink ${FOCUS}`}
          {...describedBy(id, error)}
        />
        {toggle && (
          <button
            type="button"
            onClick={() => setShown((current) => !current)}
            aria-label={shown ? 'Hide password' : 'Show password'}
            className={`h-11 rounded-lg border border-line-strong px-3 text-sm font-semibold text-brand ${FOCUS}`}
          >
            {shown ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      <FieldError id={id} error={error} />
    </div>
  );
};

export const Notice: React.FC<{ tone: 'info' | 'error'; children: React.ReactNode }> = ({
  tone,
  children,
}) => (
  <Alert tone={tone}>{children}</Alert>
);
