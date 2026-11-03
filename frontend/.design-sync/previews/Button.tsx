import { Download, Plus, Trash2 } from 'lucide-react';
import { Button } from '@treklink/ui';

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button variant="primary">Create contract</Button>
    <Button variant="secondary">Export CSV</Button>
    <Button variant="ghost">Cancel</Button>
    <Button variant="danger">Retire device</Button>
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button variant="primary" size="sm">Small</Button>
    <Button variant="primary" size="md">Medium</Button>
    <Button variant="primary" size="lg">Large</Button>
  </div>
);

export const WithIcons = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button variant="primary" icon={<Plus className="h-4 w-4" />}>Register device</Button>
    <Button variant="secondary" icon={<Download className="h-4 w-4" />}>Download report</Button>
    <Button variant="danger" icon={<Trash2 className="h-4 w-4" />}>Delete draft</Button>
  </div>
);

export const States = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button variant="primary" loading loadingLabel="Saving…">Save changes</Button>
    <Button variant="secondary" disabled>Not available</Button>
  </div>
);
