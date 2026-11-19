import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { MemberRole } from '@prisma/client';
import { SEEDED_ACCOUNTS, seedDemo } from '../prisma/seed-demo';
import { PrismaService } from '../src/common/prisma/prisma.service';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}
if (/\.neon\.tech/i.test(databaseUrl)) {
  throw new Error('seed-demo-legacy-move.db-spec seeds the database; never run it against Neon.');
}

// TK-242 renamed the four demo accounts and ORG-0001 (D-110 rule 7). A database seeded before it, and
// reseeded without a wipe, must end with one account per role carrying the new values on the same
// ids, so memberships and the roster still route to them, and a further run must change nothing.
//
// The seed takes fixed codes that other suites also allocate, so it runs in a schema of its own
// (as seed-demo-history.db-spec does): migrated here, seeded and dropped at the end.
describe('demo seed move of the pre-TK-242 accounts and organization', () => {
  const schema = `seed_demo_legacy_${randomUUID().slice(0, 8)}`;
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schema);
  const prisma = new PrismaService({ datasourceUrl: url.toString() });
  const password = 'Seed-demo-legacy-1';
  const passwords = { admin: password, staff: password, manager: password, operator: password };
  const options = { now: new Date(), bcryptCost: 4 };

  const LEGACY = {
    admin: { email: 'admin@treklink.local', fullName: 'Demo Admin' },
    staff: { email: 'staff@treklink.local', fullName: 'Demo Staff' },
    manager: { email: 'manager@treklink.local', fullName: 'Demo Manager' },
    operator: { email: 'operator@treklink.local', fullName: 'Demo Operator' },
  } as const;
  const ids = new Map<string, string>();
  let organizationVersion = 0;
  let reseed: string[] = [];

  beforeAll(async () => {
    execFileSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
      {
        cwd: join(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: url.toString(), DATABASE_DIRECT_URL: url.toString() },
        stdio: 'pipe',
      },
    );
    await seedDemo(prisma, passwords, options);
    // Turn the fresh seed into a database seeded before TK-242: the old emails, names and
    // organization fields on the same rows.
    for (const account of SEEDED_ACCOUNTS) {
      const user = await prisma.user.update({
        where: { email: account.email },
        data: LEGACY[account.key],
      });
      ids.set(account.key, user.id);
    }
    const organization = await prisma.organization.update({
      where: { code: 'ORG-0001' },
      data: {
        legalName: 'TrekLink Demo Tours Co., Ltd.',
        address: '1 Demo Street, Da Lat, Lam Dong',
        contactEmail: 'manager@treklink.local',
      },
    });
    organizationVersion = organization.version;
    reseed = await seedDemo(prisma, passwords, options);
  }, 180_000);
  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });

  it('renames the four accounts and the organization and creates no account', () => {
    expect(reseed.filter((label) => label.startsWith('user '))).toEqual([]);
    expect(reseed.filter((label) => label.startsWith('renamed user '))).toHaveLength(4);
    expect(reseed).toContain('renamed organization ORG-0001 (legalName, address, contactEmail)');
  });

  it('keeps one account per role, with the new email and name on the old id', async () => {
    expect(await prisma.user.count({ where: { email: { endsWith: '@treklink.local' } } })).toBe(0);
    for (const account of SEEDED_ACCOUNTS) {
      const user = await prisma.user.findUniqueOrThrow({
        where: { email: account.email },
        include: { roles: { include: { role: true } } },
      });
      expect(user.id).toBe(ids.get(account.key));
      expect(user.fullName).toBe(account.fullName);
      expect(await prisma.userRole.count({ where: { role: { key: account.role } } })).toBe(1);
    }
  });

  it('keeps ORG-0001 at one Manager and one Operator, and the roster on the same ids', async () => {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { code: 'ORG-0001' },
      include: { members: true },
    });
    expect(organization).toMatchObject({
      legalName: 'Suong Ngan Trekking Co., Ltd.',
      address: '42 Le Hong Phong, Da Lat, Lam Dong',
      contactEmail: 'treklink.dev@gmail.com',
      version: organizationVersion + 1,
    });
    const byRole = (role: MemberRole) =>
      organization.members.filter((m) => m.role === role).map((m) => m.userId);
    expect(byRole(MemberRole.MANAGER)).toEqual([ids.get('manager')]);
    expect(byRole(MemberRole.OPERATOR)).toEqual([ids.get('operator')]);

    const shifts = await prisma.rosterShift.findMany({
      where: { organizationId: organization.id },
      include: { primaryMember: true, backupMember: true },
    });
    expect(shifts.length).toBeGreaterThan(0);
    for (const shift of shifts) {
      expect(shift.primaryMember?.userId).toBe(ids.get('operator'));
      expect(shift.backupMember?.userId).toBe(ids.get('manager'));
    }
  });

  it('changes nothing on a further run', async () => {
    await expect(seedDemo(prisma, passwords, options)).resolves.toEqual([]);
  });
});
