// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceGroup } from '../../entities/rented-device/api';
import { GroupTree } from './GroupTree';

const media = vi.hoisted(() => ({ compact: false }));
vi.mock('../../shared/lib/useMediaQuery', () => ({ useMediaQuery: () => media.compact }));

const child: DeviceGroup = {
  id: 'child',
  name: 'Radio crew',
  parentId: 'parent',
  children: [],
  label: null,
  startsOn: null,
  endsOn: null,
  areaNote: null,
  version: 1,
  deviceCount: 1,
};
const parent: DeviceGroup = {
  ...child,
  id: 'parent',
  name: 'North Ridge',
  parentId: null,
  label: 'Patrol A',
  startsOn: '2026-11-05',
  endsOn: '2026-11-06',
  deviceCount: 2,
  children: [child],
};
const show = (groups = [parent], loading = false) => {
  const actions = { onSelect: vi.fn(), onCreate: vi.fn(), onEdit: vi.fn(), onRemove: vi.fn() };
  render(<GroupTree groups={groups} loading={loading} selected="" {...actions} />);
  return actions;
};
afterEach(() => {
  cleanup();
  media.compact = false;
});

describe('GroupTree', () => {
  it('folds the short-phone controls and restores focus after choosing a group or Escape', () => {
    media.compact = true;
    const actions = show();
    const toggle = screen.getByRole('button', { name: 'Groups: All groups' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Group')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'child' } });
    expect(actions.onSelect).toHaveBeenCalledWith('child');
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    fireEvent.keyDown(screen.getByLabelText('Group'), { key: 'Escape' });
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
  it('moves focus through the hierarchy and selects a group using the keyboard', () => {
    const actions = show();
    const tree = within(screen.getByRole('tree', { name: 'Filter by device group' }));
    const all = tree.getByRole('treeitem', { name: 'All groups' });
    const north = tree.getByRole('treeitem', {
      name: 'North Ridge 2 devices Patrol A From 2026-11-05 · Until 2026-11-06',
    });
    const radio = tree.getByRole('treeitem', { name: 'Radio crew 1 device' });
    const none = tree.getByRole('treeitem', { name: 'No group' });
    act(() => all.focus());
    fireEvent.keyDown(all, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(north);
    fireEvent.keyDown(north, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(radio);
    fireEvent.keyDown(radio, { key: 'Enter' });
    expect(actions.onSelect).toHaveBeenLastCalledWith('child');
    fireEvent.keyDown(radio, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(north);
    fireEvent.keyDown(north, { key: 'End' });
    expect(document.activeElement).toBe(none);
    fireEvent.keyDown(none, { key: ' ' });
    expect(actions.onSelect).toHaveBeenLastCalledWith('none');
    fireEvent.keyDown(none, { key: 'Home' });
    expect(document.activeElement).toBe(all);
    expect(all.tabIndex).toBe(0);
    expect(north.tabIndex).toBe(-1);
  });

  it('offers group creation, editing, removal and the phone filter', () => {
    const actions = show();
    fireEvent.click(screen.getByRole('button', { name: 'New group' }));
    expect(actions.onCreate).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText('Group'), { target: { value: 'child' } });
    expect(actions.onSelect).toHaveBeenLastCalledWith('child');
    const tree = within(screen.getByRole('tree'));
    fireEvent.click(tree.getByRole('button', { name: 'Actions for North Ridge' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit group' }));
    expect(actions.onEdit).toHaveBeenCalledWith(parent);
    fireEvent.click(tree.getByRole('button', { name: 'Actions for North Ridge' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove group' }));
    expect(actions.onRemove).toHaveBeenCalledWith(parent);
    expect(tree.getByText('Patrol A')).toBeTruthy();
    expect(tree.getByText('From 2026-11-05 · Until 2026-11-06')).toBeTruthy();
  });

  it.each([
    [0, 'devices'],
    [1, 'device'],
    [2, 'devices'],
  ] as const)(
    'includes the visible group name and count in the accessible name (%i %s)',
    (count, noun) => {
      show([{ ...parent, deviceCount: count, startsOn: null, endsOn: null, children: [] }]);
      const name = `North Ridge ${count} ${noun} Patrol A`;
      const group = screen.getByRole('treeitem', { name });
      expect(within(group).getByRole('button', { name })).toBeTruthy();
    },
  );

  it('separates the loading state from an empty tree', () => {
    const loading = show([], true);
    expect(screen.getByLabelText('Loading groups')).toBeTruthy();
    expect(screen.queryByRole('tree')).toBeNull();
    expect(loading.onSelect).not.toHaveBeenCalled();
    cleanup();
    show([]);
    expect(screen.getByText('No groups yet. Create one to sort your devices.')).toBeTruthy();
    expect(screen.getByRole('treeitem', { name: 'No group' })).toBeTruthy();
  });
});
