// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceGroup, RentedDevice } from '../entities/rented-device/api';
import { RentedDevicesPage } from './RentedDevicesPage';

const api = vi.fn();
vi.mock('../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/api/apiClient')>()),
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
  version: 1,
  deviceCount: 1,
  children: [],
};
const device: RentedDevice = {
  deviceId: 'device-1',
  assetTag: 'TL-0001',
  variantCode: 'V3',
  contract: { id: 'contract-1', code: 'CT-0001', planType: 'MONTHLY', status: 'ACTIVE' },
  contractDeviceId: 'slot-1',
  handedOverAt: '2026-11-01T00:00:00Z',
  state: 'LIVE',
  batteryPct: 81,
  lastSeenAt: null,
  group: null,
  holder: { name: 'Hiker One' },
  openFaultReportId: null,
  openLossCase: null,
};
const page = <T,>(items: T[]) => ({
  items,
  pageNumber: 1,
  pageSize: 20,
  totalCount: items.length,
  totalPages: 1,
});

const show = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <RentedDevicesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  api.mockReset();
  api.mockImplementation(async (path: string) => {
    if (path === '/groups') return { groups: [group], maxDepth: 3 };
    if (path.startsWith('/rented-devices?')) return page([device]);
    if (path.startsWith('/contracts?')) return page([device.contract]);
    if (path === '/groups/group-1/devices') return { assigned: ['device-1'], unchanged: [] };
    if (path === '/contracts/contract-1/devices/device-1/fault-reports') return { id: 'fault-1' };
    throw new Error(`Unexpected request: ${path}`);
  });
});
afterEach(cleanup);

describe('RentedDevicesPage', () => {
  it('removes a child group, restores its parent filter and refocuses the surviving tree node', async () => {
    const child: DeviceGroup = { ...group, id: 'child-1', name: 'Radio crew', parentId: group.id };
    let groups = [{ ...group, children: [child] }];
    api.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/groups') return { groups, maxDepth: 3 };
      if (path === '/groups/child-1' && options?.method === 'DELETE') {
        groups = [{ ...group, children: [] }];
        return { id: child.id, removedGroups: 1, ungroupedDevices: 1 };
      }
      if (path.startsWith('/rented-devices?')) return page([device]);
      if (path.startsWith('/contracts?')) return page([device.contract]);
      throw new Error(`Unexpected request: ${path}`);
    });
    show();
    const tree = within(await screen.findByRole('tree', { name: 'Filter by device group' }));
    const parent = await tree.findByRole('treeitem', { name: 'North Ridge 1 device' });
    vi.spyOn(parent, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
    fireEvent.change(screen.getByLabelText('Group'), { target: { value: child.id } });
    fireEvent.click(tree.getByRole('button', { name: 'Actions for Radio crew' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove group' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Remove Radio crew?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove group' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(parent));
    expect((screen.getByLabelText('Group') as HTMLSelectElement).value).toBe(group.id);
    expect(api).toHaveBeenCalledWith('/groups/child-1', { method: 'DELETE' });
  });

  it('returns focus to New group after deleting a top-level group', async () => {
    let groups = [group];
    api.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/groups') return { groups, maxDepth: 3 };
      if (path === '/groups/group-1' && options?.method === 'DELETE') {
        groups = [];
        return { id: group.id, removedGroups: 1, ungroupedDevices: 1 };
      }
      if (path.startsWith('/rented-devices?')) return page([device]);
      if (path.startsWith('/contracts?')) return page([device.contract]);
      throw new Error(`Unexpected request: ${path}`);
    });
    show();
    const tree = within(await screen.findByRole('tree', { name: 'Filter by device group' }));
    fireEvent.click(await tree.findByRole('button', { name: 'Actions for North Ridge' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove group' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Remove North Ridge?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove group' }));
    await screen.findByText('No groups yet. Create one to sort your devices.');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New group' })),
    );
  });

  it('sends the selected group and state as server filters', async () => {
    show();
    const groups = within(screen.getByRole('complementary', { name: 'Device groups' }));
    const select = await groups.findByLabelText('Group');
    fireEvent.change(select, { target: { value: group.id } });
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'OFFLINE' } });
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        expect.stringMatching(/\/rented-devices\?.*groupId=group-1.*state=OFFLINE/),
      );
    });
  });

  it('submits the selected device IDs to the group assignment endpoint', async () => {
    show();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select TL-0001' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign to group' }));
    const dialog = screen.getByRole('dialog', { name: 'Assign to group' });
    fireEvent.change(within(dialog).getByLabelText('Group'), { target: { value: group.id } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign devices' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/groups/group-1/devices', {
        method: 'POST',
        body: JSON.stringify({ deviceIds: ['device-1'] }),
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('reports a fault against the contract and the selected device', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for TL-0001' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Report fault' }));
    const dialog = screen.getByRole('dialog', { name: 'Report a fault on TL-0001' });
    fireEvent.change(within(dialog).getByLabelText('What is wrong'), {
      target: { value: '  Screen does not turn on.  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Report fault' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/contracts/contract-1/devices/device-1/fault-reports', {
        method: 'POST',
        body: JSON.stringify({ description: 'Screen does not turn on.' }),
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
