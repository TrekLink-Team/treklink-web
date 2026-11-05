// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../shared/api/apiClient';
import type { FlashLoader } from '../../shared/lib/esp-flasher';
import { FlashFirmwarePanel, type FlashFirmwareProps } from './FlashFirmwarePanel';

// devices task 8.3, design sections 9.2 and 9.3, screen 4.3: the panel over a fake ESPLoader and a
// mocked API (api-design 28 and 29).
const api = vi.fn();
vi.mock('../../shared/api/apiClient', async (original) => ({
  ...(await original<typeof import('../../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args) as unknown,
}));

const loader = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../shared/lib/esp-flasher', async (original) => {
  const actual = await original<typeof import('../../shared/lib/esp-flasher')>();
  return {
    ...actual,
    flashUnit: (request: Parameters<typeof actual.flashUnit>[0]) =>
      actual.flashUnit(request, () =>
        Promise.resolve({ loader: loader.current as FlashLoader, close: () => Promise.resolve() }),
      ),
  };
});

const NODE = 0x12345678;
const RELEASE = {
  version: '2.7.26-treklink.2',
  publishedAt: '2026-10-20T03:15:00Z',
  isBaseline: true,
  variants: [
    { variantCode: 'treklink-v3', chip: 'ESP32', app: { offset: 65536, sizeBytes: 4 }, factory: { offset: 0, sizeBytes: 4 } },
  ],
};
const OLDER = { ...RELEASE, version: '2.7.26-treklink.1', isBaseline: false, publishedAt: '2026-10-01T03:15:00Z' };

const fakeLoader = (chip = 'ESP32', mac = 'a4:cf:12:34:56:78') => ({
  main: vi.fn(() => Promise.resolve(chip)),
  chip: { CHIP_NAME: chip, readMac: vi.fn(() => Promise.resolve(mac)) },
  eraseFlash: vi.fn(() => Promise.resolve(0)),
  writeFlash: vi.fn(() => Promise.resolve()),
  after: vi.fn(() => Promise.resolve()),
});

const Where: React.FC = () => {
  const location = useLocation();
  return <p>At {location.pathname} with {JSON.stringify(location.state)}</p>;
};

const withPort = vi.fn((work: Parameters<FlashFirmwareProps['withPort']>[0]) => work({} as SerialPort, vi.fn()));
const close = vi.fn();
const open = (variantCode = 'treklink-v3') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/t/device-hub']}>
        <Routes>
          <Route
            path="/t/device-hub"
            element={
              <FlashFirmwarePanel
                device={{ id: 'd-42', assetTag: 'TL-0042', nodeNum: NODE, variantCode, maintenanceRecordId: 'mr-1' }}
                withPort={withPort as FlashFirmwareProps['withPort']}
                onClose={close}
              />
            }
          />
          <Route path="/t/maintenance" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

let releases: unknown[];
beforeEach(() => {
  releases = [OLDER, RELEASE];
  loader.current = fakeLoader();
  api.mockReset();
  withPort.mockClear();
  close.mockReset();
  api.mockImplementation((endpoint: string) => {
    if (endpoint.startsWith('/firmware-releases?') || endpoint === '/firmware-releases') return Promise.resolve(releases);
    const kind = new URL(`http://x${endpoint}`).searchParams.get('kind');
    return Promise.resolve({
      ...RELEASE,
      variantCode: 'treklink-v3',
      kind,
      chip: 'ESP32',
      offset: kind === 'FACTORY' ? 0 : 65536,
      sizeBytes: 4,
      sha256: 'a'.repeat(64),
      md5: 'b'.repeat(32),
      imageBase64: btoa(String.fromCharCode(0xe9, 1, 2, 3)),
    });
  });
});
afterEach(cleanup);

const flashButton = () => screen.getByRole('button', { name: /^(Flash|Erase and flash)$/ });

describe('FlashFirmwarePanel (devices task 8.3, screen 4.3)', () => {
  it('says no firmware release is published yet, as text, and keeps Flash disabled in its slot', async () => {
    releases = [];
    open();
    expect(await screen.findByText('No firmware release is published yet.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    const button = flashButton();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'No firmware release is published yet.',
    );
    fireEvent.click(button);
    expect(withPort).not.toHaveBeenCalled();
  });

  it('offers the releases of the variant with the baseline preselected (REQ-EVT-28)', async () => {
    open();
    const select = (await screen.findByLabelText('Release')) as HTMLSelectElement;
    expect(api).toHaveBeenCalledWith('/firmware-releases?variantCode=treklink-v3');
    expect(select.value).toBe('2.7.26-treklink.2');
    expect(select.options[1].textContent).toBe('2.7.26-treklink.2 (baseline)');
  });

  it('Update writes the app image at its offset and hands the version to Complete (AC-19)', async () => {
    open();
    await screen.findByLabelText('Release');
    fireEvent.click(flashButton());
    expect(await screen.findByText('2.7.26-treklink.2 written and verified on TL-0042. Complete the record to save it.')).toBeTruthy();
    expect(api).toHaveBeenCalledWith('/firmware-releases/2.7.26-treklink.2/images/treklink-v3?kind=APP');
    expect(withPort).toHaveBeenCalledTimes(1);
    const fake = loader.current as ReturnType<typeof fakeLoader>;
    expect(fake.eraseFlash).not.toHaveBeenCalled();
    expect(fake.writeFlash).toHaveBeenCalledWith(
      expect.objectContaining({ fileArray: [{ data: Uint8Array.from([0xe9, 1, 2, 3]), address: 65536 }], flashMode: 'keep' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Complete the record' }));
    expect(close).toHaveBeenCalled();
    expect(
      screen.getByText('At /t/maintenance with {"recordId":"mr-1","flashedVersion":"2.7.26-treklink.2"}'),
    ).toBeTruthy();
  });

  it('Full install erases and writes the factory image at 0', async () => {
    open();
    await screen.findByLabelText('Release');
    fireEvent.click(screen.getByRole('radio', { name: /Full install/ }));
    fireEvent.click(flashButton());
    // Screen 4.3: Full install asks first, and nothing runs until it is confirmed.
    const confirm = screen.getByRole('alertdialog', { name: 'Erase TL-0042 and install 2.7.26-treklink.2?' });
    expect(withPort).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Erase and flash' }));
    await screen.findByText(/written and verified/);
    expect(api).toHaveBeenCalledWith('/firmware-releases/2.7.26-treklink.2/images/treklink-v3?kind=FACTORY');
    const fake = loader.current as ReturnType<typeof fakeLoader>;
    expect(fake.eraseFlash).toHaveBeenCalled();
    expect(fake.writeFlash).toHaveBeenCalledWith(expect.objectContaining({ fileArray: [expect.objectContaining({ address: 0 })] }));
  });

  it('names a chip mismatch, writes nothing and keeps the record open (REQ-ERR-16, AC-20)', async () => {
    loader.current = fakeLoader('ESP32-S3');
    open();
    await screen.findByLabelText('Release');
    fireEvent.click(flashButton());
    expect(
      await screen.findByText(
        'The unit on the port is an ESP32-S3, not the ESP32 of treklink-v3. Nothing was written.',
      ),
    ).toBeTruthy();
    expect((loader.current as ReturnType<typeof fakeLoader>).writeFlash).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Complete the record' })).toBeNull();
  });

  it('names a verify failure and records nothing (REQ-ERR-17)', async () => {
    const fake = fakeLoader();
    fake.writeFlash.mockRejectedValue(new Error('MD5 of file does not match data in flash!'));
    loader.current = fake;
    open();
    await screen.findByLabelText('Release');
    fireEvent.click(flashButton());
    expect(
      await screen.findByText('The written image did not verify. Nothing was recorded. Flash TL-0042 again.'),
    ).toBeTruthy();
  });

  it('shows the server refusal of an image and never takes the port (AC-20)', async () => {
    api.mockImplementation((endpoint: string) =>
      endpoint.includes('/images/')
        ? Promise.reject(
            new ApiError(502, 'FIRMWARE_IMAGE_INVALID', 'The firmware image failed its check and was not sent. Try again later.'),
          )
        : Promise.resolve(releases),
    );
    open();
    await screen.findByLabelText('Release');
    fireEvent.click(flashButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('failed its check'));
    expect(withPort).not.toHaveBeenCalled();
  });

  it('asks Staff to hold the power button of a v2 unit', async () => {
    open('treklink-v2');
    expect(
      await screen.findByText(/Hold the power button of TL-0042 until the flash finishes/),
    ).toBeTruthy();
  });
});
