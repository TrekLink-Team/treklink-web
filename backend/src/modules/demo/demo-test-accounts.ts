import { HttpStatus } from '@nestjs/common';
import { DomainException, ErrorCode } from '../../common/errors';

// A compiled copy of the account list of `prisma/seed-demo.ts` (its SEEDED_ACCOUNTS export) and of the
// password variables its readPasswords reads, for the test accounts read (specs/demo design §8, D-089).
// The Vercel function ships only the build of src/, with no ts-node and no prisma/ folder, so the read
// must not load the seed file. demo-test-accounts.spec.ts fails when this copy drifts from the seed.

export type TestAccountRole = 'ADMIN' | 'STAFF' | 'ORG_MANAGER' | 'ORG_OPERATOR';

export interface SeededTestAccount {
  key: 'admin' | 'staff' | 'manager' | 'operator';
  email: string;
  fullName: string;
  role: TestAccountRole;
  organization: string | null;
}

// Creation order of the seed: Admin, Staff, Manager, Operator.
export const SEEDED_TEST_ACCOUNTS: readonly SeededTestAccount[] = [
  {
    key: 'admin',
    email: 'admin@treklink.local',
    fullName: 'Demo Admin',
    role: 'ADMIN',
    organization: null,
  },
  {
    key: 'staff',
    email: 'staff@treklink.local',
    fullName: 'Demo Staff',
    role: 'STAFF',
    organization: null,
  },
  {
    key: 'manager',
    email: 'manager@treklink.local',
    fullName: 'Demo Manager',
    role: 'ORG_MANAGER',
    organization: 'ORG-0001',
  },
  {
    key: 'operator',
    email: 'operator@treklink.local',
    fullName: 'Demo Operator',
    role: 'ORG_OPERATOR',
    organization: 'ORG-0001',
  },
];

export const passwordVariableOf = (account: Pick<SeededTestAccount, 'key'>): string =>
  `SEED_${account.key.toUpperCase()}_PASSWORD`;

// The four passwords from the environment, as the seed's readPasswords reads them, or 409
// DEMO_SEED_NOT_CONFIGURED naming the missing variables.
export const readTestAccountPasswords = (
  env: NodeJS.ProcessEnv,
): Record<SeededTestAccount['key'], string> => {
  const missing = SEEDED_TEST_ACCOUNTS.map(passwordVariableOf).filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new DomainException(
      HttpStatus.CONFLICT,
      ErrorCode.DEMO_SEED_NOT_CONFIGURED,
      `Set ${missing.join(', ')} before listing the test accounts.`,
    );
  }
  return Object.fromEntries(
    SEEDED_TEST_ACCOUNTS.map((account) => [account.key, env[passwordVariableOf(account)]!]),
  ) as Record<SeededTestAccount['key'], string>;
};
