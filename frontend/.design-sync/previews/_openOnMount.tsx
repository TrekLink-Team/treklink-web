import React, { useEffect, useRef } from 'react';

// Menus have no open prop: click the real trigger once after mount so the card shows the open list.
export const OpenOnMount: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = window.setTimeout(() => ref.current?.querySelector<HTMLButtonElement>('button[aria-haspopup]')?.click(), 50);
    return () => window.clearTimeout(id);
  }, []);
  return <div ref={ref} className="p-4">{children}</div>;
};
