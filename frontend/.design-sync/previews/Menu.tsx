import { Download, Pencil, Trash2 } from 'lucide-react';
import { Menu } from '@treklink/ui';
import { OpenOnMount } from './_openOnMount';

export const RowActions = () => (
  <OpenOnMount>
    <Menu
      label="Actions"
      items={[
        { key: 'edit', label: 'Edit contract', icon: <Pencil className="h-4 w-4" />, onSelect: () => undefined },
        { key: 'export', label: 'Download PDF', icon: <Download className="h-4 w-4" />, onSelect: () => undefined },
        { key: 'close', label: 'Close contract', disabled: true, disabledReason: 'Devices still out', onSelect: () => undefined },
        { key: 'delete', label: 'Delete draft', icon: <Trash2 className="h-4 w-4" />, destructive: true, onSelect: () => undefined },
      ]}
    />
  </OpenOnMount>
);
