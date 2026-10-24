import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccountType } from '@prisma/client';
import { ErrorCode } from '../src/common/errors';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AccountsRepository } from '../src/modules/auth/accounts.repository';
import { AccountsService } from '../src/modules/auth/accounts.service';
import { OneTimeCodeService } from '../src/modules/auth/one-time-code.service';
import { PasswordFlowsService } from '../src/modules/auth/password-flows.service';
import { RolesService } from '../src/modules/auth/roles.service';
import { ValidatedEnvironment } from '../src/modules/platform/config/environment-variables';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import { ParameterService } from '../src/modules/platform/parameters/parameter.service';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

const CLIENT = { ip: null, userAgent: 'test:db' };

// TrekLink accounts and roles against Postgres (auth tasks 5.1, 5.3): the last-Admin guard under
// concurrent changes, and the queries the Admin screens read. Run only through test:db against a
// migrated disposable database, where the migrations seed roles and permissions but no account, so
// the run's own Admins are the only ones. Never deletes data: fixtures carry a fresh run ID, and each
// test leaves no run Admin active.
describe('TrekLink accounts against Postgres (REQ-ERR-05, REQ-ERR-07)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const repository = new AccountsRepository(prisma);
  const events = new TransactionalEvents(prisma, new EventEmitter2());
  const parameters = {
    get: (key: string) => Promise.resolve(key === 'auth.invitationTtlHours' ? 72 : 10),
  } as unknown as ParameterService;
  const codes = new OneTimeCodeService(repository, parameters);
  const mail = { sendCode: () => Promise.resolve() } as unknown as PasswordFlowsService;
  const config = {
    get: (key: string) => (key === 'DEFAULT_PAGE_SIZE' ? 20 : 100),
  } as unknown as ConfigService<ValidatedEnvironment, true>;
  const accounts = new AccountsService(repository, codes, mail, events, config);
  const roles = new RolesService(repository, events);
  const runId = randomUUID();
  let serial = 0;

  const newAdmin = async () => {
    serial += 1;
    const created = await repository.create({
      email: `accounts-test-${runId}-${serial}@example.invalid`,
      fullName: `Accounts test Admin ${serial}`,
      accountType: AccountType.TREKLINK,
      roleKeys: ['ADMIN'],
    });
    return { id: created.id, roles: ['ADMIN'], organizationId: null };
  };

  // Leaves no Admin of this run active, so the next test starts from zero again.
  const retire = (ids: string[]) =>
    prisma.user.updateMany({ where: { id: { in: ids } }, data: { isActive: false } });

  beforeAll(async () => {
    await prisma.$connect();
    expect(await repository.countActiveAdmins()).toBe(0);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('lets only one of two concurrent deactivations of the last two Admins pass', async () => {
    const [a, b] = [await newAdmin(), await newAdmin()];

    const results = await Promise.allSettled([
      accounts.deactivate(b, a.id, 'Concurrent A', CLIENT),
      accounts.deactivate(a, b.id, 'Concurrent B', CLIENT),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((result) => result.status === 'rejected');
    expect(refused).toMatchObject({ reason: { errorCode: ErrorCode.LAST_ADMIN } });
    expect(await repository.countActiveAdmins()).toBe(1);
    await retire([a.id, b.id]);
  });

  it('lets only one of a concurrent demotion and deactivation of the last two Admins pass', async () => {
    const [a, b] = [await newAdmin(), await newAdmin()];

    const results = await Promise.allSettled([
      accounts.update(a, b.id, { role: 'STAFF' }, CLIENT),
      accounts.deactivate(b, a.id, 'Concurrent', CLIENT),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await repository.countActiveAdmins()).toBe(1);
    await retire([a.id, b.id]);
  });

  it('creates an invited Staff account, lists it, promotes it and finds it with its new role', async () => {
    const admin = await newAdmin();
    const email = `accounts-test-${runId}-staff@example.invalid`;

    const created = await accounts.create(
      admin,
      { email, fullName: 'Invited Staff', role: 'STAFF' },
      CLIENT,
    );
    expect(created).toMatchObject({ email, roles: ['STAFF'], isActive: true, lastLoginAt: null });
    expect(
      await prisma.oneTimeCode.count({ where: { userId: created.id, purpose: 'SET_PASSWORD' } }),
    ).toBe(1);

    const page = await accounts.list({ q: `accounts-test-${runId}-STAFF`, isActive: true });
    expect(page.items.map((item) => item.id)).toEqual([created.id]);

    await expect(
      accounts.update(admin, created.id, { role: 'ADMIN', phoneNumber: '0901234567' }, CLIENT),
    ).resolves.toMatchObject({ roles: ['ADMIN'], phoneNumber: '0901234567' });
    await expect(
      accounts.create(
        admin,
        { email: email.toUpperCase(), fullName: 'Again', role: 'STAFF' },
        CLIENT,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.CONFLICT_UNIQUE });
    await retire([admin.id, created.id]);
  });

  it('reads the seeded roles and catalog, and refuses a role.manage removal from ADMIN', async () => {
    const all = await roles.list();
    expect(all.map((role) => role.key)).toEqual(['ADMIN', 'ORG_MANAGER', 'ORG_OPERATOR', 'STAFF']);
    const admin = all.find((role) => role.key === 'ADMIN')!;
    expect(admin.permissionKeys).toContain('role.manage');

    const catalog = await roles.catalog();
    expect(catalog.find((item) => item.key === 'role.manage')).toMatchObject({
      accountType: AccountType.TREKLINK,
      protected: true,
      scope: 'any',
    });
    expect(catalog.some((item) => item.scope === 'own')).toBe(true);

    const actor = { id: randomUUID(), roles: ['ADMIN'], organizationId: null };
    await expect(
      roles.replacePermissions(
        actor,
        admin.id,
        admin.permissionKeys.filter((key) => key !== 'role.manage'),
        CLIENT,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.ADMIN_LOCKOUT });
  });
});
