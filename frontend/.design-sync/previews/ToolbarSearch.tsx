import { useState } from 'react';
import { ToolbarSearch } from '@treklink/ui';

export const Empty = () => {
  const [q, setQ] = useState('');
  return <ToolbarSearch id="s1" label="Search contracts" placeholder="Contract code or group" value={q} onChange={setQ} />;
};

export const WithQuery = () => {
  const [q, setQ] = useState('Fansipan');
  return <ToolbarSearch id="s2" label="Search contracts" value={q} onChange={setQ} />;
};
