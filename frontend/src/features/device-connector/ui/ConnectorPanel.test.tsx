// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession, type SessionUser } from '../../../entities/session/model';
import {
  FakePort,
  FakeSerial,
  FakeUnit,
  unitState,
} from '../../../shared/lib/meshtastic-dock.fake';
import { resetConnectorRegistry } from '../model/ConnectorRegistry';
import { useConnectorStore } from '../model/connectorStore';
import { ConnectorButton } from './ConnectorButton';
import { ConnectorPanelBody } from './ConnectorPanel';

const recognizeUnits = vi.hoisted(() => vi.fn());
vi.mock('../../../entities/device/api', () => ({ recognizeUnits }));
vi.mock('../../../entities/contract/api', () => ({ issueChannelKey: vi.fn(), exchangeDevice: vi.fn() }));

// The panel of screen 4.6 over two fake units (devices design section 11.2): rows for a registered and an
// unknown unit, registration offered for the unknown one, the device view with the labelled render slot
// when the render is missing (REQ-ERR-29), and the count on the header button.

const STAFF: SessionUser = {
  id: 's',
  email: 'staff@example.test',
  fullName: 'Tran Thi B',
  accountType: 'TREKLINK',
  roles: ['STAFF'],
  organization: null,
};
const A = 0xa4b1c2d4;
const B = 0xa4b1c2e5;

let deviceChange: Record<string, unknown> = {};

const registered = (nodeNum: number) => ({
  nodeNum,
  nodeId: `!${nodeNum.toString(16)}`,
  device: {
    id: 'd-42',
    assetTag: 'TL-0042',
    nodeNum,
    nodeId: `!${nodeNum.toString(16)}`,
    hardwareVariant: { id: 'v', code: 'treklink-v3', name: 'TrekLink v3 (GPS, SOS button)' },
    firmwareVersion: '2.7.19-treklink.3',
    firmwareBaseline: '2.7.19-treklink.3',
    status: 'AVAILABLE',
    keyVersion: null,
    keyOrganization: null,
    batteryPct: 96,
    lastSeenAt: null,
    serviceDueAt: null,
    openMaintenance: null,
    ...deviceChange,
  },
  contract: null,
  docked: null,
});

beforeEach(() => {
  resetConnectorRegistry();
  const serial = new FakeSerial();
  for (const nodeNum of [A, B]) {
    const unit = new FakeUnit(unitState({ nodeNum }), {}, serial);
    serial.ports.push(new FakePort(unit, serial));
  }
  Object.defineProperty(window.navigator, 'serial', { value: serial, configurable: true });
  recognizeUnits.mockImplementation((nodeNums: number[]) =>
    Promise.resolve(
      nodeNums.map((nodeNum) =>
        nodeNum === A
          ? registered(nodeNum)
          : { nodeNum, nodeId: `!${nodeNum.toString(16)}`, device: null, contract: null, docked: null },
      ),
    ),
  );
  act(() =>
    useSession
      .getState()
      .signIn({ accessToken: 'a', accessTokenExpiresIn: 1, refreshToken: 'r', refreshTokenExpiresIn: 1 }, STAFF),
  );
});

afterEach(() => {
  deviceChange = {};
  cleanup();
  resetConnectorRegistry();
  Reflect.deleteProperty(window.navigator, 'serial');
  act(() => {
    useSession.getState().signOut();
    useConnectorStore.setState({
      open: false,
      viewing: null,
      focus: null,
      context: null,
      registerFrom: null,
      flashPanel: null,
    });
  });
});

const renderPanel = () =>
  render(
    <MemoryRouter>
      <ConnectorButton />
      <ConnectorPanelBody headingId="panel-title" />
    </MemoryRouter>,
  );

describe('ConnectorPanel (screen 4.6)', () => {
  it('lists a registered and an unknown unit with the actions each allows (AC-23)', async () => {
    renderPanel();
    const { connectorRegistry } = await import('../model/ConnectorRegistry');
    await act(async () => {
      await connectorRegistry(recognizeUnits, { handshakeMs: 600, writeMs: 500, restartDelayMs: 40, restartDeadlineMs: 300, retryMs: 20 }).start();
    });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'TL-0042' })).toBeTruthy(), { timeout: 4000 });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Unknown unit' })).toBeTruthy(), { timeout: 4000 });
    expect(screen.getByText('2 units connected')).toBeTruthy();
    const devices = screen.getByRole('button', { name: 'Devices, 2 connected' });
    // The count is drawn from data-count, so the visible text stays inside the name (WCAG 2.5.3).
    expect(devices.querySelector('[data-count]')?.getAttribute('data-count')).toBe('2');
    expect(devices.textContent).toBe('Devices');
    expect(screen.getByRole('button', { name: `New device: register it? Unknown unit !${B.toString(16)}` })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Configure uplink TL-0042' })).toBeTruthy();
    expect(screen.getByText('Available')).toBeTruthy();
  });

  it('opens the device view with the unit read and the labelled slot when the render is missing (AC-34)', async () => {
    renderPanel();
    const { connectorRegistry } = await import('../model/ConnectorRegistry');
    await act(async () => {
      await connectorRegistry(recognizeUnits, { handshakeMs: 600, writeMs: 500, restartDelayMs: 40, restartDeadlineMs: 300, retryMs: 20 }).start();
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show details TL-0042' })).toBeTruthy(), { timeout: 4000 });

    fireEvent.click(screen.getByRole('button', { name: 'Show details TL-0042' }));

    const heading = screen.getByRole('heading', { name: 'TL-0042' });
    expect(document.activeElement).toBe(heading);
    const render = screen.getByRole('img', { name: 'TrekLink v3 (GPS, SOS button), front view' });
    expect(render.getAttribute('src')).toBe('/variants/treklink-v3-detail.png');
    fireEvent.error(render);
    expect(screen.getByText('TrekLink v3 (GPS, SOS button): render not added yet')).toBeTruthy();
    const unitSection = screen.getByRole('region', { name: 'From the unit' });
    expect(within(unitSection).getByText(`!${A.toString(16)}`)).toBeTruthy();
    expect(screen.getByText('96 %')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }));
    expect(screen.getByText('2 units connected')).toBeTruthy();
  });
});

describe('ConnectorPanel uplink and flash (devices task 10.10, design section 11.7)', () => {
  const start = async () => {
    const { connectorRegistry } = await import('../model/ConnectorRegistry');
    await act(async () => {
      await connectorRegistry(recognizeUnits).start();
    });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'TL-0042' })).toBeTruthy(), { timeout: 4000 });
  };

  it('opens the uplink dialog for the unit the device page named, or asks to connect it', async () => {
    act(() => useConnectorStore.getState().openFor({ action: 'uplink', assetTag: 'TL-0099', nodeNum: 99 }));
    renderPanel();
    await start();
    expect(screen.getByText('Connect TL-0099 to continue.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => useConnectorStore.getState().openFor({ action: 'uplink', assetTag: 'TL-0042', nodeNum: A }));
    expect(await screen.findByRole('dialog', { name: 'Configure TL-0042 as an uplink' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useConnectorStore.getState().focus).toBeNull();
  });

  it('shows Update firmware disabled with its reason as text until a flash panel registers', async () => {
    deviceChange = {
      status: 'MAINTENANCE',
      openMaintenance: { id: 'mr-1', reason: 'FIRMWARE_UPDATE', status: 'OPEN' },
    };
    renderPanel();
    await start();
    const button = screen.getByRole('button', { name: 'Update firmware TL-0042' }) as HTMLButtonElement;
    // Unavailable with its reason: in the tooltip and the description, and as text on the row (§9.8).
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getAllByText('Firmware releases are not published yet').length).toBeGreaterThan(0);
    expect(button.getAttribute('aria-describedby')).toBeTruthy();

    const seen: { record?: string; locked?: boolean; runs: number } = { runs: 0 };
    const FakeFlash: React.FC<import('../model/connectorStore').FlashPanelProps> = ({ device, withPort }) => {
      React.useEffect(() => {
        seen.runs += 1;
        seen.record = device.maintenanceRecordId;
        void withPort(async () => {
          const { connectorRegistry } = await import('../model/ConnectorRegistry');
          seen.locked = connectorRegistry(recognizeUnits).getSnapshot().writing !== null;
        }).catch(() => undefined);
      }, [device, withPort]);
      return <p>Flash panel for {device.assetTag}</p>;
    };
    act(() => useConnectorStore.getState().registerFlashPanel(FakeFlash));
    const enabled = screen.getByRole('button', { name: 'Update firmware TL-0042' }) as HTMLButtonElement;
    expect(enabled.getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByText('Firmware releases are not published yet')).toBeNull();
    fireEvent.click(enabled);
    expect(await screen.findByText('Flash panel for TL-0042')).toBeTruthy();
    await waitFor(() => expect(seen).toMatchObject({ record: 'mr-1', locked: true }));
    // The props are stable: the panel's effect ran once although the registry changed meanwhile.
    expect(seen.runs).toBe(1);
  });
});

describe('ConnectorPanel row controls (screen 4.6)', () => {
  const start = async () => {
    const { connectorRegistry } = await import('../model/ConnectorRegistry');
    const registry = connectorRegistry(recognizeUnits);
    await act(async () => {
      await registry.start();
    });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'TL-0042' })).toBeTruthy(), { timeout: 4000 });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Unknown unit' })).toBeTruthy(), { timeout: 4000 });
    return registry;
  };

  it('asks before Forget and keeps the unit on Keep it', async () => {
    renderPanel();
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Forget TL-0042' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Forget TL-0042?' }));
    expect(dialog.getByText('The browser asks again before it can connect to this unit.')).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Keep it' }));
    expect(screen.getByRole('heading', { name: 'TL-0042' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Forget TL-0042' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'TL-0042' })).toBeNull());
  });

  it('returns focus to the row after Back from the device view', async () => {
    renderPanel();
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Show details TL-0042' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show details TL-0042' })));
  });

  it('says why other rows cannot write while one unit is written, and offers Reconnect on the waiting row', async () => {
    recognizeUnits.mockImplementation((nodeNums: number[]) =>
      Promise.resolve(
        nodeNums.map((nodeNum) => {
          const unit = registered(nodeNum);
          return nodeNum === A
            ? unit
            : { ...unit, device: { ...unit.device, id: 'd-43', assetTag: 'TL-0043' } };
        }),
      ),
    );
    renderPanel();
    const { connectorRegistry } = await import('../model/ConnectorRegistry');
    const registry = connectorRegistry(recognizeUnits);
    await act(async () => {
      await registry.start();
    });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'TL-0043' })).toBeTruthy(), { timeout: 4000 });
    const rows = registry.getSnapshot().connections;
    const target = rows.find((connection) => connection.recognized?.device?.assetTag === 'TL-0042')!;
    const reconnect = vi.fn(() => Promise.resolve());
    const stop = vi.fn();
    let release: () => void = () => undefined;
    let running: Promise<void> | undefined;
    act(() => {
      running = registry.withWriteLock(target.id, (_port, stage) => {
        stage('reconnect');
        registry.offerReconnect({ connectionId: target.id, reconnect, stop });
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      });
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reconnect TL-0042' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect TL-0042' }));
    expect(reconnect).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Stop waiting for TL-0042' }));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Configure uplink TL-0043' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getAllByText('Another unit is being written.').length).toBeGreaterThan(0);
    await act(async () => {
      registry.offerReconnect(null);
      release();
      await running;
    });
  });
});

describe('ConnectorPanel on CollectionView (chapter 06 §9, design section 11.2)', () => {
  it('hides the command bar with two units, shows it with a third, and shows a tooltip on focus', async () => {
    renderPanel();
    const { connectorRegistry } = await import('../model/ConnectorRegistry');
    const registry = connectorRegistry(recognizeUnits);
    await act(async () => {
      await registry.start();
    });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Unknown unit' })).toBeTruthy(), { timeout: 4000 });
    expect(screen.queryByLabelText('Search connected units')).toBeNull();

    const action = screen.getByRole('button', { name: 'Configure uplink TL-0042' });
    act(() => action.focus());
    expect(screen.getByRole('tooltip').textContent).toContain('Configure uplink');

    const serial = navigator.serial as unknown as FakeSerial;
    const third = new FakeUnit(unitState({ nodeNum: 0xa4b1c2f6 }), {}, serial);
    const port = new FakePort(third, serial);
    serial.ports.push(port);
    act(() => serial.emit('connect', port));
    await waitFor(() => expect(screen.getByLabelText('Search connected units')).toBeTruthy(), { timeout: 4000 });
  });
});

describe('ConnectorPanel 4.6 gaps (swap refusal, skeleton, phone render)', () => {
  it('shows the server refusal inside the swap dialog and keeps it open', async () => {
    const swapIn = vi.fn(() => Promise.resolve('This was changed by someone else. Reload and try again.'));
    act(() =>
      useConnectorStore.getState().setContext({
        kind: 'counter',
        contractId: 'c-42',
        contractCode: 'RC-2026-0042',
        status: 'APPROVED',
        variantCode: 'treklink-v3',
        version: 4,
        keyVersion: 1,
        rows: [{ deviceId: 'd-1', assetTag: 'TL-0001', nodeNum: 11, provisionedKeyVersion: null }],
        provision: () => Promise.resolve(),
        swapIn,
      }),
    );
    renderPanel();
    const { connectorRegistry } = await import('../model/ConnectorRegistry');
    await act(async () => {
      await connectorRegistry(recognizeUnits).start();
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Put on this contract TL-0042' }, { timeout: 4000 }));
    const dialog = within(screen.getByRole('dialog', { name: 'Put TL-0042 on RC-2026-0042?' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Swap and provision' }));
    await waitFor(() =>
      expect(dialog.getByText('This was changed by someone else. Reload and try again.')).toBeTruthy(),
    );
    expect(swapIn).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ deviceId: 'd-1' }));
    expect(screen.getByRole('dialog', { name: 'Put TL-0042 on RC-2026-0042?' })).toBeTruthy();
  });

  it('shows a skeleton row while a unit is read, and a 160 px render below 600 px', async () => {
    const serial = navigator.serial as unknown as FakeSerial;
    const slow = new FakeUnit(unitState({ nodeNum: 0xa4b1c2f7 }), { silent: true }, serial);
    serial.ports.push(new FakePort(slow, serial));
    renderPanel();
    const { connectorRegistry } = await import('../model/ConnectorRegistry');
    // start() returns once the ports are attached; the silent unit stays in its handshake meanwhile.
    await act(async () => {
      await connectorRegistry(recognizeUnits).start();
    });
    expect(await screen.findByRole('heading', { name: 'Unit being read' }, { timeout: 4000 })).toBeTruthy();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Show details TL-0042' })).toBeTruthy(), {
      timeout: 4000,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show details TL-0042' }));
    const render = screen.getByRole('img', { name: 'TrekLink v3 (GPS, SOS button), front view' });
    expect(render.className).toContain('h-40');
    expect(render.className).toContain('min-[600px]:h-60');
  });
});
