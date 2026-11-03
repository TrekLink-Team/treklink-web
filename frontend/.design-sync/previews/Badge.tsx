import { Badge } from '@treklink/ui';

export const Tones = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge tone="critical">SOS active</Badge>
    <Badge tone="attention">Overdue</Badge>
    <Badge tone="active">On trek</Badge>
    <Badge tone="waiting">Awaiting deposit</Badge>
    <Badge tone="done">Paid</Badge>
    <Badge tone="ended">Closed</Badge>
  </div>
);

export const Neutral = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge>Node v2</Badge>
    <Badge>Sa Pa station</Badge>
    <Badge tone="active" glyph={false}>3 trekkers</Badge>
  </div>
);
