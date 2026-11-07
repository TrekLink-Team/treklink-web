/* eslint-disable @typescript-eslint/require-await -- Promise-shaped service test doubles. */
import { DomainException, ErrorCode } from '../../common/errors';
import { BadRequestException, HttpStatus } from '@nestjs/common';
import { DemoQuickService, QuickInput } from './demo-quick.service';

const actor = { id: 'actual-admin', roles: ['ADMIN'], organizationId: null };
const now = new Date('2026-11-07T08:00:00Z');
const row = {
  id: 'contract',
  code: 'RC-FRESH',
  version: 1,
  status: 'ACTIVE',
  planType: 'MONTHLY',
  organizationId: 'org',
  devices: [{ deviceId: 'unit' }],
};
function fixture() {
  let counter = 0;
  const guard = { assert: jest.fn() };
  const repository = {
    createRun: jest.fn(async () => ({ id: ++counter })),
    saveRun: jest.fn(async () => undefined),
  };
  const profile = {
    status: jest.fn(async () => ({ active: false, version: 0 })),
    change: jest.fn(async () => undefined),
  };
  const events = {
    transaction: jest.fn(async (work: (tx: object) => Promise<unknown>) => work({})),
    emitAfterCommit: jest.fn(),
  };
  const parameters = {
    get: jest.fn(
      async (key: string) =>
        ({
          'rentals.minOrderQuantity': 5,
          'devices.handoverMinBatteryPct': 60,
          'gatewaySync.attributionMarginSeconds': 60,
          'rentals.termRolloverHourLocal': 0,
        })[key],
    ),
  };
  const onboarding = { register: jest.fn(async () => ({ id: 'org-new', code: 'ORG-FRESH' })) };
  const organizations = {
    activeDemoOptions: jest.fn(async () => [{ id: 'org', code: 'ORG-1', legalName: 'Demo tours' }]),
    membersOf: jest.fn(async () => [
      { role: 'MANAGER', invitationPending: false, deactivatedAt: null, userId: 'manager' },
    ]),
    channelKeyState: jest.fn(async () => ({ channelKeyVersion: 1 })),
  };
  const custody = {
    deviceId: 'unit',
    contractId: 'contract',
    contractCode: 'RC-FRESH',
    handedOverAt: new Date(now.getTime() - 3600000),
    organizationId: 'org',
  };
  const contracts = {
    visibleDevices: jest.fn(async () => [custody]),
    demoDetail: jest.fn(async () => row),
    request: jest.fn(async () => ({ contract: { ...row, status: 'REQUESTED' } })),
    endOpenTermAt: jest.fn(async () => undefined),
  };
  const decisions = {
    approve: jest.fn(async () => ({ contract: { ...row, status: 'APPROVED', version: 2 } })),
    giveNotice: jest.fn(async () => ({ contract: { ...row, status: 'ENDING', version: 3 } })),
  };
  const handover = {
    provision: jest.fn(async () => undefined),
    complete: jest.fn(async () => ({ ...row, version: 3 })),
  };
  const rollover = { run: jest.fn(async () => ({ returnDue: 1 })) };
  const invoices = {
    firstChargeableInvoice: jest.fn(async () => ({
      id: 'invoice',
      lines: [{ amountVnd: 100n, paidVnd: 10n }],
    })),
  };
  const payments = { recordCounter: jest.fn(async () => undefined) };
  const device = { id: 'unit', assetTag: 'TL-DEMO', status: 'RENTED', nodeNum: 3724541962n };
  const devices = {
    projections: jest.fn(async () => [device]),
    variants: jest.fn(async () => [{ id: 'variant', code: 'v3', isActive: true }]),
  };
  const uplinks = { ingest: jest.fn(async () => 'ingested') };
  const incidents = {
    demoOptions: jest.fn(async () => []),
    openByDevices: jest
      .fn()
      .mockResolvedValueOnce(new Map())
      .mockResolvedValue(new Map([['unit', { id: 'incident', code: 'INC-FRESH' }]])),
  };
  const timers = {
    advanceDemo: jest.fn(async () => ({
      id: 'incident',
      code: 'INC-FRESH',
      state: 'NOTIFY_MANAGER',
    })),
  };
  const losses = { report: jest.fn(async () => ({ id: 'loss', code: 'LOSS-FRESH' })) };
  const faults = { report: jest.fn(async () => undefined) };
  const simulation = {
    refreshWalkers: jest.fn(async () => [{ deviceId: 'unit', assetTag: 'TL-DEMO' }]),
  };
  const args = [
    guard,
    repository,
    profile,
    events,
    parameters,
    onboarding,
    organizations,
    contracts,
    decisions,
    handover,
    rollover,
    invoices,
    payments,
    devices,
    uplinks,
    incidents,
    timers,
    losses,
    faults,
    simulation,
  ] as unknown as ConstructorParameters<typeof DemoQuickService>;
  return {
    service: new DemoQuickService(...args),
    guard,
    repository,
    profile,
    events,
    parameters,
    onboarding,
    organizations,
    contracts,
    decisions,
    handover,
    rollover,
    invoices,
    payments,
    devices,
    uplinks,
    incidents,
    timers,
    losses,
    faults,
    simulation,
  };
}
const input: QuickInput = {
  organizationId: 'org',
  hardwareVariantId: 'variant',
  quantity: 5,
  target: 'APPROVED',
};

describe('DemoQuickService scenarios', () => {
  it('creates fresh Demo names, tax codes and emails without resetting and audits the actual actor', async () => {
    const f = fixture();
    const a = await f.service.run('organization', {}, actor);
    const b = await f.service.run('organization', {}, actor);
    expect(a.runId).not.toBe(b.runId);
    expect(a.records[0].path).toBe('/t/organizations/org-new');
    expect(f.onboarding.register).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        legalName: 'TrekLink Demo 1 Tours',
        taxCode: '9000000001',
        managerEmail: 'demo.1@example.com',
      }),
    );
    expect(f.onboarding.register).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ taxCode: '9000000002' }),
    );
    expect(f.events.emitAfterCommit).toHaveBeenCalledWith(
      'audit.record',
      expect.objectContaining({ actorId: actor.id, action: 'demo.quick.organization' }),
    );
  });
  it.each(['REQUESTED', 'APPROVED', 'ACTIVE', 'RETURN_DUE'] as const)(
    'uses real contract steps for %s',
    async (target) => {
      const f = fixture();
      if (target === 'RETURN_DUE')
        f.contracts.demoDetail.mockResolvedValueOnce(row).mockResolvedValue({ ...row, version: 3 });
      const result = await f.service.run('contract', { ...input, target }, actor, now);
      expect(result.error).toBeNull();
      expect(result.records).toHaveLength(2);
      expect(f.contracts.request).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 5 }),
        { ...actor, organizationId: 'org' },
        expect.any(Date),
      );
      expect(f.decisions.approve).toHaveBeenCalledTimes(target === 'REQUESTED' ? 0 : 1);
      expect(f.handover.complete).toHaveBeenCalledTimes(
        ['ACTIVE', 'RETURN_DUE'].includes(target) ? 1 : 0,
      );
      if (target !== 'REQUESTED')
        expect(f.payments.recordCounter).toHaveBeenCalledWith(
          'invoice',
          expect.objectContaining({ amountVnd: 90n }),
          actor,
          expect.any(Date),
        );
      if (target === 'RETURN_DUE') expect(f.rollover.run).toHaveBeenCalledWith(now, 'contract');
    },
  );
  it.each(['REQUESTED', 'APPROVED'] as const)(
    'does not impose a handover signer on %s',
    async (target) => {
      const f = fixture();
      f.organizations.membersOf.mockResolvedValue([]);
      expect((await f.service.run('contract', { ...input, target }, actor, now)).error).toBeNull();
      expect(f.organizations.membersOf).not.toHaveBeenCalled();
    },
  );

  it('permits a live Manager who has not activated a password, as the real handover service does', async () => {
    const f = fixture();
    f.organizations.membersOf.mockResolvedValue([
      { role: 'MANAGER', invitationPending: true, deactivatedAt: null, userId: 'manager' },
    ]);
    expect(
      (await f.service.run('contract', { ...input, target: 'ACTIVE' }, actor, now)).error,
    ).toBeNull();
    expect(f.handover.complete).toHaveBeenCalledWith(
      'contract',
      expect.objectContaining({ signedByUserId: 'manager' }),
      actor,
      expect.any(Date),
    );
  });

  it('retains committed contract links on approval failure and records its cause', async () => {
    const f = fixture();
    f.decisions.approve.mockRejectedValueOnce(
      new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.INSUFFICIENT_DEVICES,
        'Not enough available units.',
      ),
    );
    await expect(f.service.run('contract', input, actor)).rejects.toMatchObject({
      httpStatus: 409,
      errorCode: 'INSUFFICIENT_DEVICES',
      message: 'Not enough available units.',
      resultDetails: {
        runId: 1,
        label: 'Demo 1',
        records: [
          { label: 'Demo contract', code: 'RC-FRESH', path: '/t/contracts/contract' },
          { label: 'Counter and invoices', code: 'RC-FRESH', path: '/t/counter/contract' },
        ],
      },
    });
    expect(f.repository.saveRun).toHaveBeenCalled();
    expect(f.events.emitAfterCommit.mock.calls).toMatchObject([
      ['audit.record', { actorId: actor.id, after: { errorCode: 'INSUFFICIENT_DEVICES' } }],
    ]);
  });
  it('rejects an incomplete action before allocating a counter', async () => {
    const f = fixture();
    await expect(f.service.run('contract', {}, actor)).rejects.toMatchObject({
      errorCode: 'VALIDATION_FAILED',
    });
    expect(f.repository.createRun).not.toHaveBeenCalled();
  });
  it('refuses a non-Admin before reading or writing', async () => {
    const f = fixture();
    f.guard.assert.mockImplementation(() => {
      throw new Error('403');
    });
    await expect(f.service.run('organization', {}, actor)).rejects.toThrow('403');
    expect(f.repository.createRun).not.toHaveBeenCalled();
    await expect(f.service.options(actor)).rejects.toThrow('403');
    expect(f.devices.variants).not.toHaveBeenCalled();
  });
  it('ingests a selected rented node SOS as simulated and returns the real incident', async () => {
    const f = fixture();
    const result = await f.service.run('incident', { deviceId: 'unit' }, actor, now);
    expect(result.error).toBeNull();
    expect(result.records[0].path).toBe('/t/incidents/incident');
    expect(f.uplinks.ingest).toHaveBeenCalledWith(
      expect.stringContaining('!de00000a'),
      expect.any(Buffer),
      now,
      { simulated: true },
    );
  });
  it('refuses duplicate SOS and a unit without custody before ingest', async () => {
    const f = fixture();
    f.incidents.openByDevices
      .mockReset()
      .mockResolvedValue(new Map([['unit', { id: 'existing' }]]));
    await expect(f.service.run('incident', { deviceId: 'unit' }, actor, now)).rejects.toMatchObject(
      { httpStatus: 409, errorCode: 'DEMO_SCENARIO_UNAVAILABLE' },
    );
    expect(f.uplinks.ingest).not.toHaveBeenCalled();
    f.contracts.visibleDevices.mockResolvedValueOnce([]);
    await expect(f.service.run('loss', { deviceId: 'unit' }, actor)).rejects.toMatchObject({
      httpStatus: 409,
      errorCode: 'DEMO_SCENARIO_UNAVAILABLE',
    });
    expect(f.losses.report).not.toHaveBeenCalled();
  });
  it.each(['loss', 'fault'] as const)(
    'calls real %s reporting on the chosen custody',
    async (action) => {
      const f = fixture();
      const result = await f.service.run(action, { deviceId: 'unit' }, actor, now);
      expect(result.error).toBeNull();
      expect(action === 'loss' ? f.losses.report : f.faults.report).toHaveBeenCalled();
      expect(result.records).toHaveLength(1);
    },
  );
  it('refreshes simulated walkers through their owner', async () => {
    const f = fixture();
    expect((await f.service.run('walkers', {}, actor, now)).error).toBeNull();
    expect(f.simulation.refreshWalkers).toHaveBeenCalledWith(actor, now);
  });
  it.each(['profile', 'term-end', 'next-tier'] as const)(
    'checks and forwards versions for %s',
    async (action) => {
      const f = fixture();
      const result = await f.service.run(
        action,
        { recordId: 'contract', expectedVersion: 1, active: true },
        actor,
        now,
      );
      expect(result.error).toBeNull();
      if (action === 'profile') expect(f.profile.change).toHaveBeenCalledWith(true, 1, actor);
      if (action === 'next-tier')
        expect(f.timers.advanceDemo).toHaveBeenCalledWith('contract', 1, actor, now);
      if (action === 'term-end') expect(f.rollover.run).toHaveBeenCalledWith(now, 'contract');
    },
  );
  it('advances a day-plan contract without giving monthly notice', async () => {
    const f = fixture();
    f.contracts.demoDetail.mockResolvedValue({ ...row, planType: 'DAY' });
    const result = await f.service.run(
      'term-end',
      { recordId: 'contract', expectedVersion: 1 },
      actor,
      now,
    );
    expect(result.error).toBeNull();
    expect(f.decisions.giveNotice).not.toHaveBeenCalled();
    expect(f.contracts.endOpenTermAt).toHaveBeenCalledWith('contract', expect.any(Date), 1);
  });

  it('does not shift a stale contract', async () => {
    const f = fixture();
    await expect(
      f.service.run('term-end', { recordId: 'contract', expectedVersion: 0 }, actor, now),
    ).rejects.toMatchObject({
      httpStatus: 409,
      errorCode: 'STALE_VERSION',
      resultDetails: { runId: 1, records: [] },
    });
    expect(f.contracts.endOpenTermAt).not.toHaveBeenCalled();
  });
  it.each([
    [
      new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Organization not found.'),
      404,
      'NOT_FOUND',
    ],
    [new BadRequestException('Choose an organization.'), 400, 'VALIDATION_FAILED'],
    [new Error('Unexpected service failure'), 500, 'INTERNAL_ERROR'],
  ] as const)(
    'keeps the correct status/code for a failed service: %s',
    async (cause, status, errorCode) => {
      const f = fixture();
      f.onboarding.register.mockRejectedValueOnce(cause);
      await expect(f.service.run('organization', {}, actor)).rejects.toMatchObject({
        httpStatus: status,
        errorCode,
        resultDetails: { runId: 1, label: 'Demo 1', records: [] },
      });
      expect(f.events.emitAfterCommit).toHaveBeenCalled();
    },
  );

  it('reads form choices through owning services', async () => {
    const f = fixture();
    const result = await f.service.options(actor);
    expect(result.minimumQuantity).toBe(5);
    expect(result.units[0].nodeNum).toBe(3724541962);
    expect(result.contracts[0].version).toBe(1);
  });
});
