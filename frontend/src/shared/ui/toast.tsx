import React, { useEffect } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { useToast } from './toastStore';

const VISIBLE_MS = 6000;

// One toast at a time, announced politely, above dialogs and under the incident banner. On a phone
// it sits above the bottom tab bar.
export const Toast: React.FC = () => {
  const message = useToast((state) => state.message);
  const dismiss = useToast((state) => state.dismiss);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(dismiss, VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [message, dismiss]);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(theme(spacing.tabbar)+1rem)] z-toast flex justify-center px-4 md:bottom-6"
    >
      {message && (
        <div
          role="status"
          className="pointer-events-auto flex max-w-md items-center gap-3 rounded-card bg-inverse py-2 pl-4 pr-2 text-body text-ink-inverse shadow-overlay"
        >
          <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0" />
          <span className="flex-1">{message}</span>
          <button
            type="button"
            onClick={dismiss}
            className="flex h-9 w-9 items-center justify-center rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
            aria-label="Dismiss"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
};
