import { DomainException, ErrorCode } from '../../common/errors';
import { DemoPanelLock } from './demo-panel-lock';
import { DemoPanelPlayback, PLAYBACK_WAIT_POLL_MS } from './demo-panel-playback';
import { PANEL_ACTIONS } from './demo-panel-actions';
import { PLAYBACK_COMMANDS } from './demo-panel.service';
import type { PanelInput, PanelResult } from './demo-panel.service';

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

const build = () => {
  const panel = {
    run: jest.fn<Promise<PanelResult>, [string, PanelInput, string]>((command) =>
      Promise.resolve({
        action: command as PanelResult['action'],
        runId: 1,
        label: 'Demo 1',
        actedAs: null,
        records: [{ label: command, code: 'X', path: '/x' }],
        context: command === 'incident-sos' ? { incidentId: 'i-1' } : {},
      }),
    ),
  };
  const contracts = {
    byCode: jest.fn().mockResolvedValue({ id: 'c-2', version: 7 }),
    demoDetail: jest.fn().mockResolvedValue({ id: 'c-2', version: 8 }),
    panelOptions: jest.fn().mockResolvedValue([]),
    visibleDevices: jest.fn().mockResolvedValue([]),
  };
  const devices = {
    byAssetTag: jest.fn().mockResolvedValue({ id: 'd-10', status: 'RENTED' }),
    projections: jest.fn().mockResolvedValue([]),
  };
  const incidents = { panelRecord: jest.fn().mockResolvedValue({ id: 'i-1', version: 3 }) };
  const organizations = {
    activeDemoOptions: jest.fn().mockResolvedValue([{ id: 'org-1', code: 'ORG-0001' }]),
  };
  const lock = new DemoPanelLock();
  const playback = new DemoPanelPlayback(
    panel as never,
    contracts as never,
    devices as never,
    incidents as never,
    organizations as never,
    lock,
  );
  return { playback, panel, contracts, lock, organizations };
};

describe('DemoPanelPlayback (REQ-PNL-08)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('plays MF-03 one step per interval, each through a panel command, then ends DONE', async () => {
    const { playback, panel } = build();
    const started = await playback.command(
      { command: 'START', flow: 'MF-03', intervalSeconds: 5 },
      '1.2.3.4',
    );
    expect(started).toMatchObject({
      flow: 'MF-03',
      status: 'RUNNING',
      index: 0,
      intervalSeconds: 5,
    });
    expect(started.steps).toHaveLength(4);
    await jest.advanceTimersByTimeAsync(0);
    await flush();
    expect(panel.run).toHaveBeenCalledWith('incident-sos', { deviceId: 'd-10' }, '1.2.3.4');
    expect(playback.view()).toMatchObject({ index: 1, status: 'RUNNING' });
    await jest.advanceTimersByTimeAsync(4999);
    expect(panel.run).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await flush();
    expect(panel.run).toHaveBeenLastCalledWith(
      'incident-acknowledge',
      { recordId: 'i-1', expectedVersion: 3 },
      '1.2.3.4',
    );
    await jest.advanceTimersByTimeAsync(10_000);
    await flush();
    expect(panel.run.mock.calls.map(([command]) => command)).toEqual([
      'incident-sos',
      'incident-acknowledge',
      'incident-respond',
      'incident-resolve',
    ]);
    expect(playback.view().status).toBe('DONE');
    expect(playback.view().steps.every((step) => step.status === 'DONE')).toBe(true);
    expect(playback.active()).toBe(false);
  });

  it('pauses, runs the next step on STEP, resumes and stops', async () => {
    const { playback, panel } = build();
    await playback.command({ command: 'START', flow: 'MF-05', intervalSeconds: 10 }, 'ip');
    await jest.advanceTimersByTimeAsync(0);
    await flush();
    expect(panel.run).toHaveBeenCalledWith(
      'contract-return',
      { recordId: 'c-2', expectedVersion: 7 },
      'ip',
    );
    await playback.command({ command: 'PAUSE' }, 'ip');
    expect(playback.view()).toMatchObject({ status: 'PAUSED', nextAt: null });
    expect(playback.active()).toBe(true);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(panel.run).toHaveBeenCalledTimes(1);
    const stepped = await playback.command({ command: 'STEP' }, 'ip');
    expect(panel.run).toHaveBeenLastCalledWith(
      'contract-close',
      { recordId: 'c-2', expectedVersion: 8 },
      'ip',
    );
    expect(stepped.status).toBe('DONE');
    await expect(playback.command({ command: 'RESUME' }, 'ip')).rejects.toMatchObject({
      errorCode: 'INVALID_STATE_TRANSITION',
    });
  });

  it('stops a running playback and refuses PAUSE, STEP and STOP afterwards', async () => {
    const { playback, panel } = build();
    await playback.command({ command: 'START', flow: 'MF-01b' }, 'ip');
    await playback.command({ command: 'STOP' }, 'ip');
    await jest.advanceTimersByTimeAsync(60_000);
    expect(panel.run).not.toHaveBeenCalled();
    expect(playback.view().status).toBe('STOPPED');
    for (const command of ['PAUSE', 'STEP', 'STOP'] as const) {
      await expect(playback.command({ command }, 'ip')).rejects.toMatchObject({
        errorCode: 'INVALID_STATE_TRANSITION',
      });
    }
  });

  it('stops at a failed step with its error and committed links', async () => {
    const { playback, panel } = build();
    panel.run.mockRejectedValueOnce(
      new DomainException(409, ErrorCode.STALE_VERSION, 'Reload and try again.', {
        runId: 2,
        label: 'Demo 2',
        records: [{ label: 'Contract', code: 'RC-2026-0002', path: '/t/contracts/c-2' }],
      }),
    );
    await playback.command({ command: 'START', flow: 'MF-05' }, 'ip');
    await jest.advanceTimersByTimeAsync(0);
    await flush();
    const view = playback.view();
    expect(view.status).toBe('FAILED');
    expect(view.error).toBe('Term ends and units come back: Reload and try again.');
    expect(view.steps[0]).toMatchObject({
      status: 'FAILED',
      records: [{ code: 'RC-2026-0002' }],
    });
    await jest.advanceTimersByTimeAsync(60_000);
    expect(panel.run).toHaveBeenCalledTimes(1);
  });

  it('runs a narration-only flow without any write', async () => {
    const { playback, panel } = build();
    await playback.command({ command: 'START', flow: 'MF-04', intervalSeconds: 3 }, 'ip');
    await jest.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(panel.run).not.toHaveBeenCalled();
    expect(playback.view().status).toBe('DONE');
  });

  it('refuses a second START, a START during a reseed, an unknown flow and an interval out of bounds', async () => {
    const { playback, lock } = build();
    for (const input of [
      { command: 'START' as const },
      { command: 'START' as const, flow: 'MF-09' as never },
      { command: 'START' as const, flow: 'MF-03' as const, intervalSeconds: 2 },
      { command: 'START' as const, flow: 'MF-03' as const, intervalSeconds: 61 },
    ]) {
      await expect(playback.command(input, 'ip')).rejects.toMatchObject({
        errorCode: 'VALIDATION_FAILED',
      });
    }
    lock.beginReset();
    await expect(playback.command({ command: 'START', flow: 'MF-03' }, 'ip')).rejects.toMatchObject(
      {
        errorCode: 'DEMO_BUSY',
      },
    );
    lock.endReset();
    await playback.command({ command: 'START', flow: 'MF-03' }, 'ip');
    await expect(playback.command({ command: 'START', flow: 'MF-04' }, 'ip')).rejects.toMatchObject(
      {
        errorCode: 'DEMO_BUSY',
      },
    );
  });

  const startMf01a = async (f: ReturnType<typeof build>) => {
    f.panel.run
      .mockResolvedValueOnce({
        action: 'organization-register',
        runId: 1,
        label: 'Demo 1',
        actedAs: null,
        records: [],
        context: { organizationId: 'org-9', organizationCode: 'ORG-0009', version: 0 },
      })
      .mockResolvedValueOnce({
        action: 'organization-verify',
        runId: 2,
        label: 'Demo 2',
        actedAs: null,
        records: [],
        context: { organizationId: 'org-9', version: 1 },
      });
    await f.playback.command({ command: 'START', flow: 'MF-01a', intervalSeconds: 3 }, 'ip');
    await jest.advanceTimersByTimeAsync(7_000);
    await flush();
  };

  it('plays MF-01a, then waits at the Admin approval with a prompt and acts as no Admin (D-110)', async () => {
    const f = build();
    await startMf01a(f);
    expect(f.panel.run.mock.calls.map(([command, input]) => [command, input])).toEqual([
      ['organization-register', {}],
      ['organization-verify', { recordId: 'org-9', expectedVersion: 0 }],
    ]);
    const view = f.playback.view();
    expect(view).toMatchObject({ status: 'PAUSED', index: 2 });
    expect(view.steps[2]).toMatchObject({
      status: 'WAITING',
      prompt:
        'Approve ORG-0009 on the Admin screen (Organizations, tab Pending, Approve). The playback resumes by itself once it is Active, or press Resume.',
    });
    // Still pending on the real screen: the playback keeps waiting and runs nothing.
    await jest.advanceTimersByTimeAsync(30_000);
    expect(f.panel.run).toHaveBeenCalledTimes(2);
    expect(f.playback.view().steps[2].status).toBe('WAITING');
  });

  it('resumes by itself once the organization is approved on the real screen', async () => {
    const f = build();
    await startMf01a(f);
    f.organizations.activeDemoOptions.mockResolvedValue([
      { id: 'org-1', code: 'ORG-0001' },
      { id: 'org-9', code: 'ORG-0009' },
    ]);
    await jest.advanceTimersByTimeAsync(PLAYBACK_WAIT_POLL_MS);
    await flush();
    expect(f.playback.view()).toMatchObject({ status: 'DONE', index: 3 });
    expect(f.playback.view().steps[2]).toMatchObject({ status: 'DONE', prompt: null });
    expect(f.panel.run).toHaveBeenCalledTimes(2);
  });

  it('moves past the waiting step when the operator presses Resume', async () => {
    const f = build();
    await startMf01a(f);
    const resumed = await f.playback.command({ command: 'RESUME' }, 'ip');
    expect(resumed).toMatchObject({ status: 'DONE', index: 3 });
    expect(f.panel.run).toHaveBeenCalledTimes(2);
  });

  it('never runs a command outside the panel commands in any flow, so no flow can act as an Admin', async () => {
    for (const flow of [
      'MF-01a',
      'MF-01b',
      'MF-01c',
      'MF-02',
      'MF-03',
      'MF-04',
      'MF-05',
    ] as const) {
      const f = build();
      await f.playback.command({ command: 'START', flow, intervalSeconds: 3 }, 'ip');
      await jest.advanceTimersByTimeAsync(60_000);
      await flush();
      for (const [command] of f.panel.run.mock.calls)
        expect([...PANEL_ACTIONS, ...PLAYBACK_COMMANDS]).toContain(command);
    }
  });
});
