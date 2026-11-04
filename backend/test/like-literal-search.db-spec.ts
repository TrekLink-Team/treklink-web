import { randomUUID } from 'node:crypto';
import { AccountType } from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AccountsRepository } from '../src/modules/auth/accounts.repository';
import { DevicesRepository } from '../src/modules/devices/devices.repository';
import { OrganizationsRepository } from '../src/modules/organizations/organizations.repository';
import { AuditLogRepository } from '../src/modules/platform/audit/audit-log.repository';
import { AuditLogService } from '../src/modules/platform/audit/audit-log.service';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// The searches that pass user text to Prisma's `contains` or `startsWith` read `%`, `_` and `\` as
// literal characters (common/prisma/like-literal.ts): Prisma hands the value to LIKE or ILIKE unescaped.
// Each search has a bait row, which `%` or `_` as a wildcard would match, and a row that holds the
// characters themselves; only the second may come back. Run only through test:db against a migrated
// disposable database. Never deletes data: fixtures carry a fresh run token, and every search names it.
describe('searches read % and _ literally on Postgres', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const runId = randomUUID();
  // Letters only, so no other fixture holds it by chance.
  const token = runId
    .replace(/[^a-f]/g, '')
    .slice(0, 6)
    .padEnd(6, 'q');
  // The bait holds "<token>AB"; the literal row holds "<token>%B" and "<token>_B".
  const bait = `${token}AB`;
  const literal = `${token}%B ${token}_B`;
  const searches = [`${token}%`, `${token}_`];

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('organizations review search (organizations api-design 02 `q`): legal name', async () => {
    const repository = new OrganizationsRepository(prisma);
    const ids: Record<string, string> = {};
    for (const [key, legalName] of [
      ['bait', `Bait ${bait} Co.`],
      ['literal', `Literal ${literal} Co.`],
    ]) {
      ids[key] = (
        await prisma.organization.create({
          data: {
            code: `LK-${key}-${runId.slice(0, 8)}`,
            legalName,
            taxCode: `like-${runId}-${key}`,
            address: 'Test address',
            contactEmail: `like-${runId}-${key}@example.invalid`,
            contactPhone: '0900000000',
          },
        })
      ).id;
    }
    for (const q of searches) {
      const [rows, total] = await repository.page({ q }, 0, 50);
      expect(rows.map((row) => row.id)).toEqual([ids.literal]);
      expect(total).toBe(1);
    }
  });

  it('device fleet search (devices api-design 06 `q`): asset tag', async () => {
    const repository = new DevicesRepository(prisma);
    const staff = await prisma.user.create({
      data: {
        email: `like-${runId}-registrar@example.invalid`,
        fullName: 'Like test registrar',
        accountType: AccountType.TREKLINK,
      },
    });
    const variant = await prisma.hardwareVariant.create({
      data: {
        code: `like-test-${runId}`,
        name: 'Like test variant',
        hasGps: true,
        hasMotionSensor: false,
        mqttCapable: true,
        firmwareBaseline: 'test-only',
        remainingValueSchedule: [],
      },
    });
    const ids: Record<string, string> = {};
    for (const [key, assetTag] of [
      ['bait', `LK-${bait}`],
      ['literal', `LK-${literal}`],
    ]) {
      ids[key] = (
        await prisma.device.create({
          data: {
            assetTag,
            nodeNum: BigInt(`0x${randomUUID().slice(0, 8)}`),
            hardwareVariantId: variant.id,
            firmwareVersion: 'test-only',
            acquiredAt: new Date('2026-10-25T02:00:00.000Z'),
            registeredById: staff.id,
          },
        })
      ).id;
    }
    for (const q of searches) {
      const [rows, total] = await repository.page({ q }, 0, 50);
      expect(rows.map((row) => row.id)).toEqual([ids.literal]);
      expect(total).toBe(1);
    }
  });

  it('TrekLink account search (auth api-design 09 `q`): full name and email', async () => {
    const repository = new AccountsRepository(prisma);
    const ids: Record<string, string> = {};
    for (const [key, fullName] of [
      ['bait', `Bait ${bait}`],
      ['literal', `Literal ${literal}`],
    ]) {
      ids[key] = (
        await prisma.user.create({
          data: {
            email: `like-${runId}-${key}@example.invalid`,
            fullName,
            accountType: AccountType.TREKLINK,
          },
        })
      ).id;
    }
    for (const q of searches) {
      const [rows, total] = await repository.pageTreklinkAccounts({ q }, 0, 50);
      expect(rows.map((row) => row.id)).toEqual([ids.literal]);
      expect(total).toBe(1);
    }
    // The email: "_" in an address is common, and must not stand for any one character.
    const [byEmail] = await repository.pageTreklinkAccounts({ q: `like_${runId}-literal` }, 0, 50);
    expect(byEmail).toEqual([]);
  });

  it('audit log action prefix (platform api-design 05 `action`)', async () => {
    const service = new AuditLogService(new AuditLogRepository(prisma), {
      get: (key: string) => ({ DEFAULT_PAGE_SIZE: 20, MAX_PAGE_SIZE: 100 })[key],
    } as never);
    const ids: Record<string, string> = {};
    for (const [key, action] of [
      ['bait', `test.${bait}`],
      ['literal', `test.${token}%_B`],
    ]) {
      ids[key] = (
        await prisma.auditLog.create({
          data: { action, actorRoles: [], subjectType: 'LikeTest' },
        })
      ).id;
    }
    for (const action of [`test.${token}%`, `test.${token}%_`]) {
      const page = await service.search({ action, pageNumber: 1, pageSize: 50 });
      expect(page.items.map((item) => item.id)).toEqual([ids.literal]);
      expect(page.totalCount).toBe(1);
    }
  });
});
