import React, { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';
import { INPUT } from './styles';

// Form controls of the TrekLink System. Labels sit above fields and are never replaced by a
// placeholder (convention 06 §3). The required mark is a visible asterisk plus the word in the
// accessible name; errors are linked with aria-describedby and announced.

export interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Visually hides the label for a control whose purpose is obvious from context (search). */
  hideLabel?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Label, hint, error and required mark around one control. */
export const Field: React.FC<FieldProps> = ({ id, label, hint, error, required, hideLabel, className, children }) => (
  <div className={cn('flex flex-col gap-1.5', className)}>
    <label htmlFor={id} className={cn('text-body-sm font-semibold text-ink', hideLabel && 'sr-only')}>
      {label}
      {required && (
        <>
          <span aria-hidden="true" className="ml-0.5 text-status-critical-fg">
            *
          </span>
          <span className="sr-only"> (required)</span>
        </>
      )}
    </label>
    {children}
    {hint && !error && (
      <p id={`${id}-hint`} className="text-body-sm text-ink-muted">
        {hint}
      </p>
    )}
    {error && (
      <p id={`${id}-error`} role="alert" className="text-body-sm font-medium text-status-critical-fg">
        {error}
      </p>
    )}
  </div>
);

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(INPUT, 'w-full', className)} {...rest} />;
});

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

/** A native select, so keyboard and screen-reader behaviour come from the platform. */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, children, ...rest },
  ref,
) {
  return (
    <span className="relative inline-flex w-full">
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(INPUT, 'w-full appearance-none pr-9', className)}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
    </span>
  );
});

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(INPUT, 'h-auto w-full py-2.5 leading-relaxed', className)}
      {...rest}
    />
  );
});

type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: React.ReactNode;
  description?: string;
};

/** A native checkbox with its label; the whole row is the 44 px target. Space toggles it. */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <label htmlFor={inputId} className={cn('flex min-h-11 cursor-pointer items-start gap-3 py-2', className)}>
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-line-strong accent-[rgb(var(--tl-accent))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        aria-describedby={description ? `${inputId}-desc` : undefined}
        {...rest}
      />
      <span className="flex flex-col">
        <span className="text-body font-medium text-ink">{label}</span>
        {description && (
          <span id={`${inputId}-desc`} className="text-body-sm text-ink-muted">
            {description}
          </span>
        )}
      </span>
    </label>
  );
});

export interface RadioOption<V extends string> {
  value: V;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface RadioGroupProps<V extends string> {
  name: string;
  legend: string;
  options: RadioOption<V>[];
  value: V | undefined;
  onChange: (value: V) => void;
  error?: string;
  required?: boolean;
  /** `row` lays the options side by side from the sm breakpoint. */
  layout?: 'column' | 'row';
}

/** Native radios in a fieldset: arrow keys move between options, Tab leaves the group. */
export function RadioGroup<V extends string>({
  name,
  legend,
  options,
  value,
  onChange,
  error,
  required,
  layout = 'column',
}: RadioGroupProps<V>) {
  return (
    <fieldset aria-describedby={error ? `${name}-error` : undefined} className="flex flex-col gap-1.5">
      <legend className="mb-1 text-body-sm font-semibold text-ink">
        {legend}
        {required && (
          <>
            <span aria-hidden="true" className="ml-0.5 text-status-critical-fg">
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </legend>
      <div className={cn('flex flex-col gap-1', layout === 'row' && 'sm:flex-row sm:flex-wrap sm:gap-4')}>
        {options.map((option) => {
          const id = `${name}-${option.value}`;
          return (
            <label key={option.value} htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                disabled={option.disabled}
                onChange={() => onChange(option.value)}
                className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[rgb(var(--tl-accent))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              />
              <span className="flex flex-col">
                <span className="text-body font-medium text-ink">{option.label}</span>
                {option.description && <span className="text-body-sm text-ink-muted">{option.description}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <p id={`${name}-error`} role="alert" className="text-body-sm font-medium text-status-critical-fg">
          {error}
        </p>
      )}
    </fieldset>
  );
}

interface SwitchProps {
  id?: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  disabled?: boolean;
}

/** An on/off setting that applies at once (role="switch"). Space and Enter toggle it. */
export const Switch: React.FC<SwitchProps> = ({ id, label, checked, onChange, description, disabled }) => {
  const auto = useId();
  const switchId = id ?? auto;
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <span className="flex flex-col">
        <label htmlFor={switchId} className="text-body font-medium text-ink">
          {label}
        </label>
        {description && (
          <span id={`${switchId}-desc`} className="text-body-sm text-ink-muted">
            {description}
          </span>
        )}
      </span>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${switchId}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition duration-tl ease-tl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-55',
          checked ? 'border-accent bg-accent' : 'border-line-strong bg-sunken',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'ml-0.5 inline-block h-5 w-5 rounded-full shadow-raise transition-transform duration-tl ease-tl',
            checked ? 'translate-x-5 bg-on-accent' : 'translate-x-0 bg-ink-muted',
          )}
        />
      </button>
    </div>
  );
};
