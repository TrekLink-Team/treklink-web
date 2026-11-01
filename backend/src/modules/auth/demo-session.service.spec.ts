import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { AccountSessionService } from './account-session.service';
import { AccountsRepository } from './accounts.repository';
import { DemoSessionService } from './demo-session.service';
import { TokenService } from './token.service';

const SESSION_USER = {
  id: 'u-manager',
  email: 'manager@treklink.local',
  fullName: 'Demo Manager',
  accountType: 'ORGANIZATION',
  roles: ['ORG_MANAGER'],
  organization: { id: 'org-1', memberRole: 'MANAGER' },
};
const CLIENT = { ip: '127.0.0.1', userAgent: 'jest' };
const PAIR = {
  accessToken: 'at',
  accessTokenExpiresIn: 900,
  refreshToken: 'rt',
  refreshTokenExpiresIn: 604800,
};

const build = (
  env: Record<string, unknown> = { NODE_ENV: 'development', DEMO_CONTROLS_ENABLED: true },
) => {
  const tx = { tx: true };
  const accounts = {
    findByEmail: jest.fn().mockResolvedValue({ id: 'u-manager' }),
    insertAuthEvent: jest.fn().mockResolvedValue(undefined),
  };
  const sessions = { eligible: jest.fn().mockResolvedValue(SESSION_USER) };
  const tokens = { issue: jest.fn().mockResolvedValue({ tokens: PAIR, refreshTokenId: 'r1' }) };
  const events = { transaction: jest.fn((work: (t: object) => Promise<unknown>) => work(tx)) };
  const config = { get: (key: string) => env[key] };
  const service = new DemoSessionService(
    accounts as unknown as AccountsRepository,
    sessions as unknown as AccountSessionService,
    tokens as unknown as TokenService,
    events as unknown as TransactionalEvents,
    config as unknown as ConfigService<never, true>,
  );
  return { service, accounts, sessions, tokens, tx };
};

describe('DemoSessionService', () => {
  it('issues a normal pair for the seeded account and records DEMO_SWITCH in the same transaction', async () => {
    const { service, accounts, tokens, tx } = build();
    await expect(service.switchTo('manager@treklink.local', CLIENT)).resolves.toEqual({
      ...PAIR,
      user: SESSION_USER,
    });
    expect(accounts.findByEmail).toHaveBeenCalledWith('manager@treklink.local');
    expect(accounts.insertAuthEvent).toHaveBeenCalledWith(
      { userId: 'u-manager', email: 'manager@treklink.local', type: 'DEMO_SWITCH', ...CLIENT },
      tx,
    );
    expect(tokens.issue).toHaveBeenCalledWith(SESSION_USER, CLIENT, tx);
  });

  it('answers 404 when the seeded account is missing or may not sign in', async () => {
    const { service, sessions, tokens } = build();
    sessions.eligible.mockResolvedValueOnce(null);
    const error = (await service
      .switchTo('manager@treklink.local', CLIENT)
      .catch((e: unknown) => e)) as DomainException;
    expect(error.getStatus()).toBe(404);
    expect(error.message).toBe('No seeded account for this role. Stage a scenario first.');
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  it.each([
    [{ NODE_ENV: 'production', DEMO_CONTROLS_ENABLED: true }],
    [{ NODE_ENV: 'development', DEMO_CONTROLS_ENABLED: false }],
  ])('refuses with 403 DEMO_DISABLED outside demo mode (%j)', async (env) => {
    const { service, accounts } = build(env);
    for (const call of [
      () => service.switchTo('admin@treklink.local', CLIENT),
      () => service.accountOf('admin@treklink.local'),
    ]) {
      const error = (await call().catch((e: unknown) => e)) as DomainException;
      expect(error.getStatus()).toBe(403);
      expect(error.getResponse()).toMatchObject({ errorCode: 'DEMO_DISABLED' });
    }
    expect(accounts.findByEmail).not.toHaveBeenCalled();
  });

  it('reads an account without issuing anything', async () => {
    const { service, tokens, accounts } = build();
    await expect(service.accountOf('manager@treklink.local')).resolves.toEqual(SESSION_USER);
    expect(tokens.issue).not.toHaveBeenCalled();
    expect(accounts.insertAuthEvent).not.toHaveBeenCalled();
  });
});
