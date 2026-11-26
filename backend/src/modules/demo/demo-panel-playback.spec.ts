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
        // As the real commands: the SOS names its incident, a handover and a return their contract.
        context:
          command === 'incident-sos'
            ? { incidentId: 'i-1' }
            : command === 'contract-return'
              ? { contractId: 'c-2' }
              : command === 'contract-handover'
                ? { contractId: 'c-9' }
                : {},
      }),
    ),
  };
  const contracts = {
    byCode: jest.fn().mockResolvedValue({ id: 'c-2', version: 7 }),
    demoDetail: jest.fn().mockResolvedValue({ id: 'c-2', version: 8 }),
    // RC-2026-0002 running for ORG-0001, the contract MF-05 ends unless a test says otherwise.
    panelOptions: jest
      .fn()
      .mockResolvedValue([
        { id: 'c-2', code: 'RC-2026-0002', status: 'ACTIVE', version: 7, organizationId: 'org-1' },
      ]),
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
  const fieldEvents = { realNodeDevices: jest.fn().mockResolvedValue(new Set<string>()) };
  const lock = new DemoPanelLock();
  const playback = new DemoPanelPlayback(
    panel as never,
    contracts as never,
    devices as never,
    incidents as never,
    organizations as never,
    lock,
    fieldEvents as never,
  );
  return { playback, panel, contracts, lock, organizations, fieldEvents };
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

  // MF-05 resolves the contract at run time (AWS staging run: RC-2026-0002 was already CLOSED there).
  describe('the contract MF-05 ends (D-110 rule 6)', () => {
    const runMf05 = async (playback: DemoPanelPlayback) => {
      await playback.command({ command: 'START', flow: 'MF-05', intervalSeconds: 10 }, 'ip');
      await jest.advanceTimersByTimeAsync(0);
      await flush();
    };
    const row = (id: string, status: string, organizationId = 'org-1', version = 3) => ({
      id,
      code: id,
      status,
      version,
      organizationId,
    });

    it('ends the contract the last MF-01c run handed over while it is still ACTIVE', async () => {
      const { playback, panel, contracts } = build();
      contracts.panelOptions.mockResolvedValue([
        row('c-new', 'ACTIVE'),
        row('c-9', 'APPROVED', 'org-1', 4),
        row('c-2', 'ACTIVE'),
      ]);
      await playback.command({ command: 'START', flow: 'MF-01c' }, 'ip');
      await jest.advanceTimersByTimeAsync(0);
      await flush();
      expect(playback.view().status).toBe('DONE');
      contracts.panelOptions.mockResolvedValue([
        row('c-new', 'ACTIVE'),
        row('c-9', 'ACTIVE', 'org-1', 5),
        row('c-2', 'ACTIVE'),
      ]);
      await runMf05(playback);
      expect(panel.run).toHaveBeenLastCalledWith(
        'contract-return',
        { recordId: 'c-9', expectedVersion: 5 },
        'ip',
      );
    });

    it('else ends the newest ACTIVE ORG-0001 contract, never one of another organization or not ACTIVE', async () => {
      const { playback, panel, contracts } = build();
      contracts.panelOptions.mockResolvedValue([
        row('c-other', 'ACTIVE', 'org-2'),
        row('c-closed', 'RETURNED'),
        row('c-newest', 'ACTIVE', 'org-1', 6),
        row('c-2', 'ACTIVE'),
      ]);
      await runMf05(playback);
      expect(panel.run).toHaveBeenLastCalledWith(
        'contract-return',
        { recordId: 'c-newest', expectedVersion: 6 },
        'ip',
      );
    });

    it('skips a contract holding a unit heard from a real node in the last 7 days (RC-2026-0006)', async () => {
      const { playback, panel, contracts, fieldEvents } = build();
      contracts.panelOptions.mockResolvedValue([
        row('c-6', 'ACTIVE', 'org-1', 9),
        row('c-2', 'ACTIVE', 'org-1', 7),
      ]);
      contracts.visibleDevices.mockResolvedValue([
        { deviceId: 'd-real', contractId: 'c-6' },
        { deviceId: 'd-sim', contractId: 'c-2' },
      ]);
      fieldEvents.realNodeDevices.mockResolvedValue(new Set(['d-real']));
      const before = Date.now();
      await runMf05(playback);
      expect(contracts.visibleDevices).toHaveBeenCalledWith({ organizationId: null });
      const [deviceIds, since] = fieldEvents.realNodeDevices.mock.calls[0] as [string[], Date];
      expect(deviceIds).toEqual(['d-real', 'd-sim']);
      expect(before - since.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
      expect(panel.run).toHaveBeenLastCalledWith(
        'contract-return',
        { recordId: 'c-2', expectedVersion: 7 },
        'ip',
      );
    });

    it('fails with a clear message when no contract is running', async () => {
      const { playback, panel, contracts, fieldEvents } = build();
      contracts.panelOptions.mockResolvedValue([row('c-6', 'ACTIVE'), row('c-2', 'CLOSED')]);
      contracts.visibleDevices.mockResolvedValue([{ deviceId: 'd-real', contractId: 'c-6' }]);
      fieldEvents.realNodeDevices.mockResolvedValue(new Set(['d-real']));
      await runMf05(playback);
      expect(playback.view()).toMatchObject({
        status: 'FAILED',
        error:
          'Term ends and units come back: No running contract to end; run MF-01b and MF-01c first.',
      });
      expect(panel.run).not.toHaveBeenCalled();
    });
  });

  // Review of treklink-web#545: Pause while a step's panel command runs answers busy, like Resume and
  // Next step, and leaves the run RUNNING.
  it('answers busy to Pause while a step executes', async () => {
    const { playback, panel } = build();
    let finishStep: (result: PanelResult) => void = () => undefined;
    panel.run.mockReturnValueOnce(new Promise((resolve) => (finishStep = resolve)));
    await playback.command({ command: 'START', flow: 'MF-03', intervalSeconds: 5 }, 'ip');
    await jest.advanceTimersByTimeAsync(0);
    await flush();
    expect(panel.run).toHaveBeenCalledTimes(1);
    await expect(playback.command({ command: 'PAUSE' }, 'ip')).rejects.toMatchObject({
      errorCode: ErrorCode.DEMO_BUSY,
    });
    expect(playback.view().status).toBe('RUNNING');
    finishStep({
      action: 'incident-sos',
      runId: 1,
      label: 'Demo 1',
      actedAs: null,
      records: [],
      context: { incidentId: 'i-1' },
    });
    await flush();
    expect(playback.view()).toMatchObject({ status: 'RUNNING', index: 1 });
    await expect(playback.command({ command: 'PAUSE' }, 'ip')).resolves.toMatchObject({
      status: 'PAUSED',
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
    // The organization is still Pending, so the step is recorded skipped, never done.
    expect(resumed.steps[2]).toMatchObject({ status: 'SKIPPED', prompt: null });
    expect(f.panel.run).toHaveBeenCalledTimes(2);
  });

  it('records the waiting step SKIPPED on Next step too, and stays paused after it', async () => {
    const f = build();
    await startMf01a(f);
    const stepped = await f.playback.command({ command: 'STEP' }, 'ip');
    expect(stepped.steps[2].status).toBe('SKIPPED');
    expect(stepped).toMatchObject({ status: 'DONE', index: 3 });
  });

  it('keeps DONE for an approval that really happened', async () => {
    const f = build();
    await startMf01a(f);
    f.organizations.activeDemoOptions.mockResolvedValue([{ id: 'org-9', code: 'ORG-0009' }]);
    await jest.advanceTimersByTimeAsync(PLAYBACK_WAIT_POLL_MS);
    await flush();
    expect(f.playback.view().steps[2].status).toBe('DONE');
  });

  // Review of treklink-web#542: the Admin approves and the operator presses Resume before the next 3 s
  // poll. The organization is read once more before the step is marked, so the approval reads DONE.
  it('reads the organization once more on Resume: DONE when it is Active, SKIPPED otherwise', async () => {
    const approved = build();
    await startMf01a(approved);
    approved.organizations.activeDemoOptions.mockClear();
    approved.organizations.activeDemoOptions.mockResolvedValue([{ id: 'org-9', code: 'ORG-0009' }]);
    const resumed = await approved.playback.command({ command: 'RESUME' }, 'ip');
    expect(approved.organizations.activeDemoOptions).toHaveBeenCalledTimes(1);
    expect(resumed).toMatchObject({ status: 'DONE', index: 3 });
    expect(resumed.steps[2]).toMatchObject({ status: 'DONE', prompt: null });

    const pending = build();
    await startMf01a(pending);
    pending.organizations.activeDemoOptions.mockClear();
    const skipped = await pending.playback.command({ command: 'RESUME' }, 'ip');
    expect(pending.organizations.activeDemoOptions).toHaveBeenCalledTimes(1);
    expect(skipped.steps[2]).toMatchObject({ status: 'SKIPPED', prompt: null });
  });

  it('reads the organization once more on Next step: DONE when it is Active, SKIPPED otherwise', async () => {
    const approved = build();
    await startMf01a(approved);
    approved.organizations.activeDemoOptions.mockResolvedValue([{ id: 'org-9', code: 'ORG-0009' }]);
    const done = await approved.playback.command({ command: 'STEP' }, 'ip');
    expect(done.steps[2].status).toBe('DONE');
    expect(done).toMatchObject({ status: 'DONE', index: 3 });

    const pending = build();
    await startMf01a(pending);
    const skipped = await pending.playback.command({ command: 'STEP' }, 'ip');
    expect(skipped.steps[2].status).toBe('SKIPPED');
  });

  it('answers busy while that read runs, and does not move past the step when Stop comes during it', async () => {
    const f = build();
    await startMf01a(f);
    let finishRead: (rows: { id: string; code: string }[]) => void = () => undefined;
    f.organizations.activeDemoOptions.mockReturnValueOnce(
      new Promise((resolve) => (finishRead = resolve)),
    );
    const stepping = f.playback.command({ command: 'STEP' }, 'ip');
    await flush();
    await expect(f.playback.command({ command: 'STEP' }, 'ip')).rejects.toMatchObject({
      errorCode: ErrorCode.DEMO_BUSY,
    });
    await f.playback.command({ command: 'STOP' }, 'ip');
    finishRead([{ id: 'org-9', code: 'ORG-0009' }]);
    const view = await stepping;
    expect(view).toMatchObject({ status: 'STOPPED', index: 2 });
    expect(view.steps[2]).toMatchObject({ status: 'DONE', prompt: null });
  });

  // Review of treklink-web#541: Stop at the wait, START MF-01a again, then the first run's read returns
  // Active. Without the run check, that stale read finished the new run's wait with ORG-0010 never approved.
  it('drops a wait read that outlives its run (Stop, then START again)', async () => {
    const f = build();
    await startMf01a(f);
    let finishOldRead: (rows: { id: string; code: string }[]) => void = () => undefined;
    f.organizations.activeDemoOptions.mockReturnValueOnce(
      new Promise((resolve) => (finishOldRead = resolve)),
    );
    await jest.advanceTimersByTimeAsync(PLAYBACK_WAIT_POLL_MS); // the first run's poll is now mid-read
    await f.playback.command({ command: 'STOP' }, 'ip');
    f.panel.run
      .mockResolvedValueOnce({
        action: 'organization-register',
        runId: 3,
        label: 'Demo 3',
        actedAs: null,
        records: [],
        context: { organizationId: 'org-10', organizationCode: 'ORG-0010', version: 0 },
      })
      .mockResolvedValueOnce({
        action: 'organization-verify',
        runId: 4,
        label: 'Demo 4',
        actedAs: null,
        records: [],
        context: { organizationId: 'org-10', version: 1 },
      });
    await f.playback.command({ command: 'START', flow: 'MF-01a', intervalSeconds: 3 }, 'ip');
    await jest.advanceTimersByTimeAsync(7_000);
    await flush();
    expect(f.playback.view().steps[2].status).toBe('WAITING');
    // The old read now says ORG-0009 is Active.
    finishOldRead([{ id: 'org-9', code: 'ORG-0009' }]);
    await flush();
    const view = f.playback.view();
    expect(view).toMatchObject({ status: 'PAUSED', index: 2 });
    expect(view.steps[2]).toMatchObject({ status: 'WAITING' });
    expect(view.steps[2].prompt).toContain('ORG-0010');
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
