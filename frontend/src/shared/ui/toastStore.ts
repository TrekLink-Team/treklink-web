import { create } from 'zustand';

// One toast at a time (MSG03, MSG14, MSG15, MSG20 and the like). `show(message)` keeps the first
// pages working as before: a success toast cleared after a few seconds or on dismiss. A tone and an
// action are optional (specs/frontend/ui-design/0-ui-standard.md §3): an error, or any toast with an
// action, stays until dismissed, because a timed message with an action fails WCAG 2.2.1.

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  tone?: ToastTone;
  action?: ToastAction;
  /** Overrides the default: persistent for an error or an action, timed otherwise. */
  persistent?: boolean;
}

interface ToastState {
  message: string | null;
  tone: ToastTone;
  action: ToastAction | null;
  persistent: boolean;
  /** Bumped on every show, so the same text shown twice restarts the timer. */
  serial: number;
  show: (message: string, options?: ToastOptions) => void;
  dismiss: () => void;
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  tone: 'success',
  action: null,
  persistent: false,
  serial: 0,
  show: (message, options = {}) => {
    const tone = options.tone ?? 'success';
    const action = options.action ?? null;
    set((state) => ({
      message,
      tone,
      action,
      persistent: options.persistent ?? (tone === 'error' || action !== null),
      serial: state.serial + 1,
    }));
  },
  dismiss: () => set({ message: null, action: null, persistent: false }),
}));
