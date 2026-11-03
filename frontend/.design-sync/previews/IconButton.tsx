import { Bell, Download, MoreHorizontal, PanelRight, Plus, Trash2 } from 'lucide-react';
import { IconButton } from '@treklink/ui';

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-3">
    <IconButton label="More actions" icon={<MoreHorizontal />} />
    <IconButton label="Download" variant="secondary" icon={<Download />} />
    <IconButton label="Add" variant="primary" icon={<Plus />} />
    <IconButton label="Delete" variant="danger" icon={<Trash2 />} />
  </div>
);

export const ToggleAndBadge = () => (
  <div className="flex flex-wrap items-center gap-3">
    <IconButton label="Info pane" pressed icon={<PanelRight />} />
    <IconButton label="Notifications" badge={4} icon={<Bell />} />
    <IconButton label="Notifications" badge={128} icon={<Bell />} />
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-3">
    <IconButton label="More" size="sm" variant="secondary" icon={<MoreHorizontal />} />
    <IconButton label="More" size="md" variant="secondary" icon={<MoreHorizontal />} />
    <IconButton label="More" size="lg" variant="secondary" icon={<MoreHorizontal />} />
  </div>
);
