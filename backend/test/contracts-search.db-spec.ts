import { randomUUID } from 'node:crypto';
import { AccountType, PlanType, Prisma } from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { MembersRepository } from '../src/modules/organizations/members.repository';
import { OrganizationsRepository } from '../src/modules/organizations/organizations.repository';
import { OrganizationsService } from '../src/modules/organizations/organizations.service';
import { ContractReadsService } from '../src/modules/rentals/contract-reads.service';
import { ContractsRepository } from '../src/modules/rentals/contracts.repository';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// The contract search of rentals api-design 02 (REQ-EVT-26, task 5.2) against Postgres: the code, the
// organization's legal name and its code, ignoring case, inside the caller's scope, with the paging of
// the matches, and the trigram index behind the code match. Run only through test:db against a migrated
// disposable database. Never deletes data: fixtures carry a fresh run token, and every search names it.
describe('contract search on api-design 02 against Postgres (REQ-EVT-26)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const contracts = new ContractsRepository(prisma);
  const organizations = new OrganizationsService(
    new OrganizationsRepository(prisma),
    {} as MembersRepository,
    {} as never,
    {} as never,
  );
  const config = {
    get: (key: string) => ({ DEFAULT_PAGE_SIZE: 20, MAX_PAGE_SIZE: 100 })[key],
  };
  const reads = new ContractReadsService(
    contracts,
    organizations,
    { variants: () => Promise.resolve([]) } as never,
    {} as never,
    config as never,
  );
  const at = new Date('2026-10-25T02:00:00.000Z');
  const runId = randomUUID();
  // Letters only, so no other fixture's code or name contains it by chance.
  const token = runId
    .replace(/[^a-f]/g, '')
    .slice(0, 6)
    .padEnd(6, 'q');
  const staff = { id: 'staff', roles: ['STAFF'], organizationId: null };
  let variantId: string;
  let requester: string;
  let alpha: { id: string; code: string; contracts: { id: string; code: string }[] };
  let beta: { id: string; code: string; contracts: { id: string; code: string }[] };

  const organization = async (suffix: string, legalName: string) => {
    const row = await prisma.organization.create({
      data: {
        code: `S${suffix}-${token}`.toUpperCase(),
        legalName,
        taxCode: `search-${runId}-${suffix}`,
        address: 'Test address',
        contactEmail: `search-test-${runId}-${suffix}@example.invalid`,
        contactPhone: '0900000000',
      },
    });
    return { id: row.id, code: row.code, contracts: [] as { id: string; code: string }[] };
  };

  const contract = (organizationId: string) =>
    prisma.$transaction(
      (tx) =>
        contracts.insertRequested(
          {
            organizationId,
            planType: PlanType.MONTHLY,
            dayPlanDays: null,
            hardwareVariantId: variantId,
            quantity: 1,
            requestedStartDate: new Date('2026-11-01T00:00:00.000Z'),
            monthlyUnitPriceVnd: 250_000n,
            dayPremium: null,
            holdingFeeRatio: new Prisma.Decimal('0.5'),
            requestedById: requester,
          },
          at,
          tx,
        ),
      { maxWait: 15000, timeout: 15000 },
    );

  const ids = (items: { row: { id: string } }[]) => items.map((item) => item.row.id).sort();
  const sorted = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

  beforeAll(async () => {
    await prisma.$connect();
    requester = (
      await prisma.user.create({
        data: {
          email: `search-test-${runId}@example.invalid`,
          fullName: 'Search test manager',
          accountType: AccountType.ORGANIZATION,
        },
      })
    ).id;
    variantId = (
      await prisma.hardwareVariant.create({
        data: {
          code: `search-test-${runId}`,
          name: 'Search test variant',
          hasGps: true,
          hasMotionSensor: false,
          mqttCapable: true,
          firmwareBaseline: 'test-only',
          remainingValueSchedule: [],
        },
      })
    ).id;
    // The token sits in alpha's legal name and in both codes; beta's legal name lacks it.
    alpha = await organization('a', `Search ${token} Trekking Co., Ltd.`);
    beta = await organization('b', 'Search test second organization');
    for (const owner of [alpha, alpha, beta]) {
      const created = await contract(owner.id);
      owner.contracts.push({ id: created.id, code: created.code });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('matches the organization legal name ignoring case', async () => {
    const page = await reads.page({ q: `${token.toUpperCase()} trekking` }, staff);
    expect(ids(page.items)).toEqual(sorted(alpha.contracts));
    expect(page.totalCount).toBe(2);
  });

  it('matches the organization code ignoring case', async () => {
    const page = await reads.page({ q: beta.code.toLowerCase() }, staff);
    expect(ids(page.items)).toEqual(sorted(beta.contracts));
    expect(page.totalCount).toBe(1);
  });

  it('matches the contract code ignoring case', async () => {
    const target = alpha.contracts[1];
    const page = await reads.page({ q: target.code.toLowerCase() }, staff);
    expect(ids(page.items)).toContain(target.id);
    expect(
      page.items.every((item) => item.row.code.toLowerCase().includes(target.code.toLowerCase())),
    ).toBe(true);
  });

  it('combines the code and organization matches with the other filters', async () => {
    // The token names both organizations through their codes.
    const both = await reads.page({ q: token }, staff);
    expect(ids(both.items)).toEqual(sorted([...alpha.contracts, ...beta.contracts]));
    const filtered = await reads.page({ q: token, organizationId: beta.id }, staff);
    expect(ids(filtered.items)).toEqual(sorted(beta.contracts));
  });

  it("never widens a member's list to another organization", async () => {
    const member = { id: requester, roles: ['ORG_MANAGER'], organizationId: alpha.id };
    const page = await reads.page({ q: beta.code }, member);
    expect(page.items).toEqual([]);
    expect(page.totalCount).toBe(0);
    const own = await reads.page({ q: token }, member);
    expect(ids(own.items)).toEqual(sorted(alpha.contracts));
  });

  it('reads % and _ as literal characters', async () => {
    // As wildcards, both would match alpha's legal name "Search <token> Trekking ...".
    const percent = await reads.page({ q: `${token}%trekking` }, staff);
    const underscore = await reads.page({ q: `search_${token}` }, staff);
    expect(percent.totalCount).toBe(0);
    expect(underscore.totalCount).toBe(0);
  });

  it('pages over the matches only, newest status change first', async () => {
    const first = await reads.page({ q: token, pageNumber: 1, pageSize: 2 }, staff);
    const second = await reads.page({ q: token, pageNumber: 2, pageSize: 2 }, staff);
    expect(first.totalCount).toBe(3);
    expect(first.totalPages).toBe(2);
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    expect([...ids(first.items), ...ids(second.items)].sort()).toEqual(
      sorted([...alpha.contracts, ...beta.contracts]),
    );
  });

  it('has the trigram index on the contract code, usable by a substring ILIKE', async () => {
    const index = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'rental_contracts_code_trgm'`;
    expect(index).toHaveLength(1);
    expect(index[0].indexdef).toContain('gin_trgm_ops');
    // With sequential scans priced out, the planner reaches the code match through the index.
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN SELECT id FROM rental_contracts WHERE code ILIKE '%${token}%'`,
      );
    });
    expect(plan.map((line) => line['QUERY PLAN']).join('\n')).toContain(
      'rental_contracts_code_trgm',
    );
  });
});
