import React from 'react';
import { FlaskConical } from 'lucide-react';
import { cn } from '../../shared/ui/cn';

// The environment as text, never hidden in a tooltip (convention 06 §8.10, NFR-UI-03). Set
// VITE_APP_ENV to `sandbox`, `staging` or `production`; production shows nothing. Unset means
// sandbox, so a forgotten variable never passes for production.
const ENVIRONMENT = (import.meta.env.VITE_APP_ENV as string | undefined)?.toLowerCase() || 'sandbox';

const LABEL: Record<string, { short: string; long: string }> = {
  sandbox: { short: 'Sandbox', long: 'Sandbox: test data' },
  staging: { short: 'Staging', long: 'Staging: test data' },
  development: { short: 'Dev', long: 'Development build' },
};

export const EnvironmentBadge: React.FC<{ className?: string }> = ({ className }) => {
  if (ENVIRONMENT === 'production') return null;
  const label = LABEL[ENVIRONMENT] ?? { short: ENVIRONMENT, long: ENVIRONMENT };
  return (
    <span
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-badge border border-dashed border-status-waiting-fg px-2 text-caption font-extrabold uppercase tracking-wider text-status-waiting-fg',
        className,
      )}
    >
      <FlaskConical aria-hidden="true" className="h-3.5 w-3.5" />
      <span className="md:hidden">{label.short}</span>
      <span className="hidden md:inline">{label.long}</span>
    </span>
  );
};
