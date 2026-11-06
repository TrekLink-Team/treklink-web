import { createContext, useContext, useEffect } from 'react';

interface UnsavedChanges {
  register: () => () => void;
  requestLeave: (leave: () => void) => void;
}

export const UnsavedChangesContext = createContext<UnsavedChanges | null>(null);

export const useUnsavedChanges = (dirty: boolean) => {
  const register = useContext(UnsavedChangesContext)?.register;
  useEffect(() => {
    if (!dirty) return;
    const unregister = register?.();
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      unregister?.();
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty, register]);
};

const leaveImmediately = (leave: () => void) => leave();
export const useGuardedLeave = () =>
  useContext(UnsavedChangesContext)?.requestLeave ?? leaveImmediately;
