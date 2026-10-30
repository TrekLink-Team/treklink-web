import { randomUUID } from 'node:crypto';
import { ComplianceActionKind, ComplianceCaseStatus, ComplianceCaseType } from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { ComplianceCasesRepository } from '../src/modules/organizations/compliance-cases.repository';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// Organizations 2.10 against Postgres: the raw SQL of the compliance case repository (the CMP- code under
// its advisory lock, the row lock) and the BR-40 CHECK of 20261014090000_asset_loss_and_compliance.
// Fixtures carry a fresh run id; nothing existing is deleted.
describe('compliance cases against Postgres (organizations 2.10)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const cases = new ComplianceCasesRepository(prisma);
  const run = randomUUID().slice(0, 8);
  let organizationId: string;
  let staffId: string;

  const open = (type: ComplianceCaseType) =>
    prisma.$transaction(async (tx) =>
      cases.create(
        {
          code: await cases.nextCode(tx),
          organizationId,
          type,
          evidence: `Evidence ${run}`,
          linkedContractIds: [],
          openedById: staffId,
        },
        tx,
      ),
    );

  beforeAll(async () => {
    const staff = await prisma.user.create({
      data: { email: `cmp-${run}@example.test`, fullName: 'Case Staff', accountType: 'TREKLINK' },
    });
    staffId = staff.id;
    const organization = await prisma.organization.create({
      data: {
        code: `CMP-${run}`,
        legalName: `Compliance Test ${run}`,
        taxCode: `8${Date.now()}`.slice(0, 10),
        address: '1 Test Street',
        contactEmail: `cmp-${run}@example.test`,
        contactPhone: '0900000000',
        status: 'ACTIVE',
      },
    });
    organizationId = organization.id;
  });

  afterAll(() => prisma.$disconnect());

  it('gives two cases opened at the same moment distinct CMP- codes', async () => {
    const [a, b] = await Promise.all([
      open(ComplianceCaseType.OTHER_BREACH),
      open(ComplianceCaseType.OTHER_BREACH),
    ]);
    expect(a.code).toMatch(/^CMP-\d{4,}$/);
    expect(b.code).toMatch(/^CMP-\d{4,}$/);
    expect(a.code).not.toBe(b.code);
  });

  it('locks a case, appends an action and closes it once', async () => {
    const created = await open(ComplianceCaseType.OTHER_BREACH);
    await prisma.$transaction(async (tx) => {
      const locked = await cases.lock(created.id, tx);
      expect(locked?.status).toBe(ComplianceCaseStatus.OPEN);
      await cases.addAction(
        {
          caseId: created.id,
          kind: ComplianceActionKind.OTHER,
          targetId: null,
          note: 'Called the Manager',
          actorId: staffId,
        },
        tx,
      );
    });
    const at = new Date();
    const first = await prisma.$transaction((tx) =>
      cases.close(
        created.id,
        { outcome: 'Resolved', authorityReference: null, closedById: staffId, at },
        tx,
      ),
    );
    const second = await prisma.$transaction((tx) =>
      cases.close(
        created.id,
        { outcome: 'Again', authorityReference: null, closedById: staffId, at },
        tx,
      ),
    );
    expect([first, second]).toEqual([true, false]);
    const row = await cases.find(created.id);
    expect(row?.status).toBe(ComplianceCaseStatus.CLOSED);
    expect(row?.actions.map((a) => a.kind)).toEqual([ComplianceActionKind.OTHER]);
  });

  it('refuses closing a suspected theft case without a police reference (BR-40 CHECK)', async () => {
    const created = await open(ComplianceCaseType.SUSPECTED_THEFT);
    const close = (authorityReference: string | null) =>
      prisma.$transaction((tx) =>
        cases.close(
          created.id,
          { outcome: 'Reported', authorityReference, closedById: staffId, at: new Date() },
          tx,
        ),
      );
    await expect(close(null)).rejects.toThrow(/compliance_cases_police_reference_to_close/);
    await expect(close('PR-2026-0042')).resolves.toBe(true);
  });
});
