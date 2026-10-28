// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContractDetail } from '../../entities/contract/api';
import { ReplacementPanel } from './ReplacementPanel';

const findAvailableUnit = vi.fn();
const replaceDevice = vi.fn();

vi.mock('../../entities/contract/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../entities/contract/api')>()),
  findAvailableUnit: (...args: unknown[]) => findAvailableUnit(...args),
  replaceDevice: (...args: unknown[]) => replaceDevice(...args),
}));

vi.mock('../../entities/organization/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../entities/organization/api')>()),
  useOrganization: () => ({ data: { channelKeyVersion: 2 } }),
}));

// jsdom has no canvas; the stand-in signs with one click.
vi.mock('../SignaturePad/SignaturePad', () => ({
  SignaturePad: ({ onChange }: { onChange: (png: string | null) => void }) => (
    <button type="button" onClick={() => onChange('data:image/png;base64,iVBORw0KGgo=')}>
      Sign
    </button>
  ),
}));

const device = (tag: string) => ({
  deviceId: `d-${tag}`,
  assetTag: tag,
  handedOverAt: '2026-10-25T03:00:00Z',
  checkedInAt: null,
  lostAt: null,
  holder: null,
});

const contract = {
  id: 'c-1',
  code: 'RC-2026-0001',
  status: 'ACTIVE',
  planType: 'MONTHLY',
  organization: { id: 'org-1', code: 'ORG-0001', legalName: 'TrekLink Demo Tours' },
  hardwareVariant: { id: 'v-3', code: 'treklink-v3' },
  devices: [device('TL-0009'), device('TL-0010')],
} as unknown as ContractDetail;

const renderPanel = (onReplaced = vi.fn().mockResolvedValue(undefined)) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReplacementPanel contract={contract} onReplaced={onReplaced} />
    </QueryClientProvider>,
  );
  return onReplaced;
};

const fill = (tag: string) => {
  fireEvent.change(screen.getByLabelText(/^Device to replace/), {
    target: { value: 'd-TL-0009' },
  });
  fireEvent.change(screen.getByLabelText(/^Replacement asset tag/), { target: { value: tag } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
  fireEvent.click(screen.getByRole('button', { name: 'Replace device' }));
};

afterEach(() => {
  cleanup();
  findAvailableUnit.mockReset();
  replaceDevice.mockReset();
});

describe('ReplacementPanel (screen 5.5, rentals api-design 15)', () => {
  it('asks for the device, the tag and the signature before anything is sent', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Replace device' }));
    expect(screen.getByText('Choose the device to replace.')).toBeTruthy();
    expect(screen.getByText('Scan or type the asset tag of the replacement.')).toBeTruthy();
    expect(screen.getByText('The Manager signs on screen before the replacement.')).toBeTruthy();
    expect(findAvailableUnit).not.toHaveBeenCalled();
  });

  it('names a tag that is not an available unit of the variant', async () => {
    findAvailableUnit.mockResolvedValue(null);
    renderPanel();
    fill('tl-0099');
    await waitFor(() =>
      expect(screen.getByText('TL-0099 is not an available treklink-v3 unit.')).toBeTruthy(),
    );
    expect(findAvailableUnit).toHaveBeenCalledWith('TL-0099', 'v-3');
    expect(replaceDevice).not.toHaveBeenCalled();
  });

  it('replaces at the current key version and reports the swap', async () => {
    findAvailableUnit.mockResolvedValue({ id: 'd-11', assetTag: 'TL-0011' });
    replaceDevice.mockResolvedValue({
      replacedDeviceId: 'd-TL-0009',
      replacementDeviceId: 'd-11',
      contractDeviceId: 'cd-3',
      replacesId: 'cd-1',
      noteSha256: 'abc',
    });
    const onReplaced = renderPanel();
    fill('TL-0011');
    await waitFor(() =>
      expect(
        screen.getByText(/TL-0009 replaced by TL-0011. The returned unit waits for reset/),
      ).toBeTruthy(),
    );
    expect(replaceDevice).toHaveBeenCalledWith('c-1', 'd-TL-0009', {
      replacementDeviceId: 'd-11',
      keyVersion: 2,
      signatureImage: 'data:image/png;base64,iVBORw0KGgo=',
      faultyPresent: true,
    });
    expect(onReplaced).toHaveBeenCalled();
  });
});
