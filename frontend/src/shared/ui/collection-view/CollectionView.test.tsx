// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pencil } from 'lucide-react';
import { Menu } from '../Menu';
import { StateChangeMenu } from '../StateChange';
import { CollectionView, SEARCH_ANNOUNCE_MS, SELECTION_CLEARED, type CollectionViewProps } from './CollectionView';
import { EMPTY_SELECTION, keepVisible, pageSelection, toggleAll, toggleItem } from './selection';
import type { CollectionField } from './types';
import { CollectionPaneHost } from './CollectionPaneHost';

interface Unit {
  id: string;
  tag: string;
  status: 'Active' | 'Inactive';
  battery: number;
}

const UNITS: Unit[] = [
  { id: 'a', tag: 'TL-0001', status: 'Active', battery: 80 },
  { id: 'b', tag: 'TL-0002', status: 'Inactive', battery: 20 },
  { id: 'c', tag: 'TL-0003', status: 'Active', battery: 55 },
  { id: 'd', tag: 'TL-0004', status: 'Active', battery: 91 },
];

const FIELDS: CollectionField<Unit>[] = [
  { key: 'status', label: 'Status', render: (unit) => unit.status, text: (unit) => unit.status, compact: true },
  {
    key: 'battery',
    label: 'Battery',
    render: (unit) => `${unit.battery}%`,
    sortValue: (unit) => unit.battery,
    sortable: true,
    align: 'end',
  },
];

const checkIn = vi.fn();
const edit = vi.fn();
const retire = vi.fn();

const renderView = (props: Partial<CollectionViewProps<Unit>> = {}) =>
  render(
    <MemoryRouter>
      <CollectionView<Unit>
        label="Units of CT-0042"
        items={UNITS}
        itemId={(unit) => unit.id}
        itemName={(unit) => unit.tag}
        fields={FIELDS}
        noun={{ one: 'unit', other: 'units' }}
        itemActions={[{ key: 'edit', label: 'Edit', icon: <Pencil />, onSelect: edit }]}
        transitions={(unit) =>
          unit.status === 'Active'
            ? [
                { key: 'retire', label: 'Retire device', destructive: true, onSelect: retire },
                { key: 'inactive', label: 'Mark inactive', onSelect: vi.fn() },
              ]
            : [{ key: 'active', label: 'Mark active', onSelect: vi.fn() }]
        }
        status={{ field: 'status', value: (unit) => ({ label: unit.status, tone: unit.status === 'Active' ? 'active' : 'ended' }) }}
        bulkActions={[{ key: 'checkin', label: (count) => `Check in ${count} units`, onSelect: checkIn }]}
        search={{ label: 'Search units' }}
        filters={[
          { key: 'all', label: 'All' },
          { key: 'active', label: 'Active', test: (unit) => unit.status === 'Active' },
        ]}
        emptyState={{ title: 'No units on this contract yet.' }}
        {...props}
      />
    </MemoryRouter>,
  );

const box = (tag: string) => screen.getByRole('checkbox', { name: `Select ${tag}` }) as HTMLInputElement;
const selectAll = () => screen.getByRole('checkbox', { name: /^Select all/ }) as HTMLInputElement;
const live = () => screen.getByRole('status');

beforeEach(() => {
  checkIn.mockReset();
  edit.mockReset();
  retire.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('selection rules (chapter 06 §9.4)', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('toggles one item and sets the anchor; a range selects from the anchor to the item', () => {
    let state = toggleItem(EMPTY_SELECTION, 'b', ids, false);
    expect([...state.selected]).toEqual(['b']);
    expect(state.anchor).toBe('b');
    state = toggleItem(state, 'd', ids, true);
    expect([...state.selected].sort()).toEqual(['b', 'c', 'd']);
    expect(state.anchor).toBe('b');
    state = toggleItem(state, 'c', ids, false);
    expect([...state.selected].sort()).toEqual(['b', 'd']);
  });

  it('select-all covers the current page only and reports none, some or all', () => {
    const one = toggleItem(EMPTY_SELECTION, 'a', ['a', 'b'], false);
    expect(pageSelection(one.selected, ['a', 'b'])).toBe('some');
    const all = toggleAll(one, ['a', 'b']);
    expect([...all.selected].sort()).toEqual(['a', 'b']);
    expect(pageSelection(all.selected, ['a', 'b'])).toBe('all');
    expect(pageSelection(toggleAll(all, ['a', 'b']).selected, ['a', 'b'])).toBe('none');
  });

  it('drops ids that left the page', () => {
    const state = toggleAll(EMPTY_SELECTION, ids);
    expect([...keepVisible(state, ['a', 'c']).selected]).toEqual(['a', 'c']);
  });
});

describe('CollectionView', () => {
  it('renders the Details view as a native table with a caption and column headers', () => {
    renderView();
    const table = screen.getByRole('table', { name: 'Units of CT-0042' });
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Selection',
      'Unit',
      'Status',
      'Battery',
      'Actions',
    ]);
    expect(screen.getByRole('group', { name: 'Units of CT-0042: commands' })).toBeTruthy();
  });

  it('selects with click and Shift+click, shows the count and names bulk actions verb, count, noun', () => {
    renderView();
    fireEvent.click(box('TL-0001'));
    fireEvent.click(box('TL-0003'), { shiftKey: true });
    expect([box('TL-0001'), box('TL-0002'), box('TL-0003'), box('TL-0004')].map((each) => each.checked)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(screen.getByRole('button', { name: 'Clear selection, 3 selected' }).textContent).toContain('3 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Check in 3 units' }));
    expect(checkIn).toHaveBeenCalledWith([UNITS[0], UNITS[1], UNITS[2]]);
    expect(live().textContent).toContain('3 selected');
  });

  it('selects a range with Shift+Space from the keyboard', () => {
    renderView();
    fireEvent.click(box('TL-0002'));
    fireEvent.keyDown(box('TL-0004'), { key: ' ', shiftKey: true });
    fireEvent.click(box('TL-0004'));
    expect([box('TL-0002'), box('TL-0003'), box('TL-0004')].every((each) => each.checked)).toBe(true);
    expect(box('TL-0001').checked).toBe(false);
  });

  it('shows select-all as mixed, then selects the items of this page only', () => {
    renderView({ pageInfo: { total: 57, from: 1, to: 4 }, onQueryChange: vi.fn() });
    fireEvent.click(box('TL-0001'));
    expect(selectAll().indeterminate).toBe(true);
    expect(selectAll().checked).toBe(false);
    fireEvent.click(selectAll());
    expect(selectAll().checked).toBe(true);
    expect(selectAll().indeterminate).toBe(false);
    expect(screen.getByRole('button', { name: 'Clear selection, 4 selected' })).toBeTruthy();
    expect(selectAll().getAttribute('aria-label')).toBe('Select all 4 units on this page');
  });

  it('clears the selection when the search, the filter or the sort changes, and says so', () => {
    renderView();
    fireEvent.click(box('TL-0001'));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search units' }), { target: { value: 'TL' } });
    expect(box('TL-0001').checked).toBe(false);
    expect(live().textContent).toContain(SELECTION_CLEARED);

    fireEvent.click(box('TL-0002'));
    fireEvent.click(screen.getByRole('button', { name: /^Show: All/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Active' }));
    expect(screen.queryByRole('checkbox', { name: 'Select TL-0002' })).toBeNull();
    expect(live().textContent).toContain(SELECTION_CLEARED);
    expect(live().textContent).toContain('Showing Active');

    fireEvent.click(box('TL-0003'));
    fireEvent.click(screen.getByRole('button', { name: 'Battery' }));
    expect(box('TL-0003').checked).toBe(false);
    expect(live().textContent).toContain('Sorted by Battery, ascending');
  });

  it('clears the selection when the page changes a filter of its own, named by resetKey', () => {
    const { rerender } = renderView({ resetKey: 'a' });
    fireEvent.click(box('TL-0001'));
    rerender(
      <MemoryRouter>
        <CollectionView<Unit>
          label="Units of CT-0042"
          items={UNITS}
          itemId={(unit) => unit.id}
          itemName={(unit) => unit.tag}
          fields={FIELDS}
          noun={{ one: 'unit', other: 'units' }}
          bulkActions={[{ key: 'checkin', label: (count) => `Check in ${count} units`, onSelect: checkIn }]}
          emptyState={{ title: 'None' }}
          resetKey="b"
        />
      </MemoryRouter>,
    );
    expect(box('TL-0001').checked).toBe(false);
    expect(live().textContent).toContain(SELECTION_CLEARED);
  });

  it('announces a selection that a page change clears or narrows (review of treklink-web#349)', () => {
    const page = (units: Unit[]) => (
      <MemoryRouter>
        <CollectionView<Unit>
          label="Units of CT-0042"
          items={units}
          itemId={(unit) => unit.id}
          itemName={(unit) => unit.tag}
          fields={FIELDS}
          noun={{ one: 'unit', other: 'units' }}
          bulkActions={[{ key: 'checkin', label: (count) => `Check in ${count} units`, onSelect: checkIn }]}
          emptyState={{ title: 'None' }}
          pageInfo={{ total: 57, from: 1, to: units.length }}
          onQueryChange={vi.fn()}
        />
      </MemoryRouter>
    );
    const { rerender } = render(page(UNITS));
    fireEvent.click(box('TL-0001'));
    fireEvent.click(box('TL-0002'));
    rerender(page(UNITS.slice(1)));
    expect(live().textContent).toContain('1 selected');
    rerender(page([{ id: 'e', tag: 'TL-0021', status: 'Active', battery: 50 }, ...UNITS.slice(2)]));
    expect(live().textContent).toContain(SELECTION_CLEARED);
  });

  it('keeps the command bar of a server page with more records than it shows, and of a narrowed list', () => {
    renderView({ items: UNITS.slice(0, 2), pageInfo: { total: 57, from: 21, to: 22 }, onQueryChange: vi.fn() });
    expect(screen.getByRole('group', { name: 'Units of CT-0042: commands' })).toBeTruthy();
    cleanup();
    renderView({ items: UNITS.slice(0, 1), query: { search: 'TL-0001', filter: 'all', sort: null }, onQueryChange: vi.fn() });
    expect(screen.getByRole('group', { name: 'Units of CT-0042: commands' })).toBeTruthy();
    cleanup();
    // Two records, nothing narrowed: no bar, no checkboxes, the item actions stay (§9.3).
    renderView({ items: UNITS.slice(0, 2) });
    expect(screen.queryByRole('group', { name: 'Units of CT-0042: commands' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit TL-0002' })).toBeTruthy();
  });

  it("opens the page's own record view from Show details, with no pane toggle", () => {
    const view = vi.fn();
    renderView({ onShowDetails: view });
    fireEvent.click(screen.getByRole('button', { name: 'Show details of TL-0003' }));
    expect(view).toHaveBeenCalledWith(UNITS[2]);
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Details pane' })).toBeNull();
  });

  it('keeps the selection when the view changes', () => {
    renderView({ views: ['details', 'list'] });
    fireEvent.click(box('TL-0002'));
    fireEvent.click(screen.getByRole('button', { name: 'View: Details list. Switch to List' }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('list', { name: 'Units of CT-0042' })).toBeTruthy();
    expect(box('TL-0002').checked).toBe(true);
  });

  it('marks the sorted column with aria-sort and leaves the others without it', () => {
    renderView();
    const header = screen.getByRole('button', { name: 'Battery' }).closest('th')!;
    expect(header.getAttribute('aria-sort')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Battery' }));
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'TL-0002',
      'TL-0003',
      'TL-0001',
      'TL-0004',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Battery' }));
    expect(header.getAttribute('aria-sort')).toBe('descending');
    const status = screen.getByRole('columnheader', { name: 'Status' });
    expect(status.getAttribute('aria-sort')).toBeNull();
  });

  it('cycles a header through ascending, descending and the default order, and announces each (§11.2)', () => {
    renderView();
    const button = () => screen.getByRole('button', { name: 'Battery' });
    const header = button().closest('th')!;
    const order = () => screen.getAllByRole('rowheader').map((cell) => cell.textContent);
    expect(header.querySelector('[data-sort-icon="none"]')).not.toBeNull();
    fireEvent.click(button());
    expect(header.querySelector('[data-sort-icon="asc"]')).not.toBeNull();
    fireEvent.click(button());
    expect(order()).toEqual(['TL-0004', 'TL-0001', 'TL-0003', 'TL-0002']);
    fireEvent.click(button());
    expect(header.getAttribute('aria-sort')).toBeNull();
    expect(header.querySelector('[data-sort-icon="none"]')).not.toBeNull();
    expect(order()).toEqual(['TL-0001', 'TL-0002', 'TL-0003', 'TL-0004']);
    expect(live().textContent).toContain('Sorted by Default order');
  });

  it('toggles only the two directions of the column that is the default order', () => {
    const onQueryChange = vi.fn();
    renderView({
      query: { search: '', filter: 'all', sort: null },
      defaultSort: { key: 'battery', direction: 'desc' },
      onQueryChange,
    });
    const header = screen.getByRole('button', { name: 'Battery' }).closest('th')!;
    expect(header.getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(screen.getByRole('button', { name: 'Battery' }));
    expect(onQueryChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: { key: 'battery', direction: 'asc' } }),
    );
    cleanup();
    renderView({
      query: { search: '', filter: 'all', sort: { key: 'battery', direction: 'asc' } },
      defaultSort: { key: 'battery', direction: 'desc' },
      onQueryChange,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Battery' }));
    expect(onQueryChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: { key: 'battery', direction: 'desc' } }),
    );
  });

  it('offers the same orders in the Sort dropdown, with the default order', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: /^Sort: Default/ }));
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Default order (current)', 'Battery, ascending', 'Battery, descending']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Battery, descending' }));
    expect(screen.getByRole('button', { name: 'Battery' }).closest('th')!.getAttribute('aria-sort')).toBe('descending');
  });

  it('sorts on the title column when it carries a sort key, in the headers and the dropdown (W26)', () => {
    renderView({ titleSort: 'tag' });
    const button = () => screen.getByRole('button', { name: 'Unit' });
    const order = () => screen.getAllByRole('rowheader').map((cell) => cell.textContent);
    fireEvent.click(button());
    expect(button().closest('th')!.getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(button());
    expect(button().closest('th')!.getAttribute('aria-sort')).toBe('descending');
    expect(order()).toEqual(['TL-0004', 'TL-0003', 'TL-0002', 'TL-0001']);
    expect(live().textContent).toContain('Sorted by Unit, descending');
    fireEvent.click(screen.getByRole('button', { name: /^Sort: Unit/ }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Default order',
      'Unit, ascending',
      'Unit, descending (current)',
      'Battery, ascending',
      'Battery, descending',
    ]);
  });

  it('sends the title sort to a server-side list', () => {
    const onQueryChange = vi.fn();
    renderView({ titleSort: 'tag', query: { search: '', filter: 'all', sort: null }, onQueryChange });
    fireEvent.click(screen.getByRole('button', { name: 'Unit' }));
    expect(onQueryChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: { key: 'tag', direction: 'asc' } }),
    );
  });

  it('clears the selection on Escape, but closes an open tooltip first', () => {
    renderView();
    fireEvent.click(box('TL-0001'));
    const editButton = screen.getByRole('button', { name: 'Edit TL-0001' });
    fireEvent.focus(editButton);
    expect(screen.getByRole('tooltip').textContent).toBe('Edit');
    fireEvent.keyDown(editButton, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(box('TL-0001').checked).toBe(true);
    fireEvent.keyDown(editButton, { key: 'Escape' });
    expect(box('TL-0001').checked).toBe(false);
    expect(live().textContent).toContain(SELECTION_CLEARED);
  });

  it('closes an open menu on Escape before the selection', () => {
    renderView();
    fireEvent.click(box('TL-0001'));
    fireEvent.click(screen.getByRole('button', { name: /^Sort: Default/ }));
    const first = screen.getAllByRole('menuitem')[0];
    fireEvent.keyDown(first, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(box('TL-0001').checked).toBe(true);
  });

  it('shows the tooltip on hover and on focus, without a title attribute, and names the item', () => {
    renderView();
    const editButton = screen.getByRole('button', { name: 'Edit TL-0002' });
    expect(editButton.getAttribute('title')).toBeNull();
    fireEvent.mouseEnter(editButton.parentElement!);
    expect(screen.getByRole('tooltip').textContent).toBe('Edit');
    fireEvent.mouseLeave(editButton.parentElement!);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(editButton);
    expect(edit).toHaveBeenCalledWith(UNITS[1]);
  });

  it('keeps the tooltip inside the hover area with no gap to cross (1.4.13)', () => {
    renderView();
    const editButton = screen.getByRole('button', { name: 'Edit TL-0001' });
    const wrapper = editButton.parentElement!;
    fireEvent.mouseEnter(wrapper);
    const tooltip = screen.getByRole('tooltip');
    const bridge = tooltip.parentElement!;
    // The tooltip sits inside the button's wrapper, so moving onto it never leaves the hover area,
    // and the space between them is the bridge's own padding, not a margin outside it.
    expect(wrapper.contains(tooltip)).toBe(true);
    expect(bridge.hasAttribute('data-tooltip-bridge')).toBe(true);
    expect(bridge.className).toContain('pb-1.5');
    expect(`${bridge.className} ${tooltip.className}`).not.toMatch(/\bm[bt]-/);
    fireEvent.mouseEnter(tooltip);
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });

  it('lists only allowed transitions, destructive last after a separator, behind a chevron button', () => {
    renderView();
    const button = screen.getByRole('button', { name: 'Active, change status of TL-0001' });
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.querySelector('[data-menu-chevron]')).toBeTruthy();
    fireEvent.click(button);
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Mark inactive',
      'Retire device',
    ]);
    expect(within(menu).getByRole('separator')).toBeTruthy();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Retire device' }));
    expect(retire).toHaveBeenCalledWith([UNITS[0]]);
  });

  it('offers in the bulk menu only the transitions allowed for every selected item', () => {
    renderView({ bulkTransitions: true });
    fireEvent.click(box('TL-0001'));
    fireEvent.click(box('TL-0003'));
    fireEvent.click(screen.getByRole('button', { name: 'Change status. Change status of 2 units' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Mark inactive',
      'Retire device',
    ]);
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Escape' });
    fireEvent.click(box('TL-0002'));
    expect(screen.queryByRole('button', { name: /Change status of 3 units/ })).toBeNull();
  });

  it('offers transitions per item only unless the page handles the selection (review of #350)', () => {
    renderView();
    fireEvent.click(box('TL-0001'));
    fireEvent.click(box('TL-0003'));
    expect(screen.queryByRole('button', { name: /Change status of 2 units/ })).toBeNull();
    // The row's badge menu is disabled while a selection exists (§11.3).
    expect((screen.getByRole('button', { name: /change status of TL-0001$/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('makes the status badge the menu button, with no Status change column (§11.3)', () => {
    renderView({
      transitions: (unit) =>
        unit.id === 'a' ? [{ key: 'inactive', label: 'Mark inactive', onSelect: vi.fn() }] : [],
    });
    expect(screen.queryByRole('columnheader', { name: 'Status change' })).toBeNull();
    const badge = screen.getByRole('button', { name: 'Active, change status of TL-0001' });
    // The visible text is the status; the name starts with it (2.5.3).
    expect(badge.textContent?.replace('●', '')).toBe('Active');
    expect(badge.getAttribute('aria-expanded')).toBe('false');
    expect(badge.querySelector('[data-status-badge="interactive"]')).not.toBeNull();
    expect(badge.querySelector('[data-menu-chevron]')).not.toBeNull();
    expect(badge.closest('td')).not.toBeNull();
    // No allowed transition: a plain badge, no chevron, not a button.
    expect(screen.queryByRole('button', { name: /change status of TL-0003/ })).toBeNull();
    const row = screen.getByRole('rowheader', { name: 'TL-0003' }).closest('tr')!;
    expect(within(row).getByText('Active').closest('button')).toBeNull();
    expect(row.querySelector('[data-menu-chevron]')).toBeNull();
  });

  it('opens the badge menu from the keyboard and returns focus to the badge on Escape', () => {
    renderView();
    const badge = screen.getByRole('button', { name: 'Active, change status of TL-0001' });
    badge.focus();
    fireEvent.keyDown(badge, { key: 'ArrowDown' });
    expect(badge.getAttribute('aria-expanded')).toBe('true');
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Mark inactive', 'Retire device']);
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(badge);
    fireEvent.keyDown(badge, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[1]);
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(retire).toHaveBeenCalledWith([UNITS[0]]);
  });

  describe('item action slots (chapter 06 §11.4)', () => {
    const actionNames = (tag: string) => {
      const row = screen.getByRole('rowheader', { name: tag }).closest('tr')!;
      const cell = row.lastElementChild!;
      return within(cell as HTMLElement)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label'));
    };

    it('puts Show details last at the inline end, and keeps a slot for an unavailable action', () => {
      renderView({
        itemActions: [
          { key: 'edit', label: 'Edit', icon: <Pencil />, onSelect: edit },
          {
            key: 'charge',
            label: 'Charge',
            icon: <Pencil />,
            allowed: (unit) => unit.status === 'Active',
            unavailableReason: () => 'Only an active unit charges',
            onSelect: vi.fn(),
          },
        ],
      });
      expect(actionNames('TL-0001')).toEqual(['Edit TL-0001', 'Charge TL-0001', 'Show details of TL-0001']);
      // TL-0002 is inactive: Charge keeps its slot, disabled with its reason, so nothing shifts.
      expect(actionNames('TL-0002')).toEqual(['Edit TL-0002', 'Charge TL-0002', 'Show details of TL-0002']);
      const charge = screen.getByRole('button', { name: 'Charge TL-0002' });
      expect(charge.getAttribute('aria-disabled')).toBe('true');
      const cell = charge.closest('td')!;
      expect(cell.querySelector('span')!.className).toContain('justify-end');
    });

    it('leaves out for the whole list an action no item may take, as a role never has it', () => {
      renderView({
        itemActions: [
          { key: 'edit', label: 'Edit', icon: <Pencil />, onSelect: edit },
          { key: 'purge', label: 'Purge', icon: <Pencil />, allowed: () => false, onSelect: vi.fn() },
        ],
      });
      expect(screen.queryByRole('button', { name: /^Purge/ })).toBeNull();
      expect(actionNames('TL-0003')).toEqual(['Edit TL-0003', 'Show details of TL-0003']);
    });

    it('gathers three or more slots into one overflow menu next to Show details', () => {
      renderView({
        itemActions: [
          { key: 'edit', label: 'Edit', icon: <Pencil />, onSelect: edit },
          { key: 'off', label: 'Deactivate', slot: 'active', icon: <Pencil />, allowed: (unit) => unit.status === 'Active', onSelect: vi.fn() },
          { key: 'on', label: 'Reactivate', slot: 'active', icon: <Pencil />, allowed: (unit) => unit.status !== 'Active', onSelect: vi.fn() },
          { key: 'delete', label: 'Delete', icon: <Pencil />, destructive: true, onSelect: vi.fn() },
        ],
      });
      expect(actionNames('TL-0002')).toEqual(['More actions for TL-0002', 'Show details of TL-0002']);
      fireEvent.click(screen.getByRole('button', { name: 'More actions for TL-0002' }));
      // Deactivate and Reactivate share one slot: the inactive unit shows Reactivate.
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Edit', 'Reactivate', 'Delete']);
    });
  });

  it('keeps one polite live region from the first render and announces the result count', () => {
    vi.useFakeTimers();
    renderView();
    expect(live().getAttribute('aria-live')).toBe('polite');
    expect(live().textContent).toBe('');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search units' }), { target: { value: '0004' } });
    expect(live().textContent).not.toContain('1 unit');
    act(() => {
      vi.advanceTimersByTime(SEARCH_ANNOUNCE_MS);
    });
    expect(live().textContent).toContain('1 unit');
    expect(screen.getByText('1 match')).toBeTruthy();
  });

  it('announces a server page as total and range', () => {
    const { rerender } = renderView({ pageInfo: { total: 57, from: 1, to: 4 }, onQueryChange: vi.fn() });
    rerender(
      <MemoryRouter>
        <CollectionView<Unit>
          label="Units of CT-0042"
          items={UNITS.slice(0, 2)}
          itemId={(unit) => unit.id}
          itemName={(unit) => unit.tag}
          fields={FIELDS}
          noun={{ one: 'unit', other: 'units' }}
          emptyState={{ title: 'None' }}
          pageInfo={{ total: 57, from: 21, to: 22 }}
          onQueryChange={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(live().textContent).toContain('57 units, showing 21 to 22');
  });

  it('shows the empty state, and the no-match state with a way out', () => {
    renderView({ items: [] });
    expect(screen.getByText('No units on this contract yet.')).toBeTruthy();
    cleanup();
    renderView();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search units' }), { target: { value: 'nothing' } });
    expect(screen.getByText('No results match your filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filter' }));
    expect(screen.getAllByRole('rowheader')).toHaveLength(4);
  });

  it('hides the command bar of a list with nothing to filter, sort or switch, keeping item actions', () => {
    renderView({ items: UNITS.slice(0, 2), bulkActions: [], transitions: undefined, search: undefined, filters: undefined });
    expect(screen.queryByRole('group', { name: 'Units of CT-0042: commands' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit TL-0001' })).toBeTruthy();
  });

  it('opens the details pane beside the list with focus on its heading; Escape closes it', () => {
    renderView({ details: { href: (unit) => `/t/devices/${unit.id}` } });
    const show = screen.getByRole('button', { name: 'Show details of TL-0002' });
    show.focus();
    fireEvent.click(show);
    const pane = screen.getByRole('complementary', { name: 'TL-0002' });
    expect(document.activeElement).toBe(within(pane).getByRole('heading', { name: 'TL-0002' }));
    expect(within(pane).getByRole('button', { name: 'Edit TL-0002' })).toBeTruthy();
    expect(within(pane).getByRole('link', { name: 'Open TL-0002' }).getAttribute('href')).toBe('/t/devices/b');
    expect(screen.getByRole('button', { name: 'Details pane' }).getAttribute('aria-pressed')).toBe('true');
    // Pushed aside: the Status change column leaves, the pane holds that dropdown.
    expect(screen.queryByRole('columnheader', { name: 'Status change' })).toBeNull();
    fireEvent.keyDown(within(pane).getByRole('heading', { name: 'TL-0002' }), { key: 'Escape' });
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(document.activeElement).toBe(show);
  });
});

// matchMedia answering one viewport width, for the placements of chapter 06 §10.8.
const atWidth = (width: number) =>
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return {
      matches: width >= min,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  });

describe('command bar placement (chapter 06 §9.3, §11.1, W30)', () => {
  const bar = () => screen.getByRole('group', { name: 'Units of CT-0042: commands' }).parentElement!;

  it('is one row above the items and never sticky, with no page-header offset', () => {
    renderView();
    expect(bar().className).not.toMatch(/(^|\s)sticky(\s|$)/);
    expect(bar().style.top).toBe('');
    const table = screen.getByRole('table', { name: 'Units of CT-0042' });
    expect(bar().compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('stays outside the scrolling item box on a fit page, in every view', () => {
    const { container } = render(
      <MemoryRouter>
        <div data-fit-page="">
          <CollectionView<Unit>
            label="Units of CT-0042"
            items={UNITS}
            itemId={(unit) => unit.id}
            itemName={(unit) => unit.tag}
            fields={FIELDS}
            noun={{ one: 'unit', other: 'units' }}
            search={{ label: 'Search units' }}
            emptyState={{ title: 'None' }}
          />
        </div>
      </MemoryRouter>,
    );
    const section = container.querySelector('[data-fit-page] > [data-cv]')!;
    const tableBox = screen.getByRole('table').parentElement!;
    expect(tableBox.contains(bar())).toBe(false);
    expect(bar().parentElement).toBe(section);
    expect(bar().className).toMatch(/shrink-0/);
  });
});

describe('details pane placement (chapter 06 §9.8, §10.8)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens a Drawer from the right between 600 and 1100 px, trapping focus and returning it', () => {
    atWidth(834);
    renderView();
    const show = screen.getByRole('button', { name: 'Show details of TL-0003' });
    show.focus();
    fireEvent.click(show);
    const drawer = screen.getByRole('dialog', { name: 'TL-0003' });
    expect(drawer.getAttribute('aria-modal')).toBe('true');
    expect(drawer.className).toContain('right-0');
    expect(drawer.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(show);
  });

  it('opens a bottom sheet below 600 px, from Show details first in the item Actions menu', () => {
    atWidth(360);
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for TL-0001' }));
    const items = screen.getAllByRole('menuitem');
    expect(items[0].textContent).toBe('Show details');
    // The badge menu stays on the row, so the Actions dropdown holds no status items (§11.3).
    expect(items.map((item) => item.textContent).some((text) => text?.startsWith('Change status'))).toBe(false);
    expect(screen.getByRole('button', { name: 'Active, change status of TL-0001' })).toBeTruthy();
    fireEvent.click(items[0]);
    const sheet = screen.getByRole('dialog', { name: 'TL-0001' });
    expect(sheet.className).toContain('bottom-0');
  });

  it('shows the fields, the labelled actions with an unavailable reason as text, and the status menu', () => {
    renderView({
      itemActions: [
        { key: 'edit', label: 'Edit', icon: <Pencil />, onSelect: edit, unavailableReason: (unit) => (unit.status === 'Inactive' ? 'Only an active unit is edited' : undefined) },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show details of TL-0002' }));
    const pane = within(screen.getByRole('complementary', { name: 'TL-0002' }));
    expect(pane.getByText('Battery')).toBeTruthy();
    expect(pane.getByText('20%')).toBeTruthy();
    const editButton = pane.getByRole('button', { name: 'Edit TL-0002' }) as HTMLButtonElement;
    expect(editButton.disabled).toBe(true);
    expect(pane.getByText('Only an active unit is edited')).toBeTruthy();
    expect(pane.getByRole('button', { name: 'Status: Inactive. Change status of TL-0002' })).toBeTruthy();
  });
});

describe('CollectionPaneHost (chapter 06 §10.8 paneHost)', () => {
  const list = (label: string, units: Unit[]) => (
    <CollectionView<Unit>
      label={label}
      items={units}
      itemId={(unit) => unit.id}
      itemName={(unit) => unit.tag}
      fields={[...FIELDS, { key: 'note', label: 'Note', render: () => 'Shown in the pane', hideWithPane: true }]}
      noun={{ one: 'unit', other: 'units' }}
      emptyState={{ title: 'None' }}
    />
  );

  const renderHost = () =>
    render(
      <MemoryRouter>
        <CollectionPaneHost>
          {list('Invoices', UNITS.slice(0, 2))}
          {list('Payments', UNITS.slice(2))}
        </CollectionPaneHost>
      </MemoryRouter>,
    );

  it('shows one pane beside both lists and drops the columns it shows from every list', () => {
    renderHost();
    expect(screen.getAllByRole('columnheader', { name: 'Note' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Show details of TL-0001' }));
    const host = document.querySelector('[data-pane-host]')!;
    const pane = screen.getByRole('complementary', { name: 'TL-0001' });
    expect(pane.parentElement?.parentElement).toBe(host);
    expect(screen.queryAllByRole('columnheader', { name: 'Note' })).toHaveLength(0);
  });

  it('hands the pane to the other list when it opens an item, and closes for both', () => {
    renderHost();
    fireEvent.click(screen.getByRole('button', { name: 'Show details of TL-0001' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show details of TL-0004' }));
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
    expect(screen.getByRole('complementary', { name: 'TL-0004' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close details of TL-0004' }));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.getAllByRole('columnheader', { name: 'Note' })).toHaveLength(2);
  });
});

describe('dropdown buttons draw a chevron (chapter 06 §10.3)', () => {
  it('draws it in Menu by default, decorative, and leaves it out on request', () => {
    render(
      <>
        <Menu label="More actions" items={[{ key: 'a', label: 'A', onSelect: vi.fn() }]} />
        <Menu label="Choose view" chevron={false} items={[{ key: 'a', label: 'A', onSelect: vi.fn() }]} />
      </>,
    );
    const more = screen.getByRole('button', { name: 'More actions' });
    expect(more.querySelector('[data-menu-chevron]')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('button', { name: 'Choose view' }).querySelector('[data-menu-chevron]')).toBeNull();
  });

  it('gives StateChangeMenu the chevron, the current status and destructive items last', () => {
    render(
      <StateChangeMenu
        subject="TL-0042"
        currentLabel="Available"
        version={1}
        onSubmit={vi.fn()}
        transitions={[
          { target: 'RETIRED', label: 'Retire device', destructive: true, description: 'Leaves the fleet.' },
          { target: 'MAINTENANCE', label: 'Send to maintenance' },
        ]}
      />,
    );
    const button = screen.getByRole('button', { name: 'Status: Available. Change status of TL-0042' });
    expect(button.textContent).toBe('Status: Available');
    expect(button.querySelector('[data-menu-chevron]')).toBeTruthy();
    fireEvent.click(button);
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Send to maintenance',
      'Retire device',
    ]);
  });
});
