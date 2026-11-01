import React, { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from './cn';
import { FOCUS } from './styles';
import { useToast, type ToastTone } from './toastStore';

const VISIBLE_MS = 6000;

const ICON: Record<ToastTone, React.ReactNode> = {
  success: <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0" />,
  info: <Info aria-hidden="true" className="h-5 w-5 shrink-0" />,
  warning: <AlertTriangle aria-hidden="true" className="h-5 w-5 shrink-0" />,
  error: <XCircle aria-hidden="true" className="h-5 w-5 shrink-0" />,
};

// The tone is also a word for screen readers, so colour and icon are never the only signal.
const TONE_WORD: Record<ToastTone, string> = {
  success: 'Success',
  info: 'Information',
  warning: 'Warning',
  error: 'Error',
};

// A left edge in the status colour on the inverse surface; the text stays ink-inverse in every tone.
const EDGE: Record<ToastTone, string> = {
  success: 'border-l-status-done-fg',
  info: 'border-l-status-waiting-fg',
  warning: 'border-l-status-attention-fg',
  error: 'border-l-status-critical-fg',
};

const Body: React.FC = () => {
  const message = useToast((state) => state.message);
  const tone = useToast((state) => state.tone);
  const action = useToast((state) => state.action);
  const dismiss = useToast((state) => state.dismiss);
  if (!message) return null;
  return (
    <div
      className={cn(
        'pointer-events-auto flex max-w-md items-center gap-3 rounded-card border-l-4 bg-inverse py-2 pl-4 pr-2 text-body text-ink-inverse shadow-overlay',
        EDGE[tone],
      )}
    >
      {ICON[tone]}
      <span className="flex-1">
        <span className="sr-only">{TONE_WORD[tone]}: </span>
        {message}
      </span>
      {action && (
        <button
          type="button"
          onClick={() => {
            action.onClick();
            dismiss();
          }}
          className={cn('min-h-11 rounded-control px-2 font-bold underline underline-offset-4', FOCUS)}
        >
          {action.label}
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        className={cn('flex h-11 w-11 items-center justify-center rounded-control', FOCUS)}
        aria-label="Dismiss"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
};

// One toast at a time, above dialogs and under the incident banner; on a phone it sits above the
// bottom tab bar. Two live regions stay mounted so a message is announced without moving focus
// (WCAG 4.1.3): role="status" (polite) for success, info and warning, role="alert" (assertive) for
// an error. A timed toast clears after six seconds; an error or an actionable toast stays.
export const Toast: React.FC = () => {
  const message = useToast((state) => state.message);
  const tone = useToast((state) => state.tone);
  const persistent = useToast((state) => state.persistent);
  const serial = useToast((state) => state.serial);
  const dismiss = useToast((state) => state.dismiss);

  useEffect(() => {
    if (!message || persistent) return;
    const timer = window.setTimeout(dismiss, VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [message, persistent, serial, dismiss]);

  const assertive = tone === 'error';
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(theme(spacing.tabbar)+1rem)] z-toast flex flex-col items-center px-4 md:bottom-6">
      <div role="status" aria-live="polite">
        {!assertive && <Body />}
      </div>
      <div role="alert" aria-live="assertive">
        {assertive && <Body />}
      </div>
    </div>
  );
};
