// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimulatedNode, SimulationOverview } from '../../entities/demo/simulation';
import { ApiError } from '../../shared/api/apiClient';
import { FieldSimulationSection } from './FieldSimulationSection';

const startSimulatedNode = vi.fn();
const updateSimulatedNode = vi.fn();
const stopSimulatedNode = vi.fn();
const raiseSimulatedEvent = vi.fn();

vi.mock('../../entities/demo/simulation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../entities/demo/simulation')>()),
  startSimulatedNode: (...args: unknown[]) => startSimulatedNode(...args),
  updateSimulatedNode: (...args: unknown[]) => updateSimulatedNode(...args),
  stopSimulatedNode: (...args: unknown[]) => stopSimulatedNode(...args),
  raiseSimulatedEvent: (...args: unknown[]) => raiseSimulatedEvent(...args),
}));

const ORG = { id: 'org-1', code: 'ORG-0001', name: 'TrekLink Demo Tours Co., Ltd.' };
const NODE: SimulatedNode = {
  id: 'node-1',
  deviceId: 'dev-10',
  assetTag: 'TL-0010',
  nodeId: '!de00000a',
  organization: ORG,
  trailId: 'ta-nang-phan-dung',
  pattern: 'WALK',
  speedMetresPerMinute: 60,
  status: 'RUNNING',
  sosKind: null,
  sosSince: null,
  position: { lat: 11.497591, lon: 108.568646 },
  batteryPct: 99,
  lastPacketAt: new Date().toISOString(),
  simulated: true,
  version: 3,
  createdAt: '2026-11-06T02:00:00.000Z',
  updatedAt: '2026-11-06T02:00:00.000Z',
};

const overview = (patch: Partial<SimulationOverview> = {}): SimulationOverview => ({
  databaseAllowed: true,
  trails: [
    {
      id: 'ta-nang-phan-dung',
      name: 'Ta Nang to Phan Dung',
      region: 'Lam Dong',
      lengthMetres: 7210,
      pointCount: 63,
      source: {
        osmWayIds: [1164619760],
        readOn: '2026-11-01',
        simplification: 'Douglas-Peucker, 10 m, 189 to 63 points',
      },
    },
  ],
  patterns: ['WALK', 'STOP', 'STRAY', 'SILENT', 'LOW_BATTERY'],
  devices: [
    {
      id: 'dev-09',
      assetTag: 'TL-0009',
      nodeId: '!de000009',
      status: 'RENTED',
      organization: ORG,
      runningNodeId: null,
    },
    {
      id: 'dev-10',
      assetTag: 'TL-0010',
      nodeId: '!de00000a',
      status: 'RENTED',
      organization: ORG,
      runningNodeId: 'node-1',
    },
  ],
  nodes: [NODE],
  ...patch,
});

const show = (simulation: SimulationOverview) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FieldSimulationSection simulation={simulation} />
    </QueryClientProvider>,
  );

const rowOf = (assetTag: string) => screen.getByText(assetTag).closest('tr') as HTMLElement;

describe('FieldSimulationSection (screen 7.5, "Field simulation")', () => {
  beforeEach(() => {
    for (const mock of [
      startSimulatedNode,
      updateSimulatedNode,
      stopSimulatedNode,
      raiseSimulatedEvent,
    ])
      mock.mockReset();
  });
  afterEach(() => cleanup());

  it('lists each node with the Simulated badge, its trail, position, battery and SOS state', () => {
    show(overview());
    const row = rowOf('TL-0010');
    expect(within(row).getByText('Simulated')).toBeTruthy();
    expect(within(row).getByText('Ta Nang to Phan Dung')).toBeTruthy();
    expect(within(row).getByText('11.497591, 108.568646')).toBeTruthy();
    expect(within(row).getByText('99%')).toBeTruthy();
    expect(within(row).getByText('None')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Cancel SOS on TL-0010' })).toBeNull();
    expect(screen.getByText('Trails © OpenStreetMap contributors, ODbL.')).toBeTruthy();
  });

  // Review of treklink-web#307: the device cell heads its row, and every row action names its node.
  it('heads each row with the device cell and names every row action with the asset tag', () => {
    show(overview({ nodes: [{ ...NODE, sosKind: 'SOS', sosSince: '2026-11-06T03:42:00.000Z' }] }));
    const header = screen.getByRole('rowheader', { name: /TL-0010/ });
    expect(header.tagName).toBe('TH');
    expect(header.getAttribute('scope')).toBe('row');
    const row = rowOf('TL-0010');
    for (const name of [
      'Apply pattern to TL-0010',
      'SOS on TL-0010',
      'Fall on TL-0010',
      'Cancel SOS on TL-0010',
      'Stop TL-0010',
    ])
      expect(within(row).getByRole('button', { name })).toBeTruthy();
    expect(within(row).getByRole('combobox', { name: 'Pattern for TL-0010' })).toBeTruthy();
  });

  it('shows the empty state with no node', () => {
    show(overview({ nodes: [] }));
    expect(screen.getByText('No simulated nodes. Add one below.')).toBeTruthy();
  });

  it('adds a node from the form with the chosen device, trail, pattern and speed', async () => {
    startSimulatedNode.mockResolvedValue({ ...NODE, id: 'node-2', assetTag: 'TL-0009' });
    show(overview());
    fireEvent.change(screen.getByLabelText('Pattern'), { target: { value: 'LOW_BATTERY' } });
    fireEvent.change(screen.getByLabelText('Speed (m/min)'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add node' }));
    await waitFor(() =>
      expect(startSimulatedNode).toHaveBeenCalledWith({
        deviceId: 'dev-09',
        trailId: 'ta-nang-phan-dung',
        pattern: 'LOW_BATTERY',
        speedMetresPerMinute: 80,
      }),
    );
    const running = screen.getByRole('option', { name: /TL-0010, RENTED, ORG-0001 \(running\)/ });
    expect((running as HTMLOptionElement).disabled).toBe(true);
  });

  it('applies a new pattern with the node version', async () => {
    updateSimulatedNode.mockResolvedValue({ ...NODE, pattern: 'STRAY', version: 4 });
    show(overview());
    const row = rowOf('TL-0010');
    const apply = within(row).getByRole('button', { name: 'Apply pattern to TL-0010' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.change(within(row).getByLabelText('Pattern for TL-0010'), {
      target: { value: 'STRAY' },
    });
    fireEvent.click(apply);
    await waitFor(() =>
      expect(updateSimulatedNode).toHaveBeenCalledWith(NODE, { pattern: 'STRAY' }),
    );
  });

  it('asks in a dialog before an SOS, and Cancel sends nothing', async () => {
    raiseSimulatedEvent.mockResolvedValue({ node: NODE, fieldEventId: 'e' });
    show(overview());
    fireEvent.click(within(rowOf('TL-0010')).getByRole('button', { name: 'SOS on TL-0010' }));
    const dialog = screen.getByRole('dialog', { name: 'Send an SOS from TL-0010?' });
    expect(within(dialog).getByText(/opens a real incident, marked Simulated/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(raiseSimulatedEvent).not.toHaveBeenCalled();

    fireEvent.click(within(rowOf('TL-0010')).getByRole('button', { name: 'Fall on TL-0010' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send fall SOS' }));
    await waitFor(() => expect(raiseSimulatedEvent).toHaveBeenCalledWith(NODE, 'FALL'));
  });

  it('offers Cancel SOS while an SOS is active and sends SOS_CANCEL without a dialog', async () => {
    raiseSimulatedEvent.mockResolvedValue({ node: NODE, fieldEventId: null });
    show(overview({ nodes: [{ ...NODE, sosKind: 'SOS', sosSince: '2026-11-06T03:42:00.000Z' }] }));
    const row = rowOf('TL-0010');
    expect(within(row).getByText(/^SOS since \d\d:\d\d$/)).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel SOS on TL-0010' }));
    await waitFor(() =>
      expect(raiseSimulatedEvent).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'node-1' }),
        'SOS_CANCEL',
      ),
    );
  });

  it('stops a node after its dialog', async () => {
    stopSimulatedNode.mockResolvedValue({ ...NODE, status: 'STOPPED' });
    show(overview());
    fireEvent.click(within(rowOf('TL-0010')).getByRole('button', { name: 'Stop TL-0010' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop node' }));
    await waitFor(() => expect(stopSimulatedNode).toHaveBeenCalledWith(NODE));
  });

  it('runs the quick SOS on the running rented node after its dialog', async () => {
    raiseSimulatedEvent.mockResolvedValue({ node: NODE, fieldEventId: 'e' });
    show(overview());
    fireEvent.click(screen.getByRole('button', { name: 'SOS on a rented node' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send SOS' }));
    await waitFor(() => expect(raiseSimulatedEvent).toHaveBeenCalledWith(NODE, 'SOS'));
    expect(startSimulatedNode).not.toHaveBeenCalled();
  });

  it('starts a WALK node on the first rented device when none runs, then makes it silent', async () => {
    const started = { ...NODE, id: 'node-2', deviceId: 'dev-09', assetTag: 'TL-0009', version: 0 };
    startSimulatedNode.mockResolvedValue(started);
    updateSimulatedNode.mockResolvedValue({ ...started, pattern: 'SILENT', version: 1 });
    show(
      overview({
        nodes: [],
        devices: overview().devices.map((d) => ({ ...d, runningNodeId: null })),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'A node goes silent' }));
    await waitFor(() =>
      expect(updateSimulatedNode).toHaveBeenCalledWith(started, { pattern: 'SILENT' }),
    );
    expect(startSimulatedNode).toHaveBeenCalledWith({
      deviceId: 'dev-09',
      trailId: 'ta-nang-phan-dung',
      pattern: 'WALK',
    });
  });

  it('shows the server message of a refused write', async () => {
    raiseSimulatedEvent.mockRejectedValue(
      new ApiError(409, 'INVALID_STATE_TRANSITION', 'This cannot be done while it is STOPPED.'),
    );
    show(overview({ nodes: [{ ...NODE, sosKind: 'SOS', sosSince: '2026-11-06T03:42:00.000Z' }] }));
    fireEvent.click(within(rowOf('TL-0010')).getByRole('button', { name: 'Cancel SOS on TL-0010' }));
    expect(await screen.findByText('This cannot be done while it is STOPPED.')).toBeTruthy();
  });

  it('disables every write with the notice when the database is not allowed', () => {
    show(overview({ databaseAllowed: false }));
    expect(
      screen.getByText('The field simulation runs only on a local database or the Vercel staging.'),
    ).toBeTruthy();
    for (const name of [
      'SOS on a rented node',
      'A node goes silent',
      'A node strays',
      'Add node',
      'SOS on TL-0010',
      'Stop TL-0010',
    ])
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lists a stopped node without actions', () => {
    show(overview({ nodes: [{ ...NODE, status: 'STOPPED' }] }));
    const row = rowOf('TL-0010');
    expect(within(row).getByText('Stopped')).toBeTruthy();
    expect(within(row).queryByRole('button')).toBeNull();
  });
});
