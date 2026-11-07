// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContractDevice } from '../../entities/contract/api';
import type { DeviceFaultReport } from '../../entities/rented-device/api';
import { ApiError } from '../../shared/api/apiClient';
import { formatDateTime } from '../../shared/lib/format';
import { RequestServiceCreditDialog } from './RequestServiceCreditDialog';

const api = vi.fn();
vi.mock('../../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

const device: ContractDevice = {
  deviceId: 'device-1',
  contractDeviceId: 'custody-1',
  assetTag: 'TL-0001',
  handedOverAt: '2026-11-01T02:00:00Z',
  checkedInAt: '2026-11-04T02:00:00Z',
  lostAt: null,
  holder: null,
  inspection: { id: 'inspection-1', result: 'FAILED', at: '2026-11-04T03:00:00Z' },
};

const report: DeviceFaultReport = {
  id: 'report-1',
  contractDeviceId: 'custody-1',
  deviceId: 'device-1',
  assetTag: 'TL-0001',
  description: 'Radio failure',
  reportedAt: '2026-11-02T02:00:00Z',
  resolvedAt: '2026-11-04T02:00:00Z',
  resolution: 'CHECKED_IN',
};

const show = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <RequestServiceCreditDialog contractId="contract-1" device={device} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
};

const chooseCause = () =>
  fireEvent.change(screen.getByLabelText(/^Cause/), {
    target: { value: 'RADIO_FAULT' },
  });
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Request' }));

afterEach(() => {
  cleanup();
  api.mockReset();
});

describe('RequestServiceCreditDialog fault report source', () => {
  it('includes open and resolved reports from the exact custody row and sends the chosen id only', async () => {
    api
      .mockResolvedValueOnce([
        report,
        {
          ...report,
          id: 'open',
          description: 'Open radio fault',
          resolvedAt: null,
          resolution: null,
        },
        { ...report, id: 'old', contractDeviceId: 'old-custody', description: 'Old radio fault' },
      ])
      .mockResolvedValueOnce({});
    const onClose = show();
    const picker = await screen.findByRole('combobox', { name: 'Fault report' });
    expect(within(picker).getByRole('option', { name: /Resolved.*Radio failure/ })).toBeTruthy();
    expect(within(picker).getByRole('option', { name: /Open.*Open radio fault/ })).toBeTruthy();
    expect(within(picker).queryByRole('option', { name: /Old radio fault/ })).toBeNull();
    chooseCause();
    fireEvent.change(picker, { target: { value: report.id } });
    expect(
      screen.getByText(`Outage start: ${formatDateTime(report.reportedAt)}. Radio failure`),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/^Source of the start/)).toBeNull();
    submit();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(api).toHaveBeenCalledWith('/contracts/contract-1/service-credits', {
      method: 'POST',
      body: JSON.stringify({
        contractDeviceId: device.contractDeviceId,
        cause: 'RADIO_FAULT',
        faultInspectionId: device.inspection?.id,
        outageSourceFaultReportId: report.id,
      }),
    });
  });

  it('keeps the manual date and note usable if the history request fails', async () => {
    api
      .mockRejectedValueOnce(new ApiError(503, 'SERVICE_UNAVAILABLE', 'History unavailable.'))
      .mockResolvedValueOnce({});
    const onClose = show();
    await screen.findByText('Fault reports could not be loaded. You can still enter a note.');
    chooseCause();
    const start = '2026-11-02T09:00';
    fireEvent.change(screen.getByLabelText(/^Outage start/), { target: { value: start } });
    fireEvent.change(screen.getByLabelText(/^Source of the start/), {
      target: { value: ' Called the counter at 09:00. ' },
    });
    submit();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(api).toHaveBeenCalledWith('/contracts/contract-1/service-credits', {
      method: 'POST',
      body: JSON.stringify({
        contractDeviceId: device.contractDeviceId,
        cause: 'RADIO_FAULT',
        faultInspectionId: device.inspection?.id,
        outageFrom: new Date(start).toISOString(),
        outageSourceNote: 'Called the counter at 09:00.',
      }),
    });
  });
});
