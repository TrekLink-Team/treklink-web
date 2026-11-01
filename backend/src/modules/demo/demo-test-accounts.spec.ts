import { DomainException } from '../../common/errors';
import { loadSeedModule } from './demo-seed.runner';
import {
  passwordVariableOf,
  readTestAccountPasswords,
  SEEDED_TEST_ACCOUNTS,
} from './demo-test-accounts';

const ENV = {
  SEED_ADMIN_PASSWORD: 'Admin-Pass-1',
  SEED_STAFF_PASSWORD: 'Staff-Pass-2',
  SEED_MANAGER_PASSWORD: 'Manager-Pass-3',
  SEED_OPERATOR_PASSWORD: 'Operator-Pass-4',
};

// The drift guard of the compiled copy (specs/demo design §8, D-089): it must equal the seed's own list
// and read the same variables as the seed's readPasswords.
describe('SEEDED_TEST_ACCOUNTS, the compiled copy of the seed account list', () => {
  const seed = loadSeedModule();

  it('equals the SEEDED_ACCOUNTS export of prisma/seed-demo.ts, in the same order', () => {
    expect(SEEDED_TEST_ACCOUNTS).toEqual(seed.SEEDED_ACCOUNTS);
  });

  it('reads the same variables as the seed readPasswords', () => {
    expect(readTestAccountPasswords(ENV)).toEqual(seed.readPasswords(ENV));
    for (const account of SEEDED_TEST_ACCOUNTS) {
      const partial: Record<string, string> = { ...ENV };
      delete partial[passwordVariableOf(account)];
      expect(() => seed.readPasswords(partial)).toThrow(passwordVariableOf(account));
      expect(() => readTestAccountPasswords(partial)).toThrow(passwordVariableOf(account));
    }
  });
});

describe('readTestAccountPasswords', () => {
  it('answers 409 DEMO_SEED_NOT_CONFIGURED naming every missing variable', () => {
    try {
      readTestAccountPasswords({ SEED_ADMIN_PASSWORD: 'a', SEED_MANAGER_PASSWORD: 'm' });
      throw new Error('expected a refusal');
    } catch (error) {
      const e = error as DomainException;
      expect(e.getStatus()).toBe(409);
      expect(e.getResponse()).toMatchObject({ errorCode: 'DEMO_SEED_NOT_CONFIGURED' });
      expect(e.message).toBe(
        'Set SEED_STAFF_PASSWORD, SEED_OPERATOR_PASSWORD before listing the test accounts.',
      );
    }
  });
});

// D-089: the Vercel function has no ts-node and no prisma/ folder, so nothing the accounts module loads
// may reach the seed runner or the seed file.
describe('DemoAccountsModule without the seed', () => {
  it('lists the accounts with the seed runner and the seed file unloadable', () => {
    jest.isolateModules(() => {
      jest.doMock('./demo-seed.runner', () => {
        throw new Error('the seed runner was loaded');
      });
      jest.doMock('../../../prisma/seed-demo', () => {
        throw new Error('the seed file was loaded');
      });
      /* eslint-disable @typescript-eslint/no-require-imports */
      require('./demo-accounts.module');
      const { DemoAccountsService } = require('./demo-accounts.service') as {
        DemoAccountsService: new () => { list(env: NodeJS.ProcessEnv): { accounts: unknown[] } };
      };
      /* eslint-enable @typescript-eslint/no-require-imports */
      expect(new DemoAccountsService().list(ENV).accounts).toHaveLength(4);
    });
  });
});
