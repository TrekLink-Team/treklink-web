import React from 'react';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, X } from 'lucide-react';
import { cn } from './cn';

export type AlertTone = 'info' | 'success' | 'warning' | 'error';

const TONE: Record<AlertTone, { box: string; icon: React.ReactNode }> = {
  info: { box: 'border-status-active-line bg-status-active-tint text-status-active-fg', icon: <Info /> },
  success: { box: 'border-status-done-line bg-status-done-tint text-status-done-fg', icon: <CheckCircle2 /> },
  warning: { box: 'border-status-attention-line bg-status-attention-tint text-status-attention-fg', icon: <AlertTriangle /> },
  error: { box: 'border-status-critical-line bg-status-critical-tint text-status-critical-fg', icon: <OctagonAlert /> },
};

export interface AlertProps {
  tone: AlertTone;
  title?: string;
  children?: React.ReactNode;
  /** The one action that fixes the case (convention 06 §8.6). */
  action?: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
}

/**
 * An inline message inside the page. `error` and `warning` are announced at once (role="alert");
 * `info` and `success` politely (role="status"). Page-wide incident alerts use the AlertBanner.
 */
export const Alert: React.FC<AlertProps> = ({ tone, title, children, action, onDismiss, className }) => (
  <div
    role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
    className={cn('flex items-start gap-3 rounded-card border px-4 py-3 text-body', TONE[tone].box, className)}
  >
    <span aria-hidden="true" className="mt-0.5 shrink-0 [&>svg]:h-5 [&>svg]:w-5">
      {TONE[tone].icon}
    </span>
    <div className="min-w-0 flex-1">
      {title && <p className="font-bold">{title}</p>}
      {children && <div className={cn(title && 'mt-0.5')}>{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
    {onDismiss && (
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="-m-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-control hover:bg-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    )}
  </div>
);
