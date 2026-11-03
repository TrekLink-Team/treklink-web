import { Stepper } from '@treklink/ui';

const STEPS = [
  { label: 'Group', description: 'Leader and trekkers' },
  { label: 'Route', description: 'Dates and stations' },
  { label: 'Devices', description: 'Pick the units' },
  { label: 'Review', description: 'Deposit and signature' },
];

export const InProgress = () => (
  <div className="max-w-3xl">
    <Stepper steps={STEPS} current={2} />
  </div>
);

export const FirstStep = () => (
  <div className="max-w-3xl">
    <Stepper steps={STEPS.slice(0, 3)} current={0} />
  </div>
);
