import { Injectable } from '@nestjs/common';
import {
  ComplianceActionKind,
  ComplianceCaseStatus,
  ComplianceCaseType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

export const COMPLIANCE_CASE_ROW = {
  id: true,
  code: true,
  type: true,
  status: true,
  evidence: true,
  linkedContractIds: true,
  authorityReference: true,
  outcome: true,
  openedAt: true,
  organization: { select: { id: true, code: true } },
  actions: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { kind: true, actorId: true, createdAt: true },
  },
} satisfies Prisma.ComplianceCaseSelect;

export type ComplianceCaseRow = Prisma.ComplianceCaseGetPayload<{
  select: typeof COMPLIANCE_CASE_ROW;
}>;

// Compliance cases and their append-only actions (task 2.10, api-design 28 to 32, D-046).
@Injectable()
export class ComplianceCasesRepository {
  constructor(private readonly prisma: PrismaService) {}

  page(
    filter: { status?: ComplianceCaseStatus },
    skip: number,
    take: number,
    client: Client = this.prisma,
  ): Promise<[ComplianceCaseRow[], number]> {
    const where: Prisma.ComplianceCaseWhereInput = filter.status ? { status: filter.status } : {};
    return Promise.all([
      client.complianceCase.findMany({
        where,
        orderBy: [{ openedAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
        select: COMPLIANCE_CASE_ROW,
      }),
      client.complianceCase.count({ where }),
    ]);
  }

  find(id: string, client: Client = this.prisma): Promise<ComplianceCaseRow | null> {
    return client.complianceCase.findUnique({ where: { id }, select: COMPLIANCE_CASE_ROW });
  }

  // Locks the case row, so an action and a close cannot interleave.
  async lock(id: string, client: Client): Promise<ComplianceCaseRow | null> {
    await client.$queryRaw`SELECT id FROM compliance_cases WHERE id = ${id} FOR UPDATE`;
    return this.find(id, client);
  }

  // The case a loss case may join, locked as `close()` locks it: OPEN and of this organization, null
  // otherwise. A close that commits first is seen as CLOSED, and a link that holds the lock makes a close
  // wait, so a loss case is never linked to a case that closed before the link (D-046, BR-40).
  async lockOpenOf(
    id: string,
    organizationId: string,
    client: Client,
  ): Promise<ComplianceCaseRow | null> {
    const row = await this.lock(id, client);
    return row?.status === ComplianceCaseStatus.OPEN && row.organization.id === organizationId
      ? row
      : null;
  }

  // The next CMP- code: the highest numeric suffix plus one, under a transaction-scoped advisory
  // lock, so two cases opened at the same moment take consecutive codes instead of colliding.
  async nextCode(client: Client): Promise<string> {
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('compliance_cases.code'))`;
    const rows = await client.$queryRaw<{ max: number | null }[]>`
      SELECT MAX(CAST(SUBSTRING(code FROM 5) AS INTEGER)) AS max
      FROM compliance_cases WHERE code ~ '^CMP-[0-9]+$'`;
    const next = Number(rows[0]?.max ?? 0) + 1;
    return `CMP-${String(next).padStart(4, '0')}`;
  }

  create(
    data: {
      code: string;
      organizationId: string;
      type: ComplianceCaseType;
      evidence: string;
      linkedContractIds: string[];
      openedById: string;
      authorityReference?: string | null;
    },
    client: Client,
  ): Promise<ComplianceCaseRow> {
    return client.complianceCase.create({ data, select: COMPLIANCE_CASE_ROW });
  }

  // The OPEN case of one type for an organization that a loss case links to (`openOrLink`), the oldest
  // when more than one is open. An advisory lock per organization and type, held to the end of the
  // transaction, makes two triages racing for the same organization see each other's case. The case
  // row is then locked as `close()` locks it, so a close that commits first is seen as CLOSED and the
  // next open case is taken instead.
  async findOpenOfType(
    organizationId: string,
    type: ComplianceCaseType,
    client: Client,
  ): Promise<ComplianceCaseRow | null> {
    await client.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`compliance_cases.open.${organizationId}.${type}`}))`;
    for (;;) {
      const found = await client.complianceCase.findFirst({
        where: { organizationId, type, status: ComplianceCaseStatus.OPEN },
        orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      if (!found) return null;
      const locked = await this.lock(found.id, client);
      if (locked?.status === ComplianceCaseStatus.OPEN) return locked;
    }
  }

  // Records the police report reference on an OPEN case that has none; false when there was one.
  async setAuthorityReference(
    id: string,
    authorityReference: string,
    client: Client,
  ): Promise<boolean> {
    const { count } = await client.complianceCase.updateMany({
      where: { id, status: ComplianceCaseStatus.OPEN, authorityReference: null },
      data: { authorityReference },
    });
    return count > 0;
  }

  addAction(
    row: {
      caseId: string;
      kind: ComplianceActionKind;
      targetId: string | null;
      note: string;
      actorId: string;
    },
    client: Client,
  ) {
    return client.complianceAction.create({ data: row });
  }

  // Only an OPEN case; false when none was updated.
  async close(
    id: string,
    data: { outcome: string; authorityReference: string | null; closedById: string; at: Date },
    client: Client,
  ): Promise<boolean> {
    const { count } = await client.complianceCase.updateMany({
      where: { id, status: ComplianceCaseStatus.OPEN },
      data: {
        status: ComplianceCaseStatus.CLOSED,
        outcome: data.outcome,
        authorityReference: data.authorityReference,
        closedById: data.closedById,
        closedAt: data.at,
      },
    });
    return count > 0;
  }
}
