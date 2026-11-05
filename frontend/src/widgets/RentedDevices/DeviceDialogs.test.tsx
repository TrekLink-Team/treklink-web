// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RentedDevice } from '../../entities/rented-device/api';
import { ApiError } from '../../shared/api/apiClient';
import { formatDateTime } from '../../shared/lib/format';
import { ContractActionDialog, FaultHistoryDialog, ReportFaultDialog } from './DeviceDialogs';

const api = vi.fn();
vi.mock('../../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));
const device: RentedDevice = {
  deviceId: 'device-1',
  assetTag: 'TL-0001',
  variantCode: 'V3',
  contract: { id: 'contract-1', code: 'CT-0001', planType: 'MONTHLY', status: 'ACTIVE' },
  contractDeviceId: 'row-1',
  handedOverAt: '2026-11-01T00:00:00Z',
  state: 'LIVE',
  batteryPct: 81,
  lastSeenAt: null,
  group: null,
  holder: { name: 'Hiker One' },
  openFaultReportId: null,
  openLossCase: null,
};
const report = {
  id: 'report-1',
  deviceId: device.deviceId,
  assetTag: device.assetTag,
  description: 'Radio failure',
  reportedAt: '2026-11-05T02:00:00Z',
  resolvedAt: null,
  resolution: null,
};
const contract = {
  ...device.contract,
  version: 4,
  currentTerm: { endsAt: '2026-12-01T00:00:00Z' },
  devices: [
    {
      deviceId: device.deviceId,
      assetTag: device.assetTag,
      handedOverAt: device.handedOverAt,
      checkedInAt: null,
      lostAt: null,
      holder: { name: 'Hiker One', phone: null, emergencyContact: null },
    },
  ],
};
const show = (content: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
        })
      }
    >
      {content}
    </QueryClientProvider>,
  );
beforeEach(() => {
  api.mockReset();
});
afterEach(cleanup);

describe('FaultHistoryDialog', () => {
  it('shows the selected device reports, their resolution and the waiting state', async () => {
    api.mockResolvedValue([
      report,
      {
        ...report,
        id: 'resolved',
        description: 'Battery failure',
        resolvedAt: '2026-11-05T03:00:00Z',
        resolution: 'REPLACED',
      },
      { ...report, id: 'other-device', deviceId: 'device-2', description: 'Other unit fault' },
    ]);
    show(<FaultHistoryDialog device={device} onClose={vi.fn()} />);
    expect(await screen.findByText('Radio failure')).toBeTruthy();
    expect(screen.getByText('Waiting for TrekLink')).toBeTruthy();
    expect(screen.getByText(/^Device replaced/)).toBeTruthy();
    expect(screen.queryByText('Other unit fault')).toBeNull();
    expect(api).toHaveBeenCalledWith('/contracts/contract-1/fault-reports');
  });

  it('shows loading, then the empty state, without manufacturing a report', async () => {
    let complete!: (value: unknown[]) => void;
    api.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    show(<FaultHistoryDialog device={device} onClose={vi.fn()} />);
    expect(screen.getByText('Loading fault reports')).toBeTruthy();
    complete([]);
    expect(await screen.findByText('No faults have been reported for this device.')).toBeTruthy();
  });

  it('retries a failed history read and allows the dialog to close', async () => {
    api
      .mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'History unavailable.'))
      .mockResolvedValue([]);
    const onClose = vi.fn();
    show(<FaultHistoryDialog device={device} onClose={onClose} />);
    await screen.findByText('History unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('No faults have been reported for this device.');
    expect(api).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('ReportFaultDialog', () => {
  it('shows the existing report time after a concurrent duplicate and disables resubmission', async () => {
    api.mockImplementation(async (path: string) => {
      if (path.endsWith('/devices/device-1/fault-reports'))
        throw new ApiError(
          409,
          'FAULT_ALREADY_REPORTED',
          'A fault on this device is already reported.',
        );
      return [report];
    });
    const onReported = vi.fn();
    show(<ReportFaultDialog device={device} onClose={vi.fn()} onReported={onReported} />);
    fireEvent.change(screen.getByLabelText('What is wrong'), {
      target: { value: 'Radio failure' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Report fault' }));
    await screen.findByText(
      `A fault on TL-0001 is already reported and waits for TrekLink. Reported ${formatDateTime(report.reportedAt)}.`,
    );
    expect(
      (screen.getByRole('button', { name: 'Report fault' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(api).toHaveBeenCalledWith('/contracts/contract-1/fault-reports');
    expect(onReported).not.toHaveBeenCalled();
  });

  it('refuses whitespace descriptions and leaves the input for correction', () => {
    show(<ReportFaultDialog device={device} onClose={vi.fn()} onReported={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('What is wrong'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Report fault' }));
    expect(screen.getByText('Describe what is wrong.')).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });
});

describe('ContractActionDialog', () => {
  it('loads the live contract and saves the holder through the existing holder form', async () => {
    api.mockImplementation(async (path: string) =>
      path.endsWith('/holder') ? contract.devices[0] : contract,
    );
    const onClose = vi.fn();
    show(<ContractActionDialog device={device} action="holder" onClose={onClose} />);
    await screen.findByRole('dialog', { name: 'Holder of TL-0001' });
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Hiker One');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Hiker Two  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(api).toHaveBeenCalledWith('/contracts/contract-1/devices/device-1/holder', {
      method: 'PUT',
      body: JSON.stringify({ name: 'Hiker Two', phone: null, emergencyContact: null }),
    });
  });

  it('uses the latest contract version when giving notice', async () => {
    api.mockImplementation(async (path: string) =>
      path.endsWith('/notice')
        ? { ...contract, endsAt: contract.currentTerm.endsAt, dueAtEndVnd: 450000 }
        : contract,
    );
    const onClose = vi.fn();
    show(<ContractActionDialog device={device} action="notice" onClose={onClose} />);
    await screen.findByRole('dialog', { name: 'Give notice on CT-0001?' });
    fireEvent.click(screen.getByRole('button', { name: 'Give notice' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(api).toHaveBeenCalledWith('/contracts/contract-1/notice', {
      method: 'POST',
      body: JSON.stringify({ expectedVersion: 4 }),
    });
  });

  it('does not offer a holder form when the device has been checked in meanwhile', async () => {
    api.mockResolvedValue({
      ...contract,
      devices: [{ ...contract.devices[0], checkedInAt: '2026-11-05T03:00:00Z' }],
    });
    show(<ContractActionDialog device={device} action="holder" onClose={vi.fn()} />);
    await screen.findByText('This action is no longer available on this contract.');
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('does not offer notice for a day-plan contract', async () => {
    api.mockResolvedValue({ ...contract, planType: 'DAY' });
    show(<ContractActionDialog device={device} action="notice" onClose={vi.fn()} />);
    await screen.findByText('This action is no longer available on this contract.');
    expect(screen.queryByRole('button', { name: 'Give notice' })).toBeNull();
  });

  it('keeps the loading shell and retry action for an unsuccessful contract read', async () => {
    let fail!: (failure: Error) => void;
    api
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      )
      .mockResolvedValue(contract);
    show(<ContractActionDialog device={device} action="notice" onClose={vi.fn()} />);
    expect(screen.getByText('Loading the contract')).toBeTruthy();
    fail(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Contract unavailable.'));
    await screen.findByText('Contract unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('dialog', { name: 'Give notice on CT-0001?' });
  });
});
