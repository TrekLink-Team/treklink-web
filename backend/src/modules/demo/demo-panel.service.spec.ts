import { ConfigService } from '@nestjs/config';
import { DomainException, ErrorCode } from '../../common/errors';
import { DemoPanelLock } from './demo-panel-lock';
import { PANEL_ACTIONS } from './demo-panel-actions';
import { DemoPanelService, PLAYBACK_COMMANDS } from './demo-panel.service';
import { SEEDED_EMAILS } from './demo-scenarios';

const NOW = new Date('2026-11-24T03:00:30Z');
const ORG = 'org-1';
const LOCAL = 'postgresql://u:p@localhost:5432/treklink';
const tx = { tx: true };

const STAFF = {
  id: 'u-staff',
  email: 'treklink.dev+staff@gmail.com',
  roles: ['STAFF'],
  organization: null,
};
const ADMIN = {
  id: 'u-admin',
  email: 'treklink.dev+admin@gmail.com',
  roles: ['ADMIN'],
  organization: null,
};
const MEMBERS = [
  {
    userId: 'u-manager',
    email: 'treklink.dev+manager@gmail.com',
    role: 'MANAGER',
    deactivatedAt: null,
    invitationPending: false,
  },
  {
    userId: 'u-operator',
    email: 'treklink.dev+operator@gmail.com',
    role: 'OPERATOR',
    deactivatedAt: null,
    invitationPending: false,
  },
  {
    userId: 'u-gone',
    email: 'gone@example.com',
    role: 'OPERATOR',
    deactivatedAt: new Date(),
    invitationPending: false,
  },
];
const CONTRACT = {
  id: 'c-1',
  code: 'RC-2026-0004',
  status: 'APPROVED',
  planType: 'MONTHLY',
  organizationId: ORG,
  version: 3,
  devices: [
    { deviceId: 'd-1', handedOverAt: null, checkedInAt: null, lostAt: null },
    { deviceId: 'd-2', handedOverAt: null, checkedInAt: null, lostAt: null },
  ],
};

const build = (env: Record<string, unknown> = {}) => {
  const config = {
    get: (key: string) => ({ DATABASE_URL: LOCAL, DATABASE_DIRECT_URL: LOCAL, ...env })[key],
  } as unknown as ConfigService<never, true>;
  const events = {
    transaction: jest.fn((work: (t: object) => Promise<unknown>) => work(tx)),
    emitAfterCommit: jest.fn<void, [string, Record<string, unknown>]>(),
  };
  const parameters = {
    get: jest.fn((key: string) =>
      Promise.resolve(
        (
          { 'rentals.minOrderQuantity': 5, 'devices.handoverMinBatteryPct': 50 } as Record<
            string,
            number
          >
        )[key],
      ),
    ),
  };
  const runs = {
    createRun: jest.fn().mockResolvedValue({ id: 41 }),
    saveRun: jest.fn().mockResolvedValue(undefined),
  };
  const sessions = {
    panelAccountOf: jest.fn((email: string) =>
      Promise.resolve(email.includes('staff') ? STAFF : email.includes('admin') ? ADMIN : null),
    ),
  };
  const organizations = {
    membersOf: jest.fn().mockResolvedValue(MEMBERS),
    activeDemoOptions: jest.fn().mockResolvedValue([
      { id: 'org-2', code: 'ORG-0002', legalName: 'B' },
      { id: ORG, code: 'ORG-0001', legalName: 'A' },
    ]),
    channelKeyState: jest.fn().mockResolvedValue({ channelKeyVersion: 2 }),
  };
  const onboarding = {
    register: jest.fn().mockResolvedValue({ id: 'org-9', code: 'ORG-0009', version: 0 }),
    verify: jest.fn().mockResolvedValue({ id: 'org-9', code: 'ORG-0009', version: 1 }),
    approve: jest.fn().mockResolvedValue({ id: 'org-9', code: 'ORG-0009', version: 2 }),
  };
  const contracts = {
    demoDetail: jest.fn().mockResolvedValue(CONTRACT),
    request: jest
      .fn()
      .mockResolvedValue({ contract: { id: 'c-new', code: 'RC-2026-0005', version: 0 } }),
    visibleDevices: jest.fn().mockResolvedValue([{ deviceId: 'd-9', contractId: 'c-0' }]),
    panelOptions: jest.fn().mockResolvedValue([]),
  };
  const decisions = {
    approve: jest
      .fn()
      .mockResolvedValue({ contract: { id: 'c-1', code: 'RC-2026-0004', version: 4 } }),
    giveNotice: jest.fn().mockResolvedValue({ contract: { version: 4 } }),
    endNow: jest.fn().mockResolvedValue({}),
    cancel: jest.fn().mockResolvedValue({}),
  };
  const handover = {
    provision: jest.fn().mockResolvedValue({}),
    complete: jest.fn().mockResolvedValue({ version: 5 }),
  };
  const returns = {
    checkIn: jest.fn().mockResolvedValue({}),
    inspect: jest.fn().mockResolvedValue({}),
    close: jest.fn().mockResolvedValue({}),
  };
  const invoices = {
    firstChargeableInvoice: jest.fn().mockResolvedValue({
      id: 'inv-1',
      lines: [
        { amountVnd: 1_125_000n, paidVnd: 0n },
        { amountVnd: 1_125_000n, paidVnd: 1_125_000n },
      ],
    }),
    panelOptions: jest.fn().mockResolvedValue([]),
  };
  const payments = { recordCounter: jest.fn().mockResolvedValue({}) };
  const devices = {
    projections: jest
      .fn()
      .mockResolvedValue([
        { id: 'd-9', assetTag: 'TL-0010', status: 'RENTED', nodeNum: 3724541962n },
      ]),
    panelOptions: jest.fn().mockResolvedValue([]),
    variants: jest.fn().mockResolvedValue([
      { id: 'v-2', code: 'treklink-v2', name: 'v2' },
      { id: 'v-3', code: 'treklink-v3', name: 'v3' },
    ]),
    assetTags: jest.fn().mockResolvedValue(
      new Map([
        ['d-1', 'TL-0003'],
        ['d-2', 'TL-0004'],
      ]),
    ),
    reset: jest.fn().mockResolvedValue({}),
  };
  const maintenance = {
    open: jest.fn().mockResolvedValue({ device: { assetTag: 'TL-0007' } }),
    openRecordOf: jest.fn().mockResolvedValue({ id: 'm-1', version: 2 }),
    complete: jest.fn().mockResolvedValue({}),
  };
  const uplinks = { ingest: jest.fn().mockResolvedValue({}) };
  const incident = {
    id: 'i-1',
    code: 'INC-2026-000002',
    state: 'NOTIFY_PRIMARY',
    version: 1,
    organizationId: ORG as string | null,
    ownerId: null as string | null,
  };
  const incidentReads = {
    panelRecord: jest.fn().mockResolvedValue(incident),
    panelOptions: jest.fn().mockResolvedValue([]),
    openByDevices: jest
      .fn()
      .mockResolvedValue(
        new Map([['d-9', { id: 'i-1', code: 'INC-2026-000002', organizationId: ORG }]]),
      ),
  };
  const moved = { id: 'i-1', code: 'INC-2026-000002', state: 'ACKNOWLEDGED', version: 2 };
  const incidents = {
    acknowledge: jest.fn().mockResolvedValue(moved),
    responding: jest.fn().mockResolvedValue({ ...moved, state: 'RESPONDING' }),
    resolve: jest.fn().mockResolvedValue({ ...moved, state: 'RESOLVED' }),
    falseAlarm: jest.fn().mockResolvedValue({ ...moved, state: 'FALSE_ALARM' }),
  };
  const timers = {
    closeDemo: jest.fn().mockResolvedValue({ id: 'i-1', code: 'INC-2026-000002', version: 9 }),
  };
  const lock = new DemoPanelLock();
  const service = new DemoPanelService(
    config,
    events as never,
    parameters as never,
    runs as never,
    sessions as never,
    organizations as never,
    onboarding as never,
    contracts as never,
    decisions as never,
    handover as never,
    returns as never,
    invoices as never,
    payments as never,
    devices as never,
    maintenance as never,
    uplinks as never,
    incidentReads as never,
    incidents as never,
    timers as never,
    lock,
  );
  return {
    service,
    sessions,
    lock,
    events,
    runs,
    organizations,
    onboarding,
    contracts,
    decisions,
    handover,
    returns,
    invoices,
    payments,
    devices,
    maintenance,
    uplinks,
    incident,
    incidentReads,
    incidents,
    timers,
  };
};

const audit = (f: ReturnType<typeof build>): Record<string, unknown> => {
  const calls = f.events.emitAfterCommit.mock.calls;
  return calls.find(([name]) => name === 'audit.record')?.[1] ?? {};
};

describe('DemoPanelService commands (REQ-PNL-03, REQ-PNL-04, REQ-PNL-07)', () => {
  it('reads an overview that serializes to JSON, money as a decimal string', async () => {
    const f = build();
    f.invoices.panelOptions.mockResolvedValueOnce([
      {
        id: 'inv-1',
        number: 'INV-1',
        contractId: 'c-1',
        organizationId: ORG,
        totalVnd: 900n,
        paidVnd: 100n,
      },
    ]);
    f.devices.panelOptions.mockResolvedValueOnce([
      { id: 'd-1', assetTag: 'TL-0001', status: 'AVAILABLE', version: 0, nodeNum: 3724541953n },
    ]);
    const overview = await f.service.overview();
    const parsed = JSON.parse(JSON.stringify(overview)) as typeof overview;
    expect(parsed.options.invoices).toEqual([
      { id: 'inv-1', number: 'INV-1', contractId: 'c-1', organizationId: ORG, dueVnd: '800' },
    ]);
    expect(parsed.options.devices[0].nodeNum).toBe(3724541953);
    expect(parsed.writable).toBe(true);
  });

  it('refuses every action and playback command while a reseed runs, before any run', async () => {
    const f = build();
    f.lock.beginReset();
    for (const call of [
      () => f.service.runAction('contract-create', {}, 'ip', NOW),
      () => f.service.run('organization-register', {}, 'ip', NOW),
    ]) {
      await expect(call()).rejects.toMatchObject({
        errorCode: 'DEMO_BUSY',
        httpStatus: 409,
        message: 'The demo data is being reseeded. Try again when the reseed finishes.',
      });
    }
    expect(f.runs.createRun).not.toHaveBeenCalled();
    f.lock.endReset();
    await f.service.runAction('contract-create', {}, 'ip', NOW);
    expect(f.lock.actionsInFlight).toBe(0);
  });

  it('refuses an unknown action and every playback-only command over HTTP', async () => {
    const f = build();
    for (const action of ['drop-tables', 'organization-register', 'field-positions']) {
      await expect(f.service.runAction(action, {}, '203.0.113.1', NOW)).rejects.toMatchObject({
        errorCode: 'VALIDATION_FAILED',
      });
    }
    expect(f.runs.createRun).not.toHaveBeenCalled();
  });

  it('refuses a write on a database neither local, staging nor the demo branch, before any run', async () => {
    const neon = 'postgresql://u:p@ep-dev-1.neon.tech/neondb';
    const f = build({ DATABASE_URL: neon, DATABASE_DIRECT_URL: neon });
    await expect(
      f.service.runAction('contract-create', {}, '203.0.113.1', NOW),
    ).rejects.toMatchObject({ errorCode: 'DEMO_DATABASE_NOT_ALLOWED' });
    expect(f.runs.createRun).not.toHaveBeenCalled();
  });

  it('accepts the dedicated demo branch named by DEMO_DATABASE_HOST', () => {
    const demo = 'postgresql://u:p@ep-demo-pooler.neon.tech/neondb';
    const f = build({
      DATABASE_URL: demo,
      DATABASE_DIRECT_URL: demo,
      DEMO_DATABASE_HOST: 'ep-demo-pooler.neon.tech',
    });
    expect(f.service.writable()).toBe(true);
  });

  it.each([
    ['incident-acknowledge', {}],
    ['incident-acknowledge', { recordId: 'i-1' }],
    ['incident-sos', {}],
  ])('requires the fields of %s', async (action, input) => {
    const f = build();
    await expect(f.service.runAction(action, input, 'ip', NOW)).rejects.toMatchObject({
      errorCode: 'VALIDATION_FAILED',
    });
  });

  it('acknowledges as a live Operator of the incident organization and audits as the panel', async () => {
    const f = build();
    const result = await f.service.runAction(
      'incident-acknowledge',
      { recordId: 'i-1', expectedVersion: 1 },
      '203.0.113.1',
      NOW,
    );
    expect(f.incidents.acknowledge).toHaveBeenCalledWith(
      'i-1',
      { expectedVersion: 1 },
      { id: 'u-operator', roles: ['ORG_OPERATOR'], organizationId: ORG },
    );
    expect(result).toMatchObject({
      action: 'incident-acknowledge',
      runId: 41,
      label: 'Demo 41',
      actedAs: { role: 'ORG_OPERATOR', email: 'treklink.dev+operator@gmail.com' },
      records: [{ code: 'INC-2026-000002', path: '/o/incidents/i-1' }],
    });
    expect(f.runs.createRun).toHaveBeenCalledWith('demo-panel', 'panel.incident-acknowledge');
    expect(audit(f)).toMatchObject({
      actorId: null,
      actorRoles: ['DEMO_PANEL'],
      action: 'demo.panel.incident-acknowledge',
      subjectType: 'DemoScenarioRun',
      subjectId: '41',
      ip: '203.0.113.1',
      after: expect.objectContaining({
        actedAs: { role: 'ORG_OPERATOR', email: 'treklink.dev+operator@gmail.com' },
      }) as unknown,
    });
  });

  it('responds and resolves as the owner', async () => {
    const f = build();
    f.incident.ownerId = 'u-manager';
    await f.service.runAction(
      'incident-respond',
      { recordId: 'i-1', expectedVersion: 2 },
      'ip',
      NOW,
    );
    await f.service.runAction(
      'incident-resolve',
      { recordId: 'i-1', expectedVersion: 3 },
      'ip',
      NOW,
    );
    const owner = { id: 'u-manager', roles: ['ORG_MANAGER'], organizationId: ORG };
    expect(f.incidents.responding).toHaveBeenCalledWith(
      'i-1',
      expect.objectContaining({ expectedVersion: 2 }),
      owner,
    );
    expect(f.incidents.resolve).toHaveBeenCalledWith(
      'i-1',
      expect.objectContaining({ expectedVersion: 3 }),
      owner,
    );
  });

  it('marks an UNROUTED incident a false alarm as Staff and refuses an owner action on it', async () => {
    const f = build();
    f.incident.state = 'UNROUTED';
    f.incident.organizationId = null;
    await f.service.runAction(
      'incident-false-alarm',
      { recordId: 'i-1', expectedVersion: 1 },
      'ip',
      NOW,
    );
    expect(f.incidents.falseAlarm).toHaveBeenCalledWith(
      'i-1',
      expect.objectContaining({ expectedVersion: 1 }),
      { id: 'u-staff', roles: ['STAFF'], organizationId: null },
    );
    await expect(
      f.service.runAction(
        'incident-acknowledge',
        { recordId: 'i-1', expectedVersion: 1 },
        'ip',
        NOW,
      ),
    ).rejects.toMatchObject({ errorCode: 'INVALID_STATE_TRANSITION' });
    expect(f.incidents.acknowledge).not.toHaveBeenCalled();
  });

  it('closes through the demo time control with no acting account', async () => {
    const f = build();
    const result = await f.service.runAction(
      'incident-close',
      { recordId: 'i-1', expectedVersion: 4 },
      'ip',
      NOW,
    );
    expect(f.timers.closeDemo).toHaveBeenCalledWith('i-1', 4, NOW);
    expect(result.actedAs).toBeNull();
  });

  it('sends a simulated SOS from the unit node and links the incident', async () => {
    const f = build();
    const result = await f.service.runAction('incident-sos', { deviceId: 'd-9' }, 'ip', NOW);
    const [topic, body, at, options] = f.uplinks.ingest.mock.calls[0] as [
      string,
      Buffer,
      Date,
      object,
    ];
    expect(topic).toBe('treklink/2/json/LongFast/!de00000a');
    expect(JSON.parse(body.toString())).toMatchObject({
      from: 3724541962,
      sender: '!de00000a',
      type: 'text',
    });
    expect(at).toBe(NOW);
    expect(options).toEqual({ simulated: true });
    expect(result.records[0]).toMatchObject({ code: 'INC-2026-000002' });
  });

  it('refuses an SOS from a unit that is not rented', async () => {
    const f = build();
    f.devices.projections.mockResolvedValueOnce([
      { id: 'd-9', assetTag: 'TL-0003', status: 'AVAILABLE', nodeNum: 1n },
    ]);
    await expect(
      f.service.runAction('incident-sos', { deviceId: 'd-9' }, 'ip', NOW),
    ).rejects.toMatchObject({
      errorCode: 'DEMO_SCENARIO_UNAVAILABLE',
    });
    expect(f.uplinks.ingest).not.toHaveBeenCalled();
  });

  it('requests a contract for ORG-0001, treklink-v3 and the minimum quantity as the live Manager', async () => {
    const f = build();
    await f.service.runAction('contract-create', {}, 'ip', NOW);
    expect(f.contracts.request).toHaveBeenCalledWith(
      expect.objectContaining({ planType: 'MONTHLY', hardwareVariantId: 'v-3', quantity: 5 }),
      { id: 'u-manager', roles: ['ORG_MANAGER'], organizationId: ORG },
      NOW,
    );
  });

  it('approves as Staff with the appointment at the next whole minute', async () => {
    const f = build();
    await f.service.runAction(
      'contract-approve',
      { recordId: 'c-1', expectedVersion: 3 },
      'ip',
      NOW,
    );
    expect(f.decisions.approve).toHaveBeenCalledWith(
      'c-1',
      { handoverAt: new Date('2026-11-24T03:01:00Z'), expectedVersion: 3 },
      expect.objectContaining({ id: 'u-staff' }),
      NOW,
    );
  });

  it('hands over: pays the holding fee due, provisions every unit, completes with the Manager as signer', async () => {
    const f = build();
    await f.service.runAction(
      'contract-handover',
      { recordId: 'c-1', expectedVersion: 3 },
      'ip',
      NOW,
    );
    expect(f.payments.recordCounter).toHaveBeenCalledWith(
      'inv-1',
      { method: 'CASH', amountVnd: 1_125_000n, reference: 'DEMO-PANEL-41-HOLD' },
      expect.objectContaining({ id: 'u-staff' }),
      NOW,
    );
    expect(f.handover.provision).toHaveBeenCalledTimes(2);
    expect(f.handover.complete).toHaveBeenCalledWith(
      'c-1',
      expect.objectContaining({
        signedByUserId: 'u-manager',
        expectedVersion: 3,
        deviceChecks: [
          { deviceId: 'd-1', batteryPct: 90, gpsFixOk: true },
          { deviceId: 'd-2', batteryPct: 90, gpsFixOk: true },
        ],
      }),
      expect.objectContaining({ id: 'u-staff' }),
      NOW,
    );
  });

  it('refuses a stale version before any payment, and keeps the run and audit of the failure', async () => {
    const f = build();
    const error = (await f.service
      .runAction('contract-handover', { recordId: 'c-1', expectedVersion: 2 }, 'ip', NOW)
      .catch((e: unknown) => e)) as DomainException;
    expect(error.errorCode).toBe(ErrorCode.STALE_VERSION);
    expect(error.resultDetails).toEqual({ runId: 41, label: 'Demo 41', records: [] });
    expect(f.payments.recordCounter).not.toHaveBeenCalled();
    expect(f.runs.saveRun).toHaveBeenCalledWith(41, [], expect.stringContaining('changed'), tx);
    expect(audit(f)).toMatchObject({
      after: expect.objectContaining({ errorCode: 'STALE_VERSION' }) as unknown,
    });
  });

  it('returns a running contract: notice and end now as the Manager, then check-in, reset and inspection', async () => {
    const f = build();
    const handed = { handedOverAt: NOW, checkedInAt: null, lostAt: null };
    f.contracts.demoDetail
      .mockResolvedValueOnce({ ...CONTRACT, status: 'ACTIVE', devices: [] })
      .mockResolvedValueOnce({
        ...CONTRACT,
        status: 'RETURN_DUE',
        devices: [
          { deviceId: 'd-1', ...handed },
          { deviceId: 'd-2', ...handed },
        ],
      })
      .mockResolvedValue({ ...CONTRACT, status: 'RETURNED', version: 9 });
    await f.service.runAction(
      'contract-return',
      { recordId: 'c-1', expectedVersion: 3 },
      'ip',
      NOW,
    );
    const manager = { id: 'u-manager', roles: ['ORG_MANAGER'], organizationId: ORG };
    expect(f.decisions.giveNotice).toHaveBeenCalledWith('c-1', 3, manager, NOW);
    expect(f.decisions.endNow).toHaveBeenCalledWith(
      'c-1',
      expect.objectContaining({ expectedVersion: 4 }),
      manager,
      NOW,
    );
    expect(f.returns.checkIn).toHaveBeenCalledWith(
      'c-1',
      ['TL-0003', 'TL-0004'],
      expect.objectContaining({ id: 'u-staff' }),
      NOW,
    );
    expect(f.devices.reset).toHaveBeenCalledTimes(2);
    expect(f.returns.inspect).toHaveBeenCalledWith(
      'c-1',
      'd-2',
      { result: 'PASSED', damageCodes: [], note: null },
      expect.objectContaining({ id: 'u-staff' }),
      NOW,
    );
  });

  it('refuses to return a contract that is not running or due', async () => {
    const f = build();
    await expect(
      f.service.runAction('contract-return', { recordId: 'c-1', expectedVersion: 3 }, 'ip', NOW),
    ).rejects.toMatchObject({ errorCode: 'INVALID_STATE_TRANSITION' });
    expect(f.returns.checkIn).not.toHaveBeenCalled();
  });

  it('closes after paying every open invoice of the contract', async () => {
    const f = build();
    f.invoices.panelOptions.mockResolvedValueOnce([
      { id: 'inv-9', number: 'INV-9', totalVnd: 400_000n, paidVnd: 100_000n },
    ]);
    await f.service.runAction('contract-close', { recordId: 'c-1', expectedVersion: 3 }, 'ip', NOW);
    expect(f.invoices.panelOptions).toHaveBeenCalledWith('c-1');
    expect(f.payments.recordCounter).toHaveBeenCalledWith(
      'inv-9',
      expect.objectContaining({ amountVnd: 300_000n }),
      expect.objectContaining({ id: 'u-staff' }),
      NOW,
    );
    expect(f.returns.close).toHaveBeenCalledWith(
      'c-1',
      3,
      expect.objectContaining({ id: 'u-staff' }),
    );
  });

  it('cancels a stale request as Staff', async () => {
    const f = build();
    await f.service.runAction(
      'contract-cancel',
      { recordId: 'c-1', expectedVersion: 3 },
      'ip',
      NOW,
    );
    expect(f.decisions.cancel).toHaveBeenCalledWith(
      'c-1',
      expect.objectContaining({ expectedVersion: 3 }),
      expect.objectContaining({ id: 'u-staff' }),
      NOW,
    );
  });

  it('pays an invoice in full at the counter and refuses one with nothing due', async () => {
    const f = build();
    f.invoices.panelOptions.mockResolvedValue([
      { id: 'inv-1', number: 'INV-1', totalVnd: 500n, paidVnd: 200n },
    ]);
    await f.service.runAction('invoice-pay', { recordId: 'inv-1' }, 'ip', NOW);
    expect(f.payments.recordCounter).toHaveBeenCalledWith(
      'inv-1',
      { method: 'CASH', amountVnd: 300n, reference: 'DEMO-PANEL-41' },
      expect.objectContaining({ id: 'u-staff' }),
      NOW,
    );
    await expect(
      f.service.runAction('invoice-pay', { recordId: 'inv-2' }, 'ip', NOW),
    ).rejects.toMatchObject({
      errorCode: 'INVALID_STATE_TRANSITION',
    });
  });

  it('opens and completes maintenance as Staff inside a transaction', async () => {
    const f = build();
    await f.service.runAction(
      'device-maintenance-open',
      { deviceId: 'd-1', expectedVersion: 7 },
      'ip',
      NOW,
    );
    expect(f.maintenance.open).toHaveBeenCalledWith(
      'd-1',
      expect.objectContaining({
        reason: 'STAFF_REPORTED',
        expectedVersion: 7,
        expectedAt: '2026-11-27',
      }),
      'u-staff',
      NOW,
      tx,
    );
    await f.service.runAction('device-maintenance-complete', { deviceId: 'd-1' }, 'ip', NOW);
    expect(f.maintenance.complete).toHaveBeenCalledWith(
      'd-1',
      'm-1',
      expect.objectContaining({ status: 'COMPLETED', expectedVersion: 2 }),
      'u-staff',
      NOW,
      tx,
    );
  });

  it('runs the MF-01a and MF-02 playback commands through the same registry and audit', async () => {
    const f = build();
    const registered = await f.service.run('organization-register', {}, 'ip', NOW);
    expect(f.onboarding.register).toHaveBeenCalledWith(
      expect.objectContaining({ taxCode: '8000000041' }),
    );
    expect(registered.context).toEqual({
      organizationId: 'org-9',
      organizationCode: 'ORG-0009',
      version: 0,
    });
    await f.service.run(
      'organization-verify',
      { recordId: 'org-9', expectedVersion: 0 },
      'ip',
      NOW,
    );
    expect(f.onboarding.verify).toHaveBeenCalledWith(
      'org-9',
      expect.objectContaining({ expectedVersion: 0 }),
      expect.objectContaining({ id: 'u-staff' }),
      NOW,
    );
    await f.service.run('field-positions', {}, 'ip', NOW);
    expect(f.contracts.visibleDevices).toHaveBeenCalledWith({ organizationId: ORG });
    expect(f.uplinks.ingest).toHaveBeenCalledWith(
      'treklink/2/json/LongFast/!de00000a',
      expect.any(Buffer),
      NOW,
      { simulated: true },
    );
  });

  // Leader ruling 2026-11-24, "No Admin at all" (D-110 clarification): no panel action and no playback
  // command may act as an Admin account, seeded or live. Every command runs here against mocks that would
  // hand out the seeded Admin if asked; the test fails if any command asks for it or passes an ADMIN
  // caller to a business service.
  it('never resolves a panel action or playback command to an ADMIN account', async () => {
    const f = build();
    const input = { recordId: 'c-1', expectedVersion: 3, deviceId: 'd-9' };
    for (const command of [...PANEL_ACTIONS, ...PLAYBACK_COMMANDS]) {
      const result = await f.service.run(command, input, 'ip', NOW).catch(() => null);
      expect(result?.actedAs?.role ?? null).not.toBe('ADMIN');
    }
    expect(f.sessions.panelAccountOf.mock.calls.map(([email]) => email)).not.toContain(
      SEEDED_EMAILS.ADMIN,
    );
    const callers = Object.values(f)
      .flatMap((mock) =>
        mock && typeof mock === 'object' ? (Object.values(mock) as unknown[]) : [],
      )
      .filter((fn): fn is jest.Mock => jest.isMockFunction(fn))
      .flatMap((fn) => fn.mock.calls.flat() as unknown[])
      .filter(
        (arg): arg is { roles: string[] } =>
          typeof arg === 'object' &&
          arg !== null &&
          Array.isArray((arg as { roles?: unknown }).roles),
      );
    expect(callers.length).toBeGreaterThan(0);
    expect(callers.filter((caller) => caller.roles.includes('ADMIN'))).toEqual([]);
    expect(PLAYBACK_COMMANDS).not.toContain('organization-approve');
  });

  it('refuses a seeded account that holds the ADMIN role, before any business call', async () => {
    const f = build();
    f.sessions.panelAccountOf.mockResolvedValue({ ...STAFF, roles: ['STAFF', 'ADMIN'] });
    await expect(
      f.service.runAction('contract-approve', { recordId: 'c-1', expectedVersion: 3 }, 'ip', NOW),
    ).rejects.toMatchObject({
      message: 'The demo panel never acts as an Admin account. Use the Admin screen.',
    });
    expect(f.decisions.approve).not.toHaveBeenCalled();
  });
});
