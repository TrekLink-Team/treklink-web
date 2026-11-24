import { ConfigService } from '@nestjs/config';
import { DemoPanelResetService } from './demo-panel-reset.service';

const NOW = new Date('2026-11-24T03:00:00Z');
const HOST = 'ep-demo-1-pooler.ap-southeast-1.aws.neon.tech';
const DEMO_URL = `postgresql://u:p@${HOST}/treklink_prod?sslmode=require`;
const DIRECT_URL =
  'postgresql://u:p@ep-demo-1.ap-southeast-1.aws.neon.tech/treklink_prod?sslmode=require';
const PASSWORDS = { admin: 'a', staff: 's', manager: 'm', operator: 'o' };

const build = (env: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = {
    DEMO_RESET_ENABLED: true,
    DEMO_DATABASE_HOST: HOST,
    DATABASE_URL: DEMO_URL,
    DATABASE_DIRECT_URL: DIRECT_URL,
    DISPLAY_TIMEZONE_DEFAULT: 'Asia/Ho_Chi_Minh',
    ...env,
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService<never, true>;
  const events = { emitAfterCommit: jest.fn() };
  const parameters = { get: jest.fn().mockResolvedValue(300) };
  const auditLog = { latestOf: jest.fn().mockResolvedValue(null) };
  const repository = { wipeData: jest.fn().mockResolvedValue(['audit_log', 'users']) };
  const seed = {
    loadable: jest.fn().mockReturnValue(true),
    passwords: jest.fn().mockReturnValue(PASSWORDS),
    run: jest.fn().mockResolvedValue(['accounts', 'organizations', 'contracts']),
  };
  const playback = { active: jest.fn().mockReturnValue(false), resetting: false };
  const service = new DemoPanelResetService(
    config,
    events as never,
    parameters as never,
    auditLog as never,
    repository as never,
    seed as never,
    playback as never,
  );
  return { service, events, auditLog, repository, seed, playback };
};

const expectNothingWiped = (f: ReturnType<typeof build>) => {
  expect(f.repository.wipeData).not.toHaveBeenCalled();
  expect(f.seed.run).not.toHaveBeenCalled();
  expect(f.events.emitAfterCommit).not.toHaveBeenCalled();
};

describe('DemoPanelResetService refusals (REQ-PNL-12, AC-PNL-03)', () => {
  it.each([
    ['DEMO_RESET_ENABLED is off', { DEMO_RESET_ENABLED: false }, 'DEMO_DISABLED', 403],
    [
      'DEMO_DATABASE_HOST is unset',
      { DEMO_DATABASE_HOST: undefined },
      'DEMO_DATABASE_NOT_ALLOWED',
      403,
    ],
    [
      'the live host is another branch',
      { DATABASE_URL: DEMO_URL.replace('ep-demo-1', 'ep-prod-1') },
      'DEMO_DATABASE_NOT_ALLOWED',
      403,
    ],
    [
      'the direct URL is another endpoint',
      { DATABASE_DIRECT_URL: DIRECT_URL.replace('ep-demo-1', 'ep-prod-1') },
      'DEMO_DATABASE_NOT_ALLOWED',
      403,
    ],
    [
      'the URL carries a host override',
      { DATABASE_URL: `${DEMO_URL}&host=ep-prod-1.neon.tech` },
      'DEMO_DATABASE_NOT_ALLOWED',
      403,
    ],
    [
      'the database is local',
      { DATABASE_URL: 'postgresql://u:p@localhost/treklink' },
      'DEMO_DATABASE_NOT_ALLOWED',
      403,
    ],
  ])('refuses when %s', async (_name, env, code, status) => {
    const f = build(env);
    await expect(f.service.reset('RESET DEMO DATA', 'ip', NOW)).rejects.toMatchObject({
      errorCode: code,
      httpStatus: status,
    });
    expectNothingWiped(f);
  });

  it.each(['', 'reset demo data', 'RESET DEMO DATA ', 'RESET'])(
    'refuses the confirmation %p',
    async (confirmation) => {
      const f = build();
      await expect(f.service.reset(confirmation, 'ip', NOW)).rejects.toMatchObject({
        errorCode: 'VALIDATION_FAILED',
        message: 'Type RESET DEMO DATA to confirm.',
      });
      expectNothingWiped(f);
    },
  );

  it('refuses within five minutes of the last reseed in the audit log, even after a restart', async () => {
    const f = build();
    f.auditLog.latestOf.mockResolvedValue(new Date(NOW.getTime() - 4 * 60_000));
    await expect(f.service.reset('RESET DEMO DATA', 'ip', NOW)).rejects.toMatchObject({
      errorCode: 'RATE_LIMITED',
      httpStatus: 429,
      message: 'A reseed ran less than 5 minutes ago. Try again after 10:01.',
    });
    expect(f.auditLog.latestOf).toHaveBeenCalledWith('demo.panel.reset');
    expectNothingWiped(f);
  });

  it('refuses a second reseed started in this process within five minutes', async () => {
    const f = build();
    await f.service.reset('RESET DEMO DATA', 'ip', NOW);
    await expect(
      f.service.reset('RESET DEMO DATA', 'ip', new Date(NOW.getTime() + 60_000)),
    ).rejects.toMatchObject({ errorCode: 'RATE_LIMITED' });
    expect(f.repository.wipeData).toHaveBeenCalledTimes(1);
    await expect(
      f.service.reset('RESET DEMO DATA', 'ip', new Date(NOW.getTime() + 5 * 60_000)),
    ).resolves.toMatchObject({ tables: 2 });
  });

  it('refuses while a playback runs', async () => {
    const f = build();
    f.playback.active.mockReturnValue(true);
    await expect(f.service.reset('RESET DEMO DATA', 'ip', NOW)).rejects.toMatchObject({
      errorCode: 'DEMO_BUSY',
    });
    expectNothingWiped(f);
  });

  it('refuses when the seed is not in this build or a seed password is missing', async () => {
    const f = build();
    f.seed.loadable.mockReturnValue(false);
    await expect(f.service.reset('RESET DEMO DATA', 'ip', NOW)).rejects.toMatchObject({
      errorCode: 'DEMO_SEED_NOT_CONFIGURED',
      message: 'The demo seed is not in this build.',
    });
    f.seed.loadable.mockReturnValue(true);
    f.seed.passwords.mockImplementation(() => {
      throw Object.assign(new Error('Set SEED_ADMIN_PASSWORD before staging.'), {
        errorCode: 'DEMO_SEED_NOT_CONFIGURED',
      });
    });
    await expect(f.service.reset('RESET DEMO DATA', 'ip', NOW)).rejects.toMatchObject({
      message: 'Set SEED_ADMIN_PASSWORD before staging.',
    });
    expectNothingWiped(f);
  });
});

describe('DemoPanelResetService reseed (REQ-PNL-09)', () => {
  it('wipes, seeds a margin and a minute back, then audits after the wipe as the panel', async () => {
    const f = build();
    await expect(f.service.reset('RESET DEMO DATA', '203.0.113.4', NOW)).resolves.toEqual({
      resetAt: NOW,
      tables: 2,
      seedGroups: 3,
    });
    expect(f.seed.run).toHaveBeenCalledWith(PASSWORDS, new Date(NOW.getTime() - 360_000));
    const order = [
      f.repository.wipeData.mock.invocationCallOrder[0],
      f.seed.run.mock.invocationCallOrder[0],
      f.events.emitAfterCommit.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(f.events.emitAfterCommit).toHaveBeenCalledWith('audit.record', {
      actorId: null,
      actorRoles: ['DEMO_PANEL'],
      organizationId: null,
      action: 'demo.panel.reset',
      subjectType: 'Database',
      subjectId: null,
      after: { tables: 2, seedGroups: 3, demo: true },
      ip: '203.0.113.4',
    });
    expect(f.playback.resetting).toBe(false);
  });

  it('releases the lock when the seed fails, and still keeps five minutes before the next try', async () => {
    const f = build();
    f.seed.run.mockRejectedValueOnce(new Error('seed failed'));
    await expect(f.service.reset('RESET DEMO DATA', 'ip', NOW)).rejects.toThrow('seed failed');
    expect(f.playback.resetting).toBe(false);
    await expect(
      f.service.reset('RESET DEMO DATA', 'ip', new Date(NOW.getTime() + 1000)),
    ).rejects.toMatchObject({
      errorCode: 'RATE_LIMITED',
    });
  });

  it('reports availability without a confirmation, with the reason and the next allowed time', async () => {
    const f = build();
    await expect(f.service.availability(NOW)).resolves.toEqual({
      available: true,
      reason: null,
      nextAllowedAt: null,
    });
    f.auditLog.latestOf.mockResolvedValue(new Date(NOW.getTime() - 60_000));
    await expect(f.service.availability(NOW)).resolves.toMatchObject({
      available: false,
      nextAllowedAt: new Date(NOW.getTime() + 4 * 60_000),
    });
    await expect(
      build({ DEMO_RESET_ENABLED: false }).service.availability(NOW),
    ).resolves.toMatchObject({
      available: false,
      reason: 'The demo reseed is off on this deployment.',
    });
  });
});
