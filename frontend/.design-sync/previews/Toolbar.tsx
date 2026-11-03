import { useState } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { Button, FilterChip, IconButton, Toolbar, ToolbarSearch } from '@treklink/ui';

export const Filters = () => {
  const [q, setQ] = useState('TL-00');
  return (
    <Toolbar
      label="Device tools"
      start={
        <>
          <ToolbarSearch id="tb-q" label="Search devices" placeholder="Asset tag or IMEI" value={q} onChange={setQ} />
          <FilterChip label="Status: Rented" onRemove={() => undefined} />
        </>
      }
      end={
        <>
          <IconButton label="List view" pressed icon={<List />} />
          <IconButton label="Grid view" icon={<LayoutGrid />} />
        </>
      }
    />
  );
};

export const WithSelection = () => (
  <Toolbar
    label="Device tools"
    selection={{ count: 3, onClear: () => undefined, actions: <Button size="sm" variant="danger">Retire 3 devices</Button> }}
  />
);
