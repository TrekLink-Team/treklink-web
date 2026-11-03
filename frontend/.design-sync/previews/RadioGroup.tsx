import { useState } from 'react';
import { RadioGroup } from '@treklink/ui';

const OPTIONS = [
  { value: 'cash', label: 'Cash at the station' },
  { value: 'transfer', label: 'Bank transfer', description: 'Shown as paid once the bank confirms.' },
  { value: 'card', label: 'Card', disabled: true, description: 'Not available yet.' },
];

export const Column = () => {
  const [value, setValue] = useState<string | undefined>('transfer');
  return <RadioGroup name="pay" legend="Deposit payment" options={OPTIONS} value={value} onChange={setValue} required />;
};

export const RowWithError = () => {
  const [value, setValue] = useState<string | undefined>(undefined);
  return (
    <RadioGroup
      name="size"
      legend="Group size"
      layout="row"
      options={[{ value: 'small', label: '1 to 4' }, { value: 'mid', label: '5 to 10' }, { value: 'large', label: 'More than 10' }]}
      value={value}
      onChange={setValue}
      error="Choose a group size."
    />
  );
};
