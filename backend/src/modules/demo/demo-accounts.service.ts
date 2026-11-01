import { Inject, Injectable } from '@nestjs/common';
import {
  DEMO_SEED_LOADER,
  DemoSeedAccount,
  DemoSeedLoader,
  readSeedPasswords,
} from './demo-seed.runner';

export interface DemoTestAccount {
  role: DemoSeedAccount['role'];
  roleLabel: string;
  email: string;
  password: string;
  fullName: string;
  organization: string | null;
}

// The labels the account menu shows (frontend widgets/AccountMenu/labels.ts), with the TrekLink prefix
// on the two staff roles so a tester tells them from the organization roles.
const ROLE_LABELS: Record<DemoSeedAccount['role'], string> = {
  ADMIN: 'TrekLink Admin',
  STAFF: 'TrekLink Staff',
  ORG_MANAGER: 'Org Manager',
  ORG_OPERATOR: 'Org Operator',
};

// The sandbox test accounts (specs/demo REQ-EVT-05, api-design 05, D-088 amendment of 2026-11-01, D-089):
// every account the demo seed creates, with the password read from SEED_*_PASSWORD at request time.
// Nothing is stored and nothing is logged. Read-only and touching no database, so it runs in any NODE_ENV
// and on any database once DEMO_TEST_ACCOUNTS_ENABLED loads its module; the control panel guards of
// design §2 stay on the panel's own routes.
@Injectable()
export class DemoAccountsService {
  constructor(@Inject(DEMO_SEED_LOADER) private readonly load: DemoSeedLoader) {}

  list(env: NodeJS.ProcessEnv = process.env): { accounts: DemoTestAccount[] } {
    const seed = this.load();
    const passwords = readSeedPasswords(seed, env, 'listing the test accounts');
    return {
      accounts: seed.SEEDED_ACCOUNTS.map((account) => ({
        role: account.role,
        roleLabel: ROLE_LABELS[account.role],
        email: account.email,
        password: passwords[account.key],
        fullName: account.fullName,
        organization: account.organization,
      })),
    };
  }
}
