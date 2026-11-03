import React, { useCallback, useMemo, useState } from 'react';
import { cn } from '../cn';
import { PaneHostContext } from './paneHostContext';

/**
 * Names one container as the `paneHost` of several CollectionViews (chapter 06 §10.8): the details
 * pane sits beside all of them, opened from whichever list, and every list inside fits the
 * narrower width (its `hideWithPane` columns leave through a container query). Below 1100 px each
 * list opens its pane as the Drawer or the bottom sheet, as on its own.
 */
export const CollectionPaneHost: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => {
  const [owner, setOwner] = useState<string | null>(null);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const claim = useCallback((id: string) => setOwner(id), []);
  const release = useCallback(
    (id: string) => setOwner((current) => (current === id ? null : current)),
    [],
  );
  const value = useMemo(() => ({ owner, slot, claim, release }), [owner, slot, claim, release]);
  return (
    <PaneHostContext.Provider value={value}>
      <div data-pane-host="" className={cn('flex items-start gap-3', className)}>
        <div className="flex min-w-0 flex-1 flex-col gap-3 [container-type:inline-size]">
          {children}
        </div>
        <div ref={setSlot} className="contents" />
      </div>
    </PaneHostContext.Provider>
  );
};
