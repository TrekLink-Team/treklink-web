// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession, type SessionUser } from '../../entities/session/model';
import { ApiError } from '../../shared/api/apiClient';
import { useToast } from '../../shared/ui';
import { ChannelKeySection } from './ChannelKeySection';

const api = vi.fn();
vi.mock('../../shared/api/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/api/apiClient')>()),
  apiClient: (...args: unknown[]) => api(...args),
}));

// The signed-in account through the real session store, as AuthProvider reads it.
const signInAs = (roles: string[]) =>
  useSession.setState({ user: { roles } as SessionUser });

const ORG = { id: 'org-1', code: 'ORG-0007', status: 'ACTIVE' };
const DETAIL = '/organizations/org-1';

const summary = (overrides: Record<string, unknown> = {}) => ({
  id: 'org-1',
  code: 'ORG-0007',
  legalName: 'Ta Nang Treks',
  status: 'ACTIVE',
  statusChangedAt: '2026-10-01T00:00:00.000Z',
  channelKeyVersion: 3,
  channelKeyExposedAt: null,
  version: 3,
  ...overrides,
});

const serve = (
  detail: () => unknown,
  respond: (endpoint: string, options?: RequestInit) => unknown = () => undefined,
) =>
  api.mockImplementation((endpoint: string, options?: RequestInit) => {
    if (endpoint === DETAIL && !options?.method) return Promise.resolve(detail());
    return Promise.resolve().then(() => respond(endpoint, options));
  });

const renderWidget = (organization: { id: string; code: string; status: string } = ORG) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ChannelKeySection organization={organization} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  api.mockReset();
  signInAs(['STAFF']);
  useToast.getState().dismiss();
});
afterEach(cleanup);

describe('ChannelKeySection (screen 3.6)', () => {
  it('shows the channel key version and offers Record key rotation to Staff', async () => {
    serve(() => summary());
    renderWidget();
    expect(await screen.findByText('3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record key rotation' })).toBeTruthy();
    expect(screen.queryByText(/Channel key exposed since/)).toBeNull();
  });

  it('offers Record key rotation to Admin, by FR-AUTH-10 inheritance (leader ruling 2026-10-30)', async () => {
    signInAs(['ADMIN']);
    serve(() => summary());
    renderWidget();
    await screen.findByText('3');
    expect(screen.getByRole('button', { name: 'Record key rotation' })).toBeTruthy();
  });

  it('shows the exposure notice when channelKeyExposedAt is present', async () => {
    serve(() => summary({ channelKeyExposedAt: '2026-10-29T03:00:00.000Z' }));
    renderWidget();
    expect(await screen.findByText(/Channel key exposed since/)).toBeTruthy();
  });

  it('hides Record key rotation for a non-Staff role, but still shows the version', async () => {
    signInAs(['ORG_MANAGER']);
    serve(() => summary());
    renderWidget();
    await screen.findByText('3');
    expect(screen.queryByRole('button', { name: 'Record key rotation' })).toBeNull();
  });

  it('renders nothing for a PENDING or REJECTED organization', () => {
    renderWidget({ id: 'org-1', code: 'ORG-0007', status: 'PENDING' });
    expect(api).not.toHaveBeenCalled();
    expect(screen.queryByText('Channel key')).toBeNull();
  });

  it('records a rotation and clears the exposure notice', async () => {
    serve(
      () => summary({ channelKeyExposedAt: '2026-10-29T03:00:00.000Z' }),
      (endpoint, options) => {
        expect(endpoint).toBe('/organizations/org-1/channel-key/rotate');
        expect(JSON.parse((options?.body as string) ?? '{}')).toEqual({
          reason: 'Device TL-0042 lost in renter custody',
          expectedVersion: 3,
        });
        return { id: 'org-1', channelKeyVersion: 4, channelKeyExposedAt: null };
      },
    );
    renderWidget();
    await screen.findByText(/Channel key exposed since/);
    fireEvent.click(screen.getByRole('button', { name: 'Record key rotation' }));

    const dialog = screen.getByRole('dialog', { name: 'Record key rotation for ORG-0007?' });
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), {
      target: { value: 'Device TL-0042 lost in renter custody' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record key rotation' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useToast.getState().message).toBe('Channel key rotated');
  });

  it('refuses a blank reason without calling the server (MSG02)', async () => {
    serve(() => summary());
    renderWidget();
    await screen.findByText('3');
    fireEvent.click(screen.getByRole('button', { name: 'Record key rotation' }));
    const dialog = screen.getByRole('dialog', { name: 'Record key rotation for ORG-0007?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record key rotation' }));
    expect(await within(dialog).findByText('Reason is required.')).toBeTruthy();
    expect(api.mock.calls.filter(([, options]) => (options as RequestInit | undefined)?.method === 'POST')).toHaveLength(0);
  });

  it('shows MSG36 with a Reload control on STALE_VERSION, not the server text', async () => {
    serve(
      () => summary(),
      () => {
        throw new ApiError(409, 'STALE_VERSION', 'This was changed by someone else. Reload and try again.');
      },
    );
    renderWidget();
    await screen.findByText('3');
    fireEvent.click(screen.getByRole('button', { name: 'Record key rotation' }));
    const dialog = screen.getByRole('dialog', { name: 'Record key rotation for ORG-0007?' });
    fireEvent.change(within(dialog).getByLabelText(/^Reason/), { target: { value: 'Retry' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record key rotation' }));
    expect(await within(dialog).findByText('Someone else changed this. Reload to see the latest.')).toBeTruthy();
    expect(within(dialog).queryByText('This was changed by someone else. Reload and try again.')).toBeNull();
  });
});
