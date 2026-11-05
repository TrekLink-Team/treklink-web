// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceGroup } from '../../entities/rented-device/api';
import { ApiError } from '../../shared/api/apiClient';
import { AssignGroupDialog, GroupForm, RemoveGroupDialog } from './GroupDialogs';

const api = vi.fn();
vi.mock('../../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));
const group: DeviceGroup = {
  id: 'group-1',
  name: 'North Ridge',
  parentId: null,
  label: null,
  startsOn: null,
  endsOn: null,
  areaNote: null,
  version: 7,
  deviceCount: 2,
  children: [],
};
const show = (content: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      {content}
    </QueryClientProvider>,
  );
const form = (editing?: DeviceGroup, groups = [group], maxDepth = 2) => {
  const actions = { onClose: vi.fn(), onSaved: vi.fn(), onReload: vi.fn() };
  show(<GroupForm group={editing} groups={groups} maxDepth={maxDepth} {...actions} />);
  return actions;
};
beforeEach(() => {
  api.mockReset();
});
afterEach(cleanup);

describe('GroupForm', () => {
  it('creates a trimmed group with its chosen parent and optional details', async () => {
    api.mockResolvedValue({ id: 'new-group' });
    const actions = form();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Radio crew  ' } });
    fireEvent.change(screen.getByLabelText('Parent group'), { target: { value: group.id } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: '  Patrol  ' } });
    fireEvent.change(screen.getByLabelText('Area note'), { target: { value: '  North trail  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save group' }));
    await waitFor(() => expect(actions.onSaved).toHaveBeenCalledOnce());
    expect(api).toHaveBeenCalledWith('/groups', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Radio crew',
        parentId: group.id,
        label: 'Patrol',
        startsOn: null,
        endsOn: null,
        areaNote: 'North trail',
      }),
    });
  });

  it('edits with the displayed version and retains values after a stale refusal', async () => {
    api.mockRejectedValue(new ApiError(409, 'STALE_VERSION', 'The group changed.'));
    const actions = form(group);
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('North Ridge');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'South Ridge' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save group' }));
    await screen.findByText('Someone else changed this group. Reload to see the latest.');
    expect(api).toHaveBeenCalledWith('/groups/group-1', {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'South Ridge',
        parentId: null,
        label: null,
        startsOn: null,
        endsOn: null,
        areaNote: null,
        expectedVersion: 7,
      }),
    });
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('South Ridge');
    expect(actions.onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(actions.onReload).toHaveBeenCalledOnce();
  });

  it('refuses blank names and reversed dates before sending a request', () => {
    form();
    fireEvent.click(screen.getByRole('button', { name: 'Save group' }));
    expect(screen.getByText('Name is required.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Crew' } });
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-11-06' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-11-05' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save group' }));
    expect(screen.getByText('Choose an end after the start.')).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });

  it('excludes the group, its descendants and parents without subtree capacity', () => {
    const child = { ...group, id: 'child', name: 'Scout', parentId: group.id, children: [] };
    const editing = { ...group, parentId: 'root', children: [child] };
    const peer = { ...group, id: 'peer', name: 'Peer', parentId: 'other', children: [] };
    const other = { ...group, id: 'other', name: 'Other', children: [peer] };
    const root = { ...group, id: 'root', name: 'Root', children: [editing] };
    form(editing, [root, other], 2);
    const options = within(screen.getByLabelText('Parent group')).getAllByRole(
      'option',
    ) as HTMLOptionElement[];
    expect(options.map(({ value }) => value)).toEqual(['', 'root', 'other']);
    cleanup();
    form(editing, [root, other], 0);
    const retained = within(screen.getByLabelText('Parent group')).getAllByRole(
      'option',
    ) as HTMLOptionElement[];
    expect(retained.map(({ value }) => value)).toEqual(['', 'root']);
    expect((screen.getByLabelText('Parent group') as HTMLSelectElement).value).toBe('root');
  });

  it('shows a server duplicate name beside the field and keeps the entered name', async () => {
    api.mockRejectedValue(new ApiError(409, 'CONFLICT_UNIQUE', 'Duplicate group.'));
    form();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Existing crew' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save group' }));
    await screen.findByText('A group with this name already exists here.');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Existing crew');
  });
});

describe('RemoveGroupDialog', () => {
  it('counts the whole subtree, confirms removal and calls the saved callback', async () => {
    api.mockResolvedValue({ id: group.id });
    const onRemoved = vi.fn();
    const subtree = {
      ...group,
      children: [{ ...group, id: 'child', parentId: group.id, deviceCount: 3 }],
    };
    show(<RemoveGroupDialog group={subtree} onClose={vi.fn()} onRemoved={onRemoved} />);
    expect(screen.getByRole('alertdialog', { name: 'Remove North Ridge?' })).toBeTruthy();
    expect(
      screen.getByText('This also removes 1 subgroups and leaves 5 devices ungrouped.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove group' }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledOnce());
    expect(api).toHaveBeenCalledWith('/groups/group-1', { method: 'DELETE' });
  });

  it('keeps the confirmation available after failure and supports cancellation', async () => {
    api.mockRejectedValue(new ApiError(409, 'CONFLICT', 'The group is busy.'));
    const onClose = vi.fn();
    const onRemoved = vi.fn();
    show(<RemoveGroupDialog group={group} onClose={onClose} onRemoved={onRemoved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove group' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The group is busy.');
    expect(onRemoved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('AssignGroupDialog', () => {
  it('does not submit without a group and refreshes custody after DEVICE_NOT_HELD', async () => {
    api.mockRejectedValue(
      new ApiError(409, 'DEVICE_NOT_HELD', 'This device is not held by your organization now.'),
    );
    const onDeviceNotHeld = vi.fn();
    const onAssigned = vi.fn();
    show(
      <AssignGroupDialog
        groups={[group]}
        deviceIds={['device-1']}
        onClose={vi.fn()}
        onAssigned={onAssigned}
        onDeviceNotHeld={onDeviceNotHeld}
      />,
    );
    expect(
      (screen.getByRole('button', { name: 'Assign devices' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText('Group'), { target: { value: group.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign devices' }));
    await screen.findByRole('alert');
    expect(onDeviceNotHeld).toHaveBeenCalledOnce();
    expect(onAssigned).not.toHaveBeenCalled();
    expect(api).toHaveBeenCalledWith('/groups/group-1/devices', {
      method: 'POST',
      body: JSON.stringify({ deviceIds: ['device-1'] }),
    });
  });
});
