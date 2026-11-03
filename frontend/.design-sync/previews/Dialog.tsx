import { Button, Dialog, Field, Input, Select } from '@treklink/ui';

export const EditForm = () => (
  <Dialog
    titleId="edit-group"
    title="Edit trek group"
    description="Changes apply to every device in contract CT-2026-0142."
    onClose={() => undefined}
    showClose
    footer={
      <>
        <Button variant="ghost">Cancel</Button>
        <Button variant="primary">Save group</Button>
      </>
    }
  >
    <div className="flex flex-col gap-4">
      <Field id="g-name" label="Group name">
        <Input id="g-name" defaultValue="Fansipan 14" />
      </Field>
      <Field id="g-route" label="Route">
        <Select id="g-route" defaultValue="fansipan">
          <option value="fansipan">Fansipan summit, 2 days</option>
          <option value="ta-xua">Tà Xùa, 2 days</option>
        </Select>
      </Field>
    </div>
  </Dialog>
);
