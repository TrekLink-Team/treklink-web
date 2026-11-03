import React from 'react';
import { Usb } from 'lucide-react';
import { cn } from '../../../shared/ui/cn';
import { useConnectorStore } from '../model/connectorStore';
import { useConnector } from '../model/useConnector';

// The header entry of the device connector (screen 4.6): "Devices" with the number of connected units.
// The visible label is inside the accessible name (2.5.3), and the pressed state says whether the panel
// is open.
export const ConnectorButton: React.FC<{ className?: string }> = ({ className }) => {
  const { snapshot } = useConnector();
  const open = useConnectorStore((state) => state.open);
  const setOpen = useConnectorStore((state) => state.setOpen);
  const count = snapshot.connections.filter((connection) => connection.state !== 'unplugged').length;
  return (
    <button
      type="button"
      aria-pressed={open}
      aria-label={`Devices, ${count} connected`}
      onClick={() => setOpen(!open)}
      className={cn(
        'flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-control px-2 text-body-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus',
        open ? 'bg-chrome text-brand' : 'text-ink hover:bg-chrome/60',
        className,
      )}
    >
      <Usb aria-hidden="true" className="h-[18px] w-[18px]" />
      <span className="hidden sm:inline">Devices</span>
      <span aria-hidden="true" className="rounded-badge border border-line px-1.5 font-mono text-caption">
        {count}
      </span>
    </button>
  );
};
