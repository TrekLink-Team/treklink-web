import React, { useState } from 'react';
import { Button, DataTable, type Column } from '@treklink/ui';

interface Device {
  id: string;
  tag: string;
  model: string;
  status: 'Available' | 'Rented' | 'Maintenance';
  battery: number;
}

const ROWS: Device[] = [
  { id: 'd1', tag: 'TL-0001', model: 'TrekLink Node v2', status: 'Available', battery: 98 },
  { id: 'd2', tag: 'TL-0002', model: 'TrekLink Node v2', status: 'Rented', battery: 64 },
  { id: 'd3', tag: 'TL-0003', model: 'TrekLink Node v1', status: 'Maintenance', battery: 12 },
  { id: 'd4', tag: 'TL-0004', model: 'TrekLink Gateway', status: 'Available', battery: 100 },
];

const COLUMNS: Column<Device, 'tag' | 'model' | 'status' | 'battery'>[] = [
  { key: 'tag', header: 'Asset tag', sortable: true, cell: (r) => <span className="font-mono">{r.tag}</span> },
  { key: 'model', header: 'Model', cell: (r) => r.model },
  { key: 'status', header: 'Status', sortable: true, cell: (r) => r.status },
  { key: 'battery', header: 'Battery', align: 'end', cell: (r) => `${r.battery} %` },
];

export const Devices = () => (
  <DataTable
    caption="Devices"
    columns={COLUMNS as never}
    rows={ROWS}
    rowId={(r: Device) => r.id}
    rowLabel={(r: Device) => r.tag}
    empty={{ title: 'No devices' }}
    sort={{ key: 'tag', direction: 'asc' }}
    onSortChange={() => undefined}
  />
);

export const WithSelection = () => {
  const [selected, setSelected] = useState<Set<string>>(new Set(['d1', 'd4']));
  return (
    <DataTable
      caption="Devices"
      columns={COLUMNS as never}
      rows={ROWS}
      rowId={(r: Device) => r.id}
      rowLabel={(r: Device) => r.tag}
      noun={{ one: 'device', other: 'devices' }}
      empty={{ title: 'No devices' }}
      selectedIds={selected}
      onSelectionChange={setSelected}
      bulkActions={({ ids }) => <Button size="sm">Retire {ids.size} devices</Button>}
    />
  );
};

export const Empty = () => (
  <DataTable
    caption="Devices"
    columns={COLUMNS as never}
    rows={[]}
    rowId={(r: Device) => r.id}
    empty={{ title: 'No devices match these filters', description: 'Clear a filter or register a new device.' }}
  />
);

export const Loading = () => (
  <DataTable caption="Devices" columns={COLUMNS as never} rows={[]} rowId={(r: Device) => r.id} loading empty={{ title: 'No devices' }} />
);
