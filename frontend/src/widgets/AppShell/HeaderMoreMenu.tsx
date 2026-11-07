import React from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useConnector, useConnectorStore } from '../../features/device-connector';
import { useTheme } from '../../shared/lib/theme';
import { Menu, type MenuItem } from '../../shared/ui/Menu';
import { useShell } from './shellStore';

// The Devices entry of the More menu: the connector panel with the number of connected units in its text
// (screen 4.6), as the header button shows it from 640 px.
const useDevicesItem = (): MenuItem => {
  const { snapshot } = useConnector();
  const setOpen = useConnectorStore((state) => state.setOpen);
  const open = useConnectorStore((state) => state.open);
  const count = snapshot.connections.filter((connection) => connection.state !== 'unplugged').length;
  return { key: 'devices', label: `Devices, ${count} connected`, onSelect: () => setOpen(!open) };
};

const DevicesItem: React.FC<{ children: (item: MenuItem) => React.ReactNode }> = ({ children }) => (
  <>{children(useDevicesItem())}</>
);

/**
 * The header's More menu below 640 px (design-system §5, W41): Go to page, Devices for TrekLink accounts and the
 * theme switch, which do not fit beside the badge, the live state and the account menu at 320 px or at 400 % zoom
 * (chapter 06 §11.1, WCAG 1.4.10). Every control keeps its name as the item's text.
 */
export const HeaderMoreMenu: React.FC<{ treklink: boolean; className?: string }> = ({ treklink, className }) => {
  const setQuickNav = useShell((state) => state.setQuickNav);
  const dark = useTheme((state) => state.resolved) === 'dark';
  const toggleTheme = useTheme((state) => state.toggle);
  const render = (devices: MenuItem | null) => (
    <Menu
      label="More header actions"
      title="More"
      chevron={false}
      align="end"
      className={className}
      trigger={<MoreHorizontal aria-hidden="true" className="h-5 w-5" />}
      triggerClassName="h-10 min-w-10"
      items={[
        { key: 'go-to', label: 'Go to page', onSelect: () => setQuickNav(true) },
        ...(devices ? [devices] : []),
        { key: 'theme', label: dark ? 'Switch to light theme' : 'Switch to dark theme', onSelect: toggleTheme },
      ]}
    />
  );
  // Organization accounts never dock units, so their menu does not read the connector (REQ-UBI-07).
  return treklink ? <DevicesItem>{(item) => render(item)}</DevicesItem> : render(null);
};
