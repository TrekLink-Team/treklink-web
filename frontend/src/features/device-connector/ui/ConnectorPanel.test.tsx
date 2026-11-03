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
  cleanup();
  resetConnectorRegistry();
  Reflect.deleteProperty(window.navigator, 'serial');
  act(() => {
    useSession.getState().signOut();
    useConnectorStore.setState({ open: false, viewing: null, focus: null, context: null, registerFrom: null });
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
    expect(screen.getByRole('button', { name: 'Devices, 2 connected' })).toBeTruthy();
    expect(screen.getByRole('button', { name: `New device !${B.toString(16)}: register it?` })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Configure uplink: TL-0042' })).toBeTruthy();
    expect(screen.getByText('Available')).toBeTruthy();
  });

  it('opens the device view with the unit read and the labelled slot when the render is missing (AC-34)', async () => {
    renderPanel();
    const { connectorRegistry } = await import('../model/ConnectorRegistry');
    await act(async () => {
      await connectorRegistry(recognizeUnits, { handshakeMs: 600, writeMs: 500, restartDelayMs: 40, restartDeadlineMs: 300, retryMs: 20 }).start();
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show TL-0042' })).toBeTruthy(), { timeout: 4000 });

    fireEvent.click(screen.getByRole('button', { name: 'Show TL-0042' }));

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
