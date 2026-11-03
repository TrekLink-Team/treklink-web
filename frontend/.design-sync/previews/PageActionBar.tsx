import { Button, PageActionBar } from '@treklink/ui';

export const FormSteps = () => (
  <div className="relative rounded-panel bg-ground" style={{ height: 200, overflowY: 'auto' }}>
    <div className="px-4 py-6 text-body text-ink-muted">Step 3 of 4: pick the devices for this contract.</div>
    <PageActionBar label="Contract steps" start={<Button variant="ghost">Save draft</Button>}>
      <Button>Back</Button>
      <Button variant="primary">Continue to review</Button>
    </PageActionBar>
  </div>
);
