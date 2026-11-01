import React, { useState } from 'react';
import { DEMO_ROLES, demoMessageOf, switchDemoRole, type DemoRole } from '../../entities/demo/api';
import { useSession } from '../../entities/session/model';
import { Button, cn } from '../../shared/ui';
import { messageOf } from '../../shared/ui/errors';
import { useAdoptDemoSession } from './useDemoSession';

interface Props {
  /** Disables every button, for example while a stage runs or the database is not local. */
  disabled?: boolean;
  /** Called with the error message of a refused switch; the switcher shows it itself when absent. */
  onError?: (message: string) => void;
  /** Called before the switch replaces the session, so a menu can close itself. */
  onSwitch?: () => void;
  className?: string;
}

// The four seeded roles of the demo (screen 7.5): one click signs this window in as that role's
// seeded account and opens its landing page (demo api-design 04).
export const RoleSwitcher: React.FC<Props> = ({ disabled = false, onError, onSwitch, className }) => {
  const current = useSession((state) => state.user?.roles ?? []);
  const adopt = useAdoptDemoSession();
  const [pending, setPending] = useState<DemoRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  const switchTo = async (role: DemoRole) => {
    setPending(role);
    setError(null);
    try {
      const session = await switchDemoRole(role);
      onSwitch?.();
      adopt(session);
    } catch (failure) {
      const message = demoMessageOf(failure, messageOf);
      if (onError) onError(message);
      else setError(message);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className={className}>
      <div role="group" aria-label="Switch role" className="flex flex-wrap gap-2">
        {DEMO_ROLES.map(({ role, label }) => (
          <Button
            key={role}
            size="sm"
            variant={current.includes(role) ? 'primary' : 'secondary'}
            aria-pressed={current.includes(role)}
            disabled={disabled || (pending !== null && pending !== role)}
            loading={pending === role}
            onClick={() => void switchTo(role)}
          >
            {label}
          </Button>
        ))}
      </div>
      {error && <p className={cn('mt-2 text-body-sm text-status-critical-fg')}>{error}</p>}
    </div>
  );
};
