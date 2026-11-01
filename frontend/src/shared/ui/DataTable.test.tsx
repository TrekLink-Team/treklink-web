// @vitest-environment jsdom
import React, { useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { DataTable, type Column, type DataTableProps, type RowAction, type SortState } from './DataTable';

afterEach(cleanup);

interface Device {
  id: string;
  tag: string;
  status: string;
}

const PAGE_1: Device[] = [
  { id: 'a1b2', tag: 'TL-0001', status: 'Available' },
  { id: 'c3d4', tag: 'TL-0002', status: 'Rented' },
  { id: 'e5f6', tag: 'TL-0003', status: 'Available' },
  { id: 'g7h8', tag: 'TL-0004', status: 'Maintenance' },
];
const PAGE_2: Device[] = [{ id: 'i9j0', tag: 'TL-0005', status: 'Available' }];

const COLUMNS: Column<Device, 'tag' | 'status'>[] = [
  { key: 'tag', header: 'Asset tag', sortable: true, cell: (row) => row.tag },
  { key: 'status', header: 'Status', sortable: true, cell: (row) => row.status },
];

type Extra = Partial<DataTableProps<Device, 'tag' | 'status'>>;

const Harness: React.FC<{ rows?: Device[]; extra?: Extra; onBulk?: (ids: string[], all: boolean) => void }> = ({
  rows = PAGE_1,
  extra = {},
  onBulk = () => undefined,
}) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  return (
    <DataTable<Device, 'tag' | 'status'>
      caption="Devices"
      columns={COLUMNS}
      rows={rows}
      rowId={(row) => row.id}
      rowLabel={(row) => row.tag}
      noun={{ one: 'device', other: 'devices' }}
      empty={{ title: 'No devices' }}
      selectedIds={selected}
      onSelectionChange={setSelected}
      allResultsSelected={all}
      onSelectAllResults={setAll}
      bulkActions={({ ids, allResults }) => (
        <Button size="sm" onClick={() => onBulk([...ids], allResults)}>
          Retire {allResults ? 'all' : ids.size} devices
        </Button>
      )}
      {...extra}
    />
  );
};

const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
const status = () => screen.getAllByRole('status').find((node) => node.className.includes('sr-only'))!;

describe('DataTable selection', () => {
  it('names each row checkbox from rowLabel, never the id', () => {
    render(<Harness />);
    expect(box('Select TL-0001')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /a1b2/ })).toBeNull();
    expect(box('Select all rows on this page')).toBeTruthy();
  });

  it('gives the checkbox a 40 px hit area and the shared focus ring', () => {
    render(<Harness />);
    const input = box('Select TL-0001');
    expect(input.className).toContain('focus-visible:outline-focus');
    expect(input.closest('label')?.className).toContain('h-10 w-10');
  });

  it('makes the header box tri-state with aria-checked="mixed"', () => {
    render(<Harness />);
    const header = box('Select all rows on this page');
    expect(header.checked).toBe(false);
    expect(header.getAttribute('aria-checked')).toBeNull();
    fireEvent.click(box('Select TL-0002'));
    expect(header.indeterminate).toBe(true);
    expect(header.getAttribute('aria-checked')).toBe('mixed');
    fireEvent.click(header);
    expect(header.checked).toBe(true);
    expect(header.getAttribute('aria-checked')).toBeNull();
    expect(PAGE_1.every((row) => box(`Select ${row.tag}`).checked)).toBe(true);
    fireEvent.click(header);
    expect(PAGE_1.some((row) => box(`Select ${row.tag}`).checked)).toBe(false);
  });

  it('selects a range with Shift-click, and clears a range the same way', () => {
    render(<Harness />);
    fireEvent.click(box('Select TL-0001'));
    fireEvent.click(box('Select TL-0004'), { shiftKey: true });
    expect(PAGE_1.map((row) => box(`Select ${row.tag}`).checked)).toEqual([true, true, true, true]);
    fireEvent.click(box('Select TL-0003'));
    fireEvent.click(box('Select TL-0002'), { shiftKey: true });
    expect(PAGE_1.map((row) => box(`Select ${row.tag}`).checked)).toEqual([true, false, false, true]);
  });

  it('shows the bulk bar on the first selection and announces the count in a status region', () => {
    render(<Harness />);
    const region = status();
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
    expect(screen.queryByRole('group', { name: 'Bulk actions' })).toBeNull();
    fireEvent.click(box('Select TL-0001'));
    expect(region.textContent).toBe('1 device selected');
    const bar = screen.getByRole('group', { name: 'Bulk actions' });
    expect(within(bar).getByText('1 device selected')).toBeTruthy();
    fireEvent.click(box('Select TL-0002'));
    expect(region.textContent).toBe('2 devices selected');
    expect(within(bar).getByRole('button', { name: 'Retire 2 devices' })).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    expect(region.textContent).toBe('');
    expect(screen.queryByRole('group', { name: 'Bulk actions' })).toBeNull();
  });

  it('keeps the selection across pages and offers Select all N results with an API total', () => {
    const onBulk = vi.fn();
    const Paged: React.FC = () => {
      const [page, setPage] = useState(1);
      return (
        <>
          <button type="button" onClick={() => setPage(page === 1 ? 2 : 1)}>
            Flip page
          </button>
          <Harness rows={page === 1 ? PAGE_1 : PAGE_2} extra={{ totalCount: 12 }} onBulk={onBulk} />
        </>
      );
    };
    render(<Paged />);
    fireEvent.click(box('Select TL-0002'));
    fireEvent.click(screen.getByRole('button', { name: 'Flip page' }));
    fireEvent.click(box('Select TL-0005'));
    expect(status().textContent).toBe('2 devices selected');
    fireEvent.click(screen.getByRole('button', { name: 'Flip page' }));
    expect(box('Select TL-0002').checked).toBe(true);
    expect(screen.queryByRole('button', { name: 'Select all 12 devices' })).toBeNull();
    fireEvent.click(box('Select all rows on this page'));
    fireEvent.click(screen.getByRole('button', { name: 'Select all 12 devices' }));
    expect(status().textContent).toBe('All 12 devices selected');
    fireEvent.click(screen.getByRole('button', { name: 'Retire all devices' }));
    expect(onBulk).toHaveBeenCalledWith(expect.any(Array), true);
    fireEvent.click(box('Select TL-0001'));
    expect(status().textContent).toBe('4 devices selected');
  });

  it('disables row actions while the bulk bar shows, with the reason as description', () => {
    const onEdit = vi.fn();
    render(
      <Harness
        extra={{ rowActions: (row): RowAction[] => [{ key: 'edit', label: 'Edit', onSelect: () => onEdit(row.tag) }] }}
      />,
    );
    const edit = screen.getByRole('button', { name: 'Edit TL-0001' });
    fireEvent.click(edit);
    expect(onEdit).toHaveBeenCalledWith('TL-0001');
    fireEvent.click(box('Select TL-0002'));
    const disabled = screen.getByRole('button', { name: 'Edit TL-0001' });
    expect(disabled.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(disabled.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Clear the selection to use row actions.',
    );
    fireEvent.click(disabled);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('renders fewer than three row actions inline and three or more as a named menu button', () => {
    const two = (): RowAction[] => [
      { key: 'edit', label: 'Edit', onSelect: () => undefined },
      { key: 'copy', label: 'Duplicate', onSelect: () => undefined },
    ];
    const { unmount } = render(<Harness extra={{ rowActions: two }} />);
    expect(screen.getByRole('button', { name: 'Duplicate TL-0003' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Actions for TL-0003' })).toBeNull();
    unmount();
    render(<Harness extra={{ rowActions: () => [...two(), { key: 'retire', label: 'Retire', onSelect: () => undefined }] }} />);
    const menuButton = screen.getByRole('button', { name: 'Actions for TL-0003' });
    expect(menuButton.getAttribute('aria-haspopup')).toBe('menu');
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(menuButton);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Edit', 'Duplicate', 'Retire']);
  });
});

describe('DataTable sorting and activation', () => {
  it('puts aria-sort on the sorted column only and sorts through a header button', () => {
    const onSort = vi.fn();
    const sort: SortState<'tag' | 'status'> = { key: 'tag', direction: 'asc' };
    render(<Harness extra={{ sort, onSortChange: onSort }} />);
    const headers = screen.getAllByRole('columnheader');
    const tag = headers.find((node) => node.textContent === 'Asset tag')!;
    const statusHeader = headers.find((node) => node.textContent === 'Status')!;
    expect(tag.getAttribute('aria-sort')).toBe('ascending');
    expect(statusHeader.getAttribute('aria-sort')).toBeNull();
    fireEvent.click(within(tag).getByRole('button', { name: 'Asset tag' }));
    expect(onSort).toHaveBeenCalledWith({ key: 'tag', direction: 'desc' });
    fireEvent.click(within(statusHeader).getByRole('button', { name: 'Status' }));
    expect(onSort).toHaveBeenLastCalledWith({ key: 'status', direction: 'asc' });
  });

  it('opens a row through a button in the first column, by keyboard or by a click on the row', () => {
    const onActivate = vi.fn();
    render(<Harness extra={{ onRowActivate: onActivate }} />);
    const open = screen.getByRole('button', { name: 'TL-0002' });
    expect(open.tagName).toBe('BUTTON');
    fireEvent.click(open);
    expect(onActivate).toHaveBeenLastCalledWith(PAGE_1[1]);
    fireEvent.click(screen.getByText('Maintenance'));
    expect(onActivate).toHaveBeenLastCalledWith(PAGE_1[3]);
    fireEvent.click(box('Select TL-0003'));
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('turns the activation column into a link when rowHref is given', () => {
    render(
      <MemoryRouter initialEntries={['/t/fleet']}>
        <Routes>
          <Route path="/t/fleet" element={<Harness extra={{ rowHref: (row) => `/t/devices/${row.id}` }} />} />
          <Route path="/t/devices/:id" element={<p>Device page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'TL-0001' });
    expect(link.getAttribute('href')).toBe('/t/devices/a1b2');
    fireEvent.click(screen.getAllByText('Available')[1]);
    expect(screen.getByText('Device page')).toBeTruthy();
  });

  it('replaces the table with the empty state and its one next step', () => {
    render(<Harness rows={[]} extra={{ empty: { title: 'No devices', action: <Button>Register device</Button> } }} />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('No devices')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Register device' })).toBeTruthy();
  });
});
