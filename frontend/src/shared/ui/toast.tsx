import React, { useEffect } from 'react';
import { useToast } from './toastStore';

const VISIBLE_MS = 6000;

export const Toast: React.FC = () => {
  const message = useToast((state) => state.message);
  const dismiss = useToast((state) => state.dismiss);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(dismiss, VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [message, dismiss]);

  return (
    <div aria-live="polite" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 px-4">
      {message && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-lg"
        >
          <span>{message}</span>
          <button
            type="button"
            onClick={dismiss}
            className="font-semibold text-emerald-300"
            aria-label="Dismiss"
          >
            OK
          </button>
        </div>
      )}
    </div>
  );
};
