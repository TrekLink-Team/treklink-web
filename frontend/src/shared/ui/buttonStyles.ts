import { cn } from './cn';

// Class recipes of Button, shared with links that look like buttons.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export const VARIANT: Record<ButtonVariant, string> = {
  // The one primary action of a screen (convention 06 §8.1): accent fill with a neumorphic press.
  primary: 'tl-press bg-accent font-bold text-on-accent hover:bg-accent-hover active:bg-accent-pressed',
  secondary: 'tl-raise border border-line-strong bg-surface text-ink hover:bg-chrome/60',
  ghost: 'bg-transparent text-ink hover:bg-chrome/60',
  // Destructive actions are secondary in weight and confirm first (ConfirmDialog).
  danger:
    'border border-status-critical-line bg-status-critical-tint text-status-critical-fg hover:bg-status-critical-strong hover:text-status-critical-on',
};

// 36 px is the desktop toolbar size; 44 px the touch size of forms and dialogs (WCAG 2.5.8 asks 24).
export const SIZE: Record<ButtonSize, string> = {
  sm: 'h-9 gap-1.5 px-3 text-body-sm',
  md: 'h-11 gap-2 px-4 text-body',
  lg: 'h-12 gap-2 px-5 text-body-lg',
};

export const BASE =
  'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-control font-semibold transition duration-tl ease-tl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-55';

/** Classes of a button, for a router `<Link>` that should look like one. */
export const buttonClasses = (variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string) =>
  cn(BASE, VARIANT[variant], SIZE[size], className);

