import { useState } from 'react';
import { Switch } from '@treklink/ui';

export const Settings = () => {
  const [sms, setSms] = useState(true);
  const [email, setEmail] = useState(false);
  return (
    <div className="flex max-w-md flex-col gap-1 rounded-card border border-line bg-surface px-4 py-2">
      <Switch label="SMS alerts on SOS" description="Sent to the station manager at once." checked={sms} onChange={setSms} />
      <Switch label="Daily email summary" checked={email} onChange={setEmail} />
      <Switch label="Share positions with rescue" checked disabled onChange={() => undefined} />
    </div>
  );
};
