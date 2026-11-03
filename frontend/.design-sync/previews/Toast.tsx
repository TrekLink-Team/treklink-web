import { useEffect } from 'react';
import { Toast, useToast } from '@treklink/ui';

const Show = ({ message, tone, action }: { message: string; tone: 'success' | 'info' | 'warning' | 'error'; action?: string }) => {
  useEffect(() => {
    useToast.getState().show(message, {
      tone,
      persistent: true,
      action: action ? { label: action, onClick: () => undefined } : undefined,
    });
  }, [message, tone, action]);
  // Toast is position: fixed; the transform makes this frame its containing block, as a page would be.
  return (
    <div style={{ position: 'relative', height: 140, width: 560, transform: 'translateZ(0)' }} className="rounded-panel bg-ground">
      <Toast />
    </div>
  );
};

export const Success = () => <Show tone="success" message="Contract CT-2026-0142 saved" />;
export const ErrorWithAction = () => <Show tone="error" message="Could not reach the gateway" action="Retry" />;
