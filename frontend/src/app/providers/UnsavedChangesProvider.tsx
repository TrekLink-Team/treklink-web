import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { UnsavedChangesContext } from '../../shared/lib/unsavedChanges';
import { ConfirmDialog } from '../../shared/ui/Dialog';

// React Router allows one blocker per router. Only forms that register a draft activate it.
export const UnsavedChangesProvider: React.FC<
  React.PropsWithChildren<{ canBlock: () => boolean }>
> = ({ canBlock, children }) => {
  const drafts = useRef(new Set<symbol>());
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const register = useCallback(() => {
    const draft = Symbol();
    drafts.current.add(draft);
    return () => {
      drafts.current.delete(draft);
    };
  }, []);
  const requestLeave = useCallback(
    (action: () => void) => {
      if (canBlock() && drafts.current.size) setLeave(() => action);
      else action();
    },
    [canBlock],
  );
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    canBlock() &&
    drafts.current.size > 0 &&
    (currentLocation.pathname !== nextLocation.pathname ||
      currentLocation.search !== nextLocation.search),
  );
  const context = useMemo(() => ({ register, requestLeave }), [register, requestLeave]);
  const blocked = blocker.state === 'blocked';
  return (
    <UnsavedChangesContext.Provider value={context}>
      {children}
      {(blocked || leave) && (
        <ConfirmDialog
          titleId="unsaved-navigation"
          title="Discard unsaved changes?"
          description="Your changes will be lost if you leave."
          confirmLabel="Discard and leave"
          cancelLabel="Keep editing"
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
