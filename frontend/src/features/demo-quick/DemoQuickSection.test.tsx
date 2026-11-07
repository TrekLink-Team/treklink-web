// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoQuickSection } from './DemoQuickSection';
import { ApiError } from '../../shared/api/apiClient';
import type { QuickOptions } from '../../entities/demo/api';

const mutateAsync = vi.fn();
let data: QuickOptions;
let queryError: unknown = null;
vi.mock('../../entities/demo/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../entities/demo/api')>()),
  useDemoQuickOptions: () => ({ data, isPending: false, error: queryError }),
  useRunDemoQuick: () => ({ mutateAsync, isPending: false, variables: undefined }),
}));
const show = () =>
  render(
    <MemoryRouter>
      <DemoQuickSection />
    </MemoryRouter>,
  );

describe('W43 quick controls', () => {
  beforeEach(() => {
    queryError = null;
    data = {
      organizations: [{ id: 'org', code: 'ORG-1', legalName: 'Demo tours' }],
      variants: [{ id: 'variant', code: 'v3' }],
      minimumQuantity: 5,
      units: [
        {
          deviceId: 'unit',
          assetTag: 'TL-1',
          contractId: 'contract',
          contractCode: 'RC-1',
          nodeNum: 42,
        },
      ],
      contracts: [{ id: 'contract', code: 'RC-1', version: 3 }],
      incidents: [{ id: 'incident', code: 'INC-1', state: 'NOTIFY_PRIMARY', version: 7 }],
      profile: { active: false, version: 2 },
    };
    mutateAsync.mockReset().mockResolvedValue({
      runId: 1,
      label: 'Demo 1',
      records: [{ label: 'Pending organization', code: 'ORG-NEW', path: '/t/organizations/new' }],
      error: null,
      errorCode: null,
    });
  });
  afterEach(cleanup);
  it('groups all workflows and discloses simulation, synthetic signing and demo time controls', () => {
    show();
    for (const name of [/WF-01/, /WF-02/, /WF-03/, /WF-04/, /WF-05/, /Demo time controls/])
      expect(screen.getByRole('heading', { name })).toBeTruthy();
    expect(screen.getByText('Simulated')).toBeTruthy();
    expect(
      screen.getByText(/Quick contracts record the signed-in Admin as requester/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Quick fault reports record the signed-in Admin as reporter/),
    ).toBeTruthy();
    expect(screen.getByText(/synthetic signature/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stage' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
  });
  it('creates organization without a reset confirmation and announces linked results', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Quick organization registration' }));
    await screen.findByRole('link', { name: 'ORG-NEW' });
    expect(mutateAsync).toHaveBeenCalledWith({ action: 'organization', input: {} });
  });
  it('sends the chosen contract state, organization, variant and parameter minimum', async () => {
    show();
    fireEvent.change(screen.getByLabelText(/Target state/), { target: { value: 'ACTIVE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Quick contract' }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        action: 'contract',
        input: {
          organizationId: 'org',
          hardwareVariantId: 'variant',
          quantity: 5,
          target: 'ACTIVE',
        },
      }),
    );
  });
  it('requires confirmation before toggling the persistent profile with its version', async () => {
    show();
    fireEvent.click(screen.getByRole('switch', { name: 'Enable demo escalation' }));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enable demo escalation' }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        action: 'profile',
        input: { active: true, expectedVersion: 2 },
      }),
    );
  });
  it('keeps partial links and the named cause visible after a failed step', async () => {
    mutateAsync.mockRejectedValueOnce(
      new ApiError(
        409,
        'CHANNEL_KEY_EXPOSED',
        'The organization channel key is exposed. Rotate it first.',
        {
          runId: 2,
          label: 'Demo 2',
          records: [{ label: 'Contract', code: 'RC-NEW', path: '/t/contracts/new' }],
        },
      ),
    );
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Quick contract' }));
    expect(await screen.findByRole('link', { name: 'RC-NEW' })).toBeTruthy();
    expect(screen.getByText(/Rotate it first/)).toBeTruthy();
  });
  it('explains unavailable units and contracts and keeps their actions disabled', () => {
    data.units = [];
    data.contracts = [];
    data.incidents = [];
    show();
    expect(
      (screen.getByRole('button', { name: 'Quick incident' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText('No Active or Ending contract is available.')).toBeTruthy();
  });
  it('uses the selected incident version and allows cancellation of the time control', async () => {
    show();
    fireEvent.change(screen.getByLabelText(/Simulated incident to advance/), {
      target: { value: 'incident' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Advance incident to next tier' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Advance incident to next tier' }));
    const buttons = screen.getAllByRole('button', { name: 'Advance incident to next tier' });
    fireEvent.click(buttons.at(-1)!);
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        action: 'next-tier',
        input: { recordId: 'incident', expectedVersion: 7 },
      }),
    );
  });
  it('preserves the database/environment refusal cause instead of a generic access message', () => {
    queryError = new ApiError(
      403,
      'DEMO_DATABASE_NOT_ALLOWED',
      'Demo quick controls require a local or staging database.',
    );
    show();
    expect(
      screen.getByText(/Demo quick controls require a local or staging database/),
    ).toBeTruthy();
  });

  it('reports a transport error by its cause', async () => {
    mutateAsync.mockRejectedValueOnce(
      new ApiError(503, 'UNAVAILABLE', 'Network connection failed.'),
    );
    show();
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Refresh simulated walkers' })),
    );
    expect(screen.getByText(/Network connection failed/)).toBeTruthy();
  });
});
