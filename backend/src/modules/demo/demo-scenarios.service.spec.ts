import { DomainException } from '../../common/errors';
import { DemoScenariosService, sosUplink } from './demo-scenarios.service';

const NOW = new Date('2026-11-01T03:30:20.000Z'); // 10:30:20 in UTC+7
const user = (id: string, roles: string[], organizationId: string | null = null) => ({
  id,
  email: `${id}@treklink.local`,
  fullName: id,
  accountType: organizationId ? 'ORGANIZATION' : 'TREKLINK',
  roles,
  organization: organizationId ? { id: organizationId, memberRole: 'MANAGER' } : null,
});
const ACCOUNTS: Record<string, ReturnType<typeof user>> = {
  'admin@treklink.local': user('admin', ['ADMIN']),
  'staff@treklink.local': user('staff', ['STAFF']),
  'manager@treklink.local': user('manager', ['ORG_MANAGER'], 'org-1'),
  'operator@treklink.local': user('operator', ['ORG_OPERATOR'], 'org-1'),
};
const CLIENT = { ip: '127.0.0.1', userAgent: 'jest' };

const build = () => {
  const order: string[] = [];
  const track =
    (name: string, value?: unknown) =>
    (...args: unknown[]) => {
      order.push(name);
      return Promise.resolve(
        typeof value === 'function' ? (value as (...a: unknown[]) => unknown)(...args) : value,
      );
    };
  const deps = {
    guard: {
      run: jest.fn((work: () => Promise<unknown>) => work()),
      facts: jest.fn(() => ({ enabled: true, databaseLocal: true })),
    },
    reset: { reset: jest.fn(track('reset', { truncated: ['users'], kept: [] })) },
    seed: {
      passwords: jest.fn(() => {
        order.push('passwords');
        return { admin: 'a', staff: 's', manager: 'm', operator: 'o' };
      }),
      run: jest.fn(track('seed', ['user admin@treklink.local'])),
    },
    sessions: {
      accountOf: jest.fn((email: string) => Promise.resolve(ACCOUNTS[email])),
      switchTo: jest.fn(
        track('session', (email: string) => ({ accessToken: 'at', user: ACCOUNTS[email] })),
      ),
    },
    parameters: {
      get: jest.fn((key: string) =>
        Promise.resolve(key === 'gatewaySync.attributionMarginSeconds' ? 300 : 9),
      ),
    },
    events: {
      emitAfterCommit: jest.fn(),
      transaction: jest.fn((work: (tx: object) => Promise<unknown>) => work({ tx: true })),
    },
    onboarding: { register: jest.fn(track('register', { code: 'ORG-0002' })) },
    contracts: {
      byCode: jest.fn((code: string) =>
        Promise.resolve({ id: `id-${code}`, code, version: 3, status: 'ACTIVE' }),
      ),
      request: jest.fn(
        track('request', { contract: { id: 'c-4', code: 'RC-2026-0004', version: 1 } }),
      ),
      endOpenTermAt: jest.fn(track('endOpenTermAt')),
    },
    decisions: {
      approve: jest.fn(track('approve')),
      giveNotice: jest.fn(track('giveNotice')),
    },
    termRollover: { run: jest.fn(track('rollover', { renewed: 0, returnDue: 1, returned: 0 })) },
    invoices: {
      firstChargeableInvoice: jest.fn(
        track('invoice', {
          id: 'inv-1',
          lines: [
            { type: 'HOLDING_FEE', amountVnd: 1125000n, paidVnd: 0n },
            { type: 'TERM_BALANCE', amountVnd: 1125000n, paidVnd: 0n },
          ],
        }),
      ),
    },
    payments: { recordCounter: jest.fn(track('pay')) },
    devices: {
      variants: jest.fn().mockResolvedValue([{ id: 'v-3', code: 'treklink-v3' }]),
      byAssetTag: jest.fn((tag: string) =>
        Promise.resolve({ id: `d-${tag}`, assetTag: tag, version: 2 }),
      ),
      scheduleService: jest.fn(track('scheduleService')),
    },
    maintenance: { open: jest.fn(track('maintenance')) },
    uplinks: { ingest: jest.fn(track('ingest', 'ingested')) },
    incidents: {
      openByDevices: jest.fn(() =>
        Promise.resolve(new Map([['d-TL-0010', { id: 'inc-2', code: 'INC-2026-000002' }]])),
      ),
    },
  };
  const service = new (
    DemoScenariosService as unknown as new (...args: unknown[]) => DemoScenariosService
  )(...Object.values(deps));
  return { service, deps, order };
};

describe('DemoScenariosService', () => {
  it('lists the seven scenarios without their steps, loss cases unavailable', () => {
    const { service } = build();
    const list = service.list();
    expect(list.map((s) => s.id)).toEqual([
      'clean',
      'org-pending-approval',
      'contract-ready-for-handover',
      'sos-open',
      'term-ended',
      'asset-maintenance',
      'loss-cases',
    ]);
    expect(list.find((s) => s.id === 'loss-cases')).toMatchObject({
      available: false,
      unavailableReason: 'Needs the loss cases change (treklink-web#228).',
    });
    expect(list[0]).not.toHaveProperty('firstSteps');
  });

  it('stages clean: passwords, reset, seed dated margin plus a minute back, Admin session, audit', async () => {
    const { service, deps, order } = build();
    const result = await service.stage('clean', CLIENT, NOW);
    expect(order).toEqual(['passwords', 'reset', 'seed', 'session']);
    expect(deps.seed.run.mock.calls[0][1]).toEqual(new Date(NOW.getTime() - 360_000));
    expect(deps.sessions.switchTo).toHaveBeenCalledWith('admin@treklink.local', CLIENT);
    expect(result.records.map((r) => r.path)).toEqual([
      '/t/contracts/id-RC-2026-0001',
      '/t/contracts/id-RC-2026-0002',
      '/t/contracts/id-RC-2026-0003',
    ]);
    expect(result.firstSteps.length).toBeGreaterThan(1);
    expect(deps.events.emitAfterCommit).toHaveBeenCalledWith('audit.record', {
      actorId: 'admin',
      actorRoles: ['ADMIN'],
      organizationId: null,
      action: 'demo.stage',
      subjectType: 'DemoScenario',
      subjectId: 'clean',
      after: { records: result.records },
    });
    expect(service.status().lastStaged).toEqual({ scenarioId: 'clean', at: NOW });
  });

  it('refuses an unknown scenario with 404 and an unavailable one with 409, before any reset', async () => {
    const { service, deps } = build();
    await expect(service.stage('nope', CLIENT, NOW)).rejects.toMatchObject({ status: 404 });
    const refusal = await service.stage('loss-cases', CLIENT, NOW).catch((e: DomainException) => e);
    expect((refusal as DomainException).getResponse()).toMatchObject({
      errorCode: 'DEMO_SCENARIO_UNAVAILABLE',
    });
    expect(deps.reset.reset).not.toHaveBeenCalled();
  });

  it('stages through the guard, so a guard refusal changes nothing', async () => {
    const { service, deps } = build();
    deps.guard.run.mockRejectedValueOnce(new Error('DEMO_DATABASE_NOT_LOCAL'));
    await expect(service.stage('clean', CLIENT, NOW)).rejects.toThrow('DEMO_DATABASE_NOT_LOCAL');
    expect(deps.reset.reset).not.toHaveBeenCalled();
    expect(deps.seed.run).not.toHaveBeenCalled();
  });

  it('org-pending-approval registers ORG-0002 through onboarding', async () => {
    const { service, deps } = build();
    const result = await service.stage('org-pending-approval', CLIENT, NOW);
    expect(deps.onboarding.register).toHaveBeenCalledWith(
      expect.objectContaining({ taxCode: '0312345678', managerEmail: 'binh.manager@example.com' }),
    );
    expect(result.records).toEqual([
      { label: 'Organization, pending', code: 'ORG-0002', path: '/t/organizations' },
    ]);
  });

  it('contract-ready-for-handover requests as the Manager, approves as Staff, pays the holding fee', async () => {
    const { service, deps, order } = build();
    const result = await service.stage('contract-ready-for-handover', CLIENT, NOW);
    expect(order).toEqual([
      'passwords',
      'reset',
      'seed',
      'request',
      'approve',
      'invoice',
      'pay',
      'session',
    ]);
    expect(deps.contracts.request).toHaveBeenCalledWith(
      {
        planType: 'MONTHLY',
        hardwareVariantId: 'v-3',
        quantity: 5,
        requestedStartDate: new Date('2026-11-01T00:00:00.000Z'),
      },
      { id: 'manager', roles: ['ORG_MANAGER'], organizationId: 'org-1' },
      NOW,
    );
    expect(deps.decisions.approve).toHaveBeenCalledWith(
      'c-4',
      { handoverAt: new Date('2026-11-01T03:31:00.000Z'), expectedVersion: 1 },
      { id: 'staff', roles: ['STAFF'], organizationId: null },
      NOW,
    );
    expect(deps.payments.recordCounter).toHaveBeenCalledWith(
      'inv-1',
      { method: 'CASH', amountVnd: 1125000n, reference: 'DEMO-RC-2026-0004-HOLD' },
      { id: 'staff', roles: ['STAFF'], organizationId: null },
      NOW,
    );
    expect(result.records).toContainEqual({
      label: 'Counter handover',
      code: 'RC-2026-0004',
      path: '/t/counter/c-4',
    });
  });

  it('sos-open ingests the sos fixture with a fresh id and the time now, and links the incident', async () => {
    const { service, deps } = build();
    const result = await service.stage('sos-open', CLIENT, NOW);
    const [topic, body, at] = deps.uplinks.ingest.mock.calls[0] as [string, Buffer, Date];
    expect(topic).toBe('treklink/2/json/LongFast/!de00000a');
    expect(at).toBe(NOW);
    const message = JSON.parse(body.toString()) as {
      timestamp: number;
      id: number;
      payload: object;
    };
    expect(message.timestamp).toBe(NOW.getTime() / 1000);
    expect(message.id).not.toBe(2201000001);
    expect(result.records).toEqual([
      { label: 'Incident, TL-0010', code: 'INC-2026-000002', path: '/o/incidents/inc-2' },
    ]);
  });

  it('term-ended gives notice as the Manager, moves the term end to the cutoff and runs the rollover', async () => {
    const { service, deps, order } = build();
    await service.stage('term-ended', CLIENT, NOW);
    expect(order).toEqual([
      'passwords',
      'reset',
      'seed',
      'giveNotice',
      'endOpenTermAt',
      'rollover',
      'session',
    ]);
    expect(deps.decisions.giveNotice).toHaveBeenCalledWith(
      'id-RC-2026-0002',
      3,
      { id: 'manager', roles: ['ORG_MANAGER'], organizationId: 'org-1' },
      NOW,
    );
    // 09:00 UTC+7 today is 02:00Z; the term ends a minute before it.
    expect(deps.contracts.endOpenTermAt).toHaveBeenCalledWith(
      'id-RC-2026-0002',
      new Date('2026-11-01T01:59:00.000Z'),
    );
    expect(deps.termRollover.run).toHaveBeenCalledWith(NOW);
  });

  it('term-ended fails loudly when the rollover moves nothing to RETURN_DUE', async () => {
    const { service, deps } = build();
    deps.termRollover.run.mockResolvedValueOnce({ renewed: 1, returnDue: 0, returned: 0 });
    await expect(service.stage('term-ended', CLIENT, NOW)).rejects.toThrow(/RETURN_DUE/);
  });

  it('asset-maintenance opens a record on TL-0007 as Staff and makes TL-0002 due tomorrow', async () => {
    const { service, deps } = build();
    await service.stage('asset-maintenance', CLIENT, NOW);
    expect(deps.maintenance.open).toHaveBeenCalledWith(
      'd-TL-0007',
      expect.objectContaining({
        reason: 'STAFF_REPORTED',
        expectedAt: '2026-11-04',
        expectedVersion: 2,
      }),
      'staff',
      NOW,
      { tx: true },
    );
    expect(deps.devices.scheduleService).toHaveBeenCalledWith(
      'd-TL-0002',
      new Date('2026-11-02T00:00:00.000Z'),
    );
  });

  it('switches role through the guard to the seeded email', async () => {
    const { service, deps } = build();
    await service.switchRole('ORG_OPERATOR', CLIENT);
    expect(deps.guard.run).toHaveBeenCalled();
    expect(deps.sessions.switchTo).toHaveBeenCalledWith('operator@treklink.local', CLIENT);
  });

  it('builds the SOS uplink from the fixture', () => {
    const { topic, body } = sosUplink(NOW, 42);
    expect(topic).toBe('treklink/2/json/LongFast/!de00000a');
    expect(JSON.parse(body.toString())).toMatchObject({
      id: 42,
      from: 3724541962,
      type: 'text',
      payload: { text: 'SOS - [11.561000], [108.552000]' },
    });
  });
});
