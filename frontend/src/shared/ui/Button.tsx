import React from 'react';
import { Loader2 } from 'lucide-react';
import { BASE, SIZE, VARIANT, type ButtonSize, type ButtonVariant } from './buttonStyles';
import { cn } from './cn';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, keeps the width and disables the button until the server answers (§8.5). */
  loading?: boolean;
  /** Text announced while loading; defaults to the button's own label. */
  loadingLabel?: string;
  icon?: React.ReactNode;
  iconEnd?: React.ReactNode;
}

/**
 * The action button of the TrekLink System.
 *
 * Use `primary` once per screen, `secondary` for other actions, `ghost` inside toolbars and
 * `danger` for destructive actions that open a ConfirmDialog. Always a real `<button>`; for
 * navigation use a link styled with `buttonClasses`.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, loadingLabel, icon, iconEnd, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANT[variant], SIZE[size], className)}
      {...rest}
    >
      {loading ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : icon}
      {loading && loadingLabel ? loadingLabel : children}
      {!loading && iconEnd}
    </button>
  );
});

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Required: the button has no visible text (WCAG 4.1.2). Also shown as the tooltip. */
  label: string;
  icon: React.ReactNode;
  variant?: 'ghost' | 'secondary' | 'primary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  /** For toggles such as the info pane button. */
  pressed?: boolean;
  /** A count shown as a small critical dot, for notifications. */
  badge?: number;
}

const ICON_SIZE = { sm: 'h-9 w-9', md: 'h-10 w-10', lg: 'h-11 w-11' } as const;

/** A square icon-only button with an accessible name and a tooltip. */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', pressed, badge, className, type = 'button', ...rest },
  ref,
) {
  const announced = badge ? `${label}, ${badge} unread` : label;
  return (
    <button
      ref={ref}
      type={type}
      aria-label={announced}
      title={label}
      aria-pressed={pressed}
      className={cn(
        BASE,
        'relative p-0',
        VARIANT[variant],
        ICON_SIZE[size],
        pressed && variant === 'ghost' && 'bg-chrome text-brand hover:bg-chrome-strong',
        className,
      )}
      {...rest}
    >
      <span aria-hidden="true" className="flex [&>svg]:h-5 [&>svg]:w-5">
        {icon}
      </span>
      {badge ? (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-critical-strong px-1 text-[10px] font-extrabold leading-none text-status-critical-on"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </button>
  );
});
