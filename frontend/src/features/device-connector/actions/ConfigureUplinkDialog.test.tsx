// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigureUplinkDialog } from './ConfigureUplinkDialog';

// The dialog of screen 4.2 with the docking hook driven by the test (the hook is tested against the
// fake unit in useDocking.test.tsx).
const docking = vi.hoisted(() => ({
  supported: true,
  busy: false,
  state: { target: null as string | null, stage: null as string | null },
  configureUplink: vi.fn(),
  reconnect: vi.fn(),
  giveUp: vi.fn(),
  readUnit: vi.fn(),
  dockAndProvision: vi.fn(),
}));
vi.mock('./useDocking', () => ({ useDocking: () => docking }));

const DEVICE: { id: string; assetTag: string; nodeNum: number; keyVersion: number | null } = {
  id: 'd-1',
  assetTag: 'TL-0042',
  nodeNum: 2763113171,
  keyVersion: 2,
};

const open = (device = DEVICE) => {
  const onDone = vi.fn();
  render(<ConfigureUplinkDialog device={device} onDone={onDone} onClose={vi.fn()} />);
  return onDone;
};
const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const fill = () => {
  type(/Wi-Fi network name/, 'Base camp');
  type(/Wi-Fi password/, 'wifi-secret');
  type(/Broker address/, '192.168.1.20:1883');
  type(/Broker password/, 'broker-secret');
};

afterEach(() => {
  cleanup();
  docking.busy = false;
  docking.state = { target: null, stage: null };
  docking.configureUplink.mockReset();
  docking.reconnect.mockReset();
});

describe('ConfigureUplinkDialog (devices design 8.8, screen 4.2)', () => {
  it('sends the typed settings with TLS off by default and reports the broker', async () => {
    docking.configureUplink.mockResolvedValue({ ok: true });
    const onDone = open();
    expect(screen.getByText('The unit restarts once to apply the settings.')).toBeTruthy();
    expect(
      screen.getByText('Fixed by D-005: root treklink, JSON on, MQTT encryption off, uplink on channel 0.'),
    ).toBeTruthy();
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Configure uplink' }));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith('TL-0042 is configured as an uplink to 192.168.1.20:1883.'),
    );
    expect(docking.configureUplink).toHaveBeenCalledWith(
      { deviceId: 'd-1', assetTag: 'TL-0042', nodeNum: 2763113171 },
      {
        wifiSsid: 'Base camp',
        wifiPassword: 'wifi-secret',
        brokerAddress: '192.168.1.20:1883',
        brokerUsername: '',
        brokerPassword: 'broker-secret',
        tls: false,
      },
    );
  });

  it('checks the firmware field sizes before docking', () => {
    open();
    type(/Wi-Fi network name/, 'x'.repeat(33));
    type(/Broker address/, 'not a host');
    fireEvent.click(screen.getByRole('button', { name: 'Configure uplink' }));
    expect(screen.getByText('Use at most 32 characters.')).toBeTruthy();
    expect(screen.getByText('Enter a host or host:port, at most 63 characters.')).toBeTruthy();
    expect(docking.configureUplink).not.toHaveBeenCalled();
  });

  it('names the failed check, keeps the network and broker and clears both passwords (REQ-ERR-15)', async () => {
    docking.configureUplink.mockResolvedValue({
      ok: false,
      failure: 'read-back',
      reason: 'The read-back differs: broker address.',
    });
    open();
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Configure uplink' }));
    expect(
      await screen.findByText(
        'TL-0042 is not configured as an uplink: the read-back differs: broker address.',
      ),
    ).toBeTruthy();
    expect((screen.getByLabelText(/Wi-Fi network name/) as HTMLInputElement).value).toBe('Base camp');
    expect((screen.getByLabelText(/Broker address/) as HTMLInputElement).value).toBe(
      '192.168.1.20:1883',
    );
    expect((screen.getByLabelText(/Wi-Fi password/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/Broker password/) as HTMLInputElement).value).toBe('');
  });

  it('waits for the restart and offers Reconnect when the browser dropped the port', () => {
    docking.busy = true;
    docking.state = { target: 'd-1', stage: 'reconnect' };
    open();
    expect(screen.getByText('Waiting for TL-0042 to restart.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(docking.reconnect).toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('warns that a unit without an organization key relays nothing', () => {
    open({ ...DEVICE, keyVersion: null });
    expect(screen.getByRole('alert').textContent).toContain("carries no organization's channel key");
  });
});
