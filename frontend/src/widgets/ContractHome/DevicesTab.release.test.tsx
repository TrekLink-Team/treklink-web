// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContractDetail, ContractDevice } from '../../entities/contract/api';
import { DevicesTab } from './DevicesTab';
import type { Viewer } from './policy';

// Release a unit on the contract home's Devices tab (screen 5.2, D-099): on the last releasable unit the
// action stays visible, disabled, with where to go instead (chapter 06 §11.4).

const unit = (id: string, extra: Partial<ContractDevice> = {}): ContractDevice => ({
  deviceId: id,
  assetTag: `TL-${id}`,
  handedOverAt: '2026-11-01T02:00:00Z',
  checkedInAt: null,
  lostAt: null,
  holder: null,
  ...extra,
});

const contract = (devices: ContractDevice[], extra: Partial<ContractDetail> = {}): ContractDetail =>
  ({
    id: 'c-1',
    code: 'RC-2026-0004',
    status: 'ACTIVE',
    quantity: devices.length,
    devices,
    terms: [],
    balance: { dueNowVnd: 0, dueLaterVnd: 0 },
    ...extra,
  }) as ContractDetail;

const onRelease = vi.fn();

const show = (detail: ContractDetail, viewer: Viewer = 'staff') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <DevicesTab
          contract={detail}
          scope="t"
          viewer={viewer}
          canLabel={false}
          onLabel={vi.fn()}
          onReportLost={vi.fn()}
          onRequestCredit={vi.fn()}
          onRelease={onRelease}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const reasonOf = (button: HTMLElement) =>
  document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent ?? null;

afterEach(() => {
  cleanup();
  onRelease.mockReset();
});

describe('DevicesTab Release on the last unit', () => {
  it('keeps Release on the last unit out of a running contract, disabled, with End the contract instead', () => {
    // One unit out, the other already back: the unit out is the last one Release could take.
    show(contract([unit('0001'), unit('0002', { checkedInAt: '2026-11-20T02:00:00Z' })]));
    const release = screen.getByRole('button', { name: 'Release TL-0001' });
    expect(release.getAttribute('aria-disabled')).toBe('true');
    expect(reasonOf(release)).toBe('This is the last unit. End the contract now instead.');
    fireEvent.click(release);
    expect(onRelease).not.toHaveBeenCalled();
  });

  it('shows the disabled Release with its reason in the details pane', () => {
    show(contract([unit('0001')]));
    fireEvent.click(screen.getByRole('button', { name: 'Show details of TL-0001' }));
    const pane = within(screen.getByRole('complementary', { name: 'TL-0001' }));
    expect((pane.getByRole('button', { name: 'Release TL-0001' }) as HTMLButtonElement).disabled).toBe(true);
    expect(pane.getByText('This is the last unit. End the contract now instead.')).toBeTruthy();
  });

  it('names Cancel the request on the last unit held before the handover', () => {
    show(contract([unit('0001', { handedOverAt: null })], { status: 'APPROVED' }));
    const release = screen.getByRole('button', { name: 'Release TL-0001' });
    expect(release.getAttribute('aria-disabled')).toBe('true');
    expect(reasonOf(release)).toBe('This is the last unit. Cancel the request instead.');
  });

  it('lets Staff release a unit while two or more are out', () => {
    show(contract([unit('0001'), unit('0002')]));
    const release = screen.getByRole('button', { name: 'Release TL-0001' });
    expect(release.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(release);
    expect(onRelease).toHaveBeenCalledWith(expect.objectContaining({ deviceId: '0001' }));
  });

  it('shows no Release to a role that never has it', () => {
    show(contract([unit('0001')]), 'operator');
    expect(screen.queryByRole('button', { name: /^Release/ })).toBeNull();
  });
});
