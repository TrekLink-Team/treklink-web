import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../shared/lib/theme';
import { IconButton } from '../../shared/ui/Button';

/** Switches between the light (Canopy) and dark (Volt) theme. The default follows the system. */
export const ThemeToggle: React.FC<{ className?: string }> = ({ className }) => {
  const resolved = useTheme((state) => state.resolved);
  const toggle = useTheme((state) => state.toggle);
  const dark = resolved === 'dark';
  return (
    <IconButton
      label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      icon={dark ? <Sun /> : <Moon />}
      onClick={toggle}
      className={className}
    />
  );
};
