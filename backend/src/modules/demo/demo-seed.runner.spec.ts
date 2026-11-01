import { DomainException } from '../../common/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DemoSeedModule, DemoSeedRunner, loadSeedModule } from './demo-seed.runner';

describe('DemoSeedRunner', () => {
  const prisma = {} as PrismaService;
  const seedDemo = jest.fn().mockResolvedValue(['user admin@treklink.local']);
  const readPasswords = jest.fn();
  const module: DemoSeedModule = { seedDemo, readPasswords, SEEDED_ACCOUNTS: [] };

  it('refuses with 409 DEMO_SEED_NOT_CONFIGURED naming the missing variables', () => {
    readPasswords.mockImplementation(() => {
      throw new Error('missing SEED_STAFF_PASSWORD, SEED_OPERATOR_PASSWORD');
    });
    const runner = new DemoSeedRunner(prisma, () => module);
    try {
      runner.passwords({});
      throw new Error('expected a refusal');
    } catch (error) {
      const e = error as DomainException;
      expect(e.getStatus()).toBe(409);
      expect(e.getResponse()).toMatchObject({ errorCode: 'DEMO_SEED_NOT_CONFIGURED' });
      expect(e.message).toBe('Set SEED_STAFF_PASSWORD, SEED_OPERATOR_PASSWORD before staging.');
    }
  });

  it('runs the seed with the bcrypt cost and API key of the environment', async () => {
    const runner = new DemoSeedRunner(prisma, () => module);
    const passwords = { admin: 'a', staff: 's', manager: 'm', operator: 'o' };
    const now = new Date('2026-11-01T02:00:00.000Z');
    await runner.run(passwords, now, { BCRYPT_COST: '4', SEED_ORG_API_KEY: '' });
    expect(seedDemo).toHaveBeenCalledWith(prisma, passwords, {
      now,
      bcryptCost: 4,
      apiKey: undefined,
    });
  });

  it('exports the seeded accounts in creation order, with no password', () => {
    const accounts = loadSeedModule().SEEDED_ACCOUNTS;
    expect(accounts.map((a) => [a.role, a.email, a.organization])).toEqual([
      ['ADMIN', 'admin@treklink.local', null],
      ['STAFF', 'staff@treklink.local', null],
      ['ORG_MANAGER', 'manager@treklink.local', 'ORG-0001'],
      ['ORG_OPERATOR', 'operator@treklink.local', 'ORG-0001'],
    ]);
    for (const account of accounts) expect(Object.keys(account)).not.toContain('password');
  });

  it('loads prisma/seed-demo.ts and its exports', () => {
    const loaded = loadSeedModule();
    expect(typeof loaded.seedDemo).toBe('function');
    expect(
      loaded.readPasswords({
        SEED_ADMIN_PASSWORD: 'a',
        SEED_STAFF_PASSWORD: 's',
        SEED_MANAGER_PASSWORD: 'm',
        SEED_OPERATOR_PASSWORD: 'o',
      }),
    ).toEqual({ admin: 'a', staff: 's', manager: 'm', operator: 'o' });
  });
});
