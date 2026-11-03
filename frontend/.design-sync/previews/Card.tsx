import { Card, CardHeader, Button } from '@treklink/ui';

export const WithHeader = () => (
  <Card className="max-w-lg">
    <CardHeader title="Handover checklist" description="Contract CT-2026-0142" action={<Button size="sm">Edit</Button>} />
    <ul className="flex flex-col gap-1 text-body text-ink">
      <li>6 devices charged and tested</li>
      <li>Route loaded: Fansipan summit, 2 days</li>
      <li>Emergency contact confirmed</li>
    </ul>
  </Card>
);

export const Paddings = () => (
  <div className="grid max-w-2xl grid-cols-2 gap-4">
    <Card padding="sm"><p className="text-body text-ink">Small padding</p></Card>
    <Card padding="md"><p className="text-body text-ink">Medium padding</p></Card>
  </div>
);

export const GlassOverMap = () => (
  <div className="max-w-lg rounded-panel p-6" style={{ background: 'linear-gradient(135deg, #b9d8c8, #e7efe3 45%, #c9dfe9)' }}>
    <Card surface="glass">
      <p className="font-semibold text-ink">Group Fansipan 14</p>
      <p className="text-body-sm text-ink-muted">6 devices live, last fix 14:32</p>
    </Card>
  </div>
);
