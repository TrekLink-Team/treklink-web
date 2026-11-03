import { Button, Card, CardHeader } from '@treklink/ui';

export const InCard = () => (
  <Card className="max-w-lg">
    <CardHeader title="Payments" description="Deposit and rental fee" action={<Button size="sm" variant="ghost">View all</Button>} />
    <p className="text-body text-ink">Deposit 2,000,000 ₫ received on 1 November.</p>
  </Card>
);

export const TitleOnly = () => (
  <Card className="max-w-lg">
    <CardHeader title="Devices" />
    <p className="text-body text-ink-muted">Six units on this contract.</p>
  </Card>
);
