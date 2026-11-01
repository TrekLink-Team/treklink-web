// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DemoScenario, DemoStatus, StageResult } from '../entities/demo/api';
import { useSession } from '../entities/session/model';
import { ApiError } from '../shared/api/apiClient';
import { DemoControlPage } from './DemoControlPage';

const stageScenario = vi.fn();
let status: { data?: DemoStatus | null; isPending: boolean; error: unknown } = {
  isPending: true,
  error: null,
};
let scenarios: { data?: DemoScenario[]; isPending: boolean; error: unknown } = {
  isPending: true,
  error: null,
};

vi.mock('../entities/demo/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/demo/api')>()),
  useDemoStatus: () => status,
  useDemoScenarios: () => scenarios,
  stageScenario: (...args: unknown[]) => stageScenario(...args),
}));

const SCENARIOS: DemoScenario[] = [
  {
    id: 'term-ended',
    title: 'Term ended, return due',
    flow: 'MF-05',
    summary: 'RC-2026-0002 is RETURN_DUE at the counter.',
    available: true,
    unavailableReason: null,
  },
  {
    id: 'loss-cases',
    title: 'Loss cases',
    flow: 'MF-05',
    summary: 'A device reported lost.',
    available: false,
    unavailableReason: 'Needs the loss cases change (treklink-web#228).',
  },
];

const ADMIN = {
  id: 'admin-old',
  email: 'admin@treklink.local',
  fullName: 'Demo Admin',
  accountType: 'TREKLINK' as const,
  roles: ['ADMIN'],
  organization: null,
};
const TOKENS = { accessToken: 'old', accessTokenExpiresIn: 900, refreshToken: 'r', refreshTokenExpiresIn: 9 };

const RESULT: StageResult = {
  scenarioId: 'term-ended',
  stagedAt: '2026-11-01T03:00:00.000Z',
  records: [{ label: 'Counter check-in', code: 'RC-2026-0002', path: '/t/counter/c-2' }],
  firstSteps: ['Window B, Staff: open the counter.', 'Check-in: TL-0017 and TL-0018.'],
  session: { ...TOKENS, accessToken: 'new', user: { ...ADMIN, id: 'admin-new' } },
};

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/t/admin/demo']}>
        <DemoControlPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('DemoControlPage (screen 7.5, D-088)', () => {
  beforeEach(() => {
    stageScenario.mockReset();
    status = { data: { enabled: true, databaseLocal: true, lastStaged: null }, isPending: false, error: null };
    scenarios = { data: SCENARIOS, isPending: false, error: null };
    act(() => useSession.getState().signIn(TOKENS, ADMIN));
  });
  afterEach(() => cleanup());

  it('shows MSG26 while demo mode is off', () => {
    status = { data: null, isPending: false, error: null };
    show();
    expect(screen.getByRole('alert').textContent).toBe('You do not have access to this.');
    expect(screen.queryByText('Demo control')).toBeNull();
  });

  it('lists a card per scenario with its flow, and disables an unavailable one with its reason', () => {
    show();
    const card = screen.getByRole('article', { name: 'Term ended, return due' });
    expect(within(card).getByText('MF-05')).toBeTruthy();
    const loss = screen.getByRole('article', { name: 'Loss cases' });
    expect(within(loss).getByText('Needs the loss cases change (treklink-web#228).')).toBeTruthy();
    expect((within(loss).getByRole('button', { name: 'Stage' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('group', { name: 'Switch role' })).toBeTruthy();
  });

  it('shows the red notice and disables every action when the database is not local', () => {
    status = { data: { enabled: true, databaseLocal: false, lastStaged: null }, isPending: false, error: null };
    show();
    expect(screen.getByRole('alert').textContent).toContain('Demo controls run only against a local database.');
    for (const button of screen.getAllByRole('button')) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('asks in a dialog before staging, and Cancel stages nothing', () => {
    show();
    fireEvent.click(within(screen.getByRole('article', { name: 'Term ended, return due' })).getByRole('button', { name: 'Stage' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain(
      'This deletes every row in the local database and stages Term ended, return due. Every other window must sign in again. If the stage fails, the database is left empty: stage again.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(stageScenario).not.toHaveBeenCalled();
  });

  it('stages, keeps this window signed in as the new Admin, and shows the records and first steps', async () => {
    stageScenario.mockResolvedValue(RESULT);
    show();
    fireEvent.click(within(screen.getByRole('article', { name: 'Term ended, return due' })).getByRole('button', { name: 'Stage' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stage' }));
    const heading = await screen.findByRole('heading', { name: 'Staged: Term ended, return due' });
    expect(stageScenario).toHaveBeenCalledWith('term-ended');
    expect(useSession.getState().user?.id).toBe('admin-new');
    expect(useSession.getState().tokens?.accessToken).toBe('new');
    expect(screen.getByRole('link', { name: 'RC-2026-0002' }).getAttribute('href')).toBe('/t/counter/c-2');
    const steps = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(steps).toContain('Check-in: TL-0017 and TL-0018.');
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it('shows the server message of a refused stage', async () => {
    stageScenario.mockRejectedValue(
      new ApiError(409, 'DEMO_BUSY', 'A demo action is already running. Try again in a moment.'),
    );
    show();
    fireEvent.click(within(screen.getByRole('article', { name: 'Term ended, return due' })).getByRole('button', { name: 'Stage' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stage' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'A demo action is already running. Try again in a moment.',
    );
    expect(useSession.getState().user?.id).toBe('admin-old');
  });
});
