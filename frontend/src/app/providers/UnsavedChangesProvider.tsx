import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { UnsavedChangesContext, type LeaveGuard } from '../../shared/lib/unsavedChanges';
import { ConfirmDialog } from '../../shared/ui/Dialog';

const GENERIC: Required<Omit<LeaveGuard, 'stays'>> = {
  title: 'Discard unsaved changes?',
  description: 'Your changes will be lost if you leave.',
  confirmLabel: 'Discard and leave',
  cancelLabel: 'Keep editing',
};

// React Router allows one blocker per router. Only forms that register a draft activate it; a draft
// whose guard accepts the next location (a step change inside the form) does not ask.
export const UnsavedChangesProvider: React.FC<
  React.PropsWithChildren<{ canBlock: () => boolean }>
> = ({ canBlock, children }) => {
  const drafts = useRef(new Map<symbol, LeaveGuard>());
  const [leave, setLeave] = useState<(() => void) | null>(null);
  // The guard that stopped the last browser navigation, for its wording.
  const [asking, setAsking] = useState<LeaveGuard>({});
  const register = useCallback((guard: LeaveGuard = {}) => {
    const draft = Symbol();
    drafts.current.set(draft, guard);
    return () => {
      drafts.current.delete(draft);
    };
  }, []);
  const requestLeave = useCallback(
    (action: () => void) => {
      if (canBlock() && drafts.current.size) {
        setAsking({});
        setLeave(() => action);
      } else action();
    },
    [canBlock],
  );
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (!canBlock() || drafts.current.size === 0) return false;
    if (
      currentLocation.pathname === nextLocation.pathname &&
      currentLocation.search === nextLocation.search
    ) {
      return false;
    }
    const guard = [...drafts.current.values()].find((item) => !item.stays?.(nextLocation));
    if (guard) setAsking(guard);
    return guard !== undefined;
  });
  const context = useMemo(() => ({ register, requestLeave }), [register, requestLeave]);
  const blocked = blocker.state === 'blocked';
  const wording = { ...GENERIC, ...asking };
  return (
    <UnsavedChangesContext.Provider value={context}>
      {children}
      {(blocked || leave) && (
        <ConfirmDialog
          titleId="unsaved-navigation"
          title={wording.title}
          description={wording.description}
          confirmLabel={wording.confirmLabel}
          cancelLabel={wording.cancelLabel}
          destructive
          onConfirm={() => {
            setLeave(null);
            if (blocked) blocker.proceed();
            else leave?.();
          }}
          onCancel={() => {
            setLeave(null);
            if (blocked) blocker.reset();
          }}
        />
      )}
    </UnsavedChangesContext.Provider>
  );
};
