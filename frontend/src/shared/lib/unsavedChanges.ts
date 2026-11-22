import { createContext, useContext, useEffect } from 'react';
import type { Location } from 'react-router-dom';

/**
 * How a registered draft is protected. Pass a constant: a new object re-registers the draft.
 * `stays` accepts a navigation that keeps the user inside the form, such as a step change in the
 * address (treklink-web#536), so it is not asked about. The wording replaces the generic
 * "Discard unsaved changes?" confirmation when the form has its own.
 */
export interface LeaveGuard {
  stays?: (next: Location) => boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface UnsavedChanges {
  register: (guard?: LeaveGuard) => () => void;
  requestLeave: (leave: () => void) => void;
}

export const UnsavedChangesContext = createContext<UnsavedChanges | null>(null);

export const useUnsavedChanges = (dirty: boolean, guard?: LeaveGuard) => {
  const register = useContext(UnsavedChangesContext)?.register;
  useEffect(() => {
    if (!dirty) return;
    const unregister = register?.(guard);
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      unregister?.();
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty, register, guard]);
};

const leaveImmediately = (leave: () => void) => leave();
export const useGuardedLeave = () =>
  useContext(UnsavedChangesContext)?.requestLeave ?? leaveImmediately;
