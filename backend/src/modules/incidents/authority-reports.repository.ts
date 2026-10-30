import { Injectable } from '@nestjs/common';
import { AuthorityReport, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type ReportFields = Pick<
  Prisma.AuthorityReportUncheckedCreateInput,
  'agency' | 'reference' | 'reportedAt' | 'reportedById' | 'note'
>;

export type NewAuthorityReport = ReportFields &
  ({ incidentId: string; contractId?: never } | { contractId: string; incidentId?: never });

// The columns of api-design 11.
const LIST_FIELDS = {
  id: true,
  incidentId: true,
  contractId: true,
  agency: true,
  reference: true,
  reportedAt: true,
  caseClosedAt: true,
} as const satisfies Prisma.AuthorityReportSelect;

export type AuthorityReportRow = Prisma.AuthorityReportGetPayload<{ select: typeof LIST_FIELDS }>;

@Injectable()
export class AuthorityReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Subject exclusivity is also enforced by authority_reports_one_subject in Postgres.
  insert(data: NewAuthorityReport, tx: Prisma.TransactionClient): Promise<AuthorityReport> {
    return tx.authorityReport.create({ data });
  }

  // Serialises two Staff closing the same case: the second waits here and then reads caseClosedAt.
  async lockById(id: string, tx: Prisma.TransactionClient): Promise<AuthorityReport | null> {
    const rows = await tx.$queryRaw<
      AuthorityReport[]
    >`SELECT * FROM "authority_reports" WHERE "id" = ${id} FOR UPDATE`;
    return rows[0] ?? null;
  }

  closeCase(
    id: string,
    caseClosedAt: Date,
    caseClosedById: string,
    tx: Prisma.TransactionClient,
  ): Promise<AuthorityReport> {
    return tx.authorityReport.update({ where: { id }, data: { caseClosedAt, caseClosedById } });
  }

  // Reports on the incident whose case is still open. The caller holds the incident row lock, so a
  // closure of another report on it committed before this count runs, or waits for this transaction.
  countOpenOnIncident(incidentId: string, tx: Prisma.TransactionClient): Promise<number> {
    return tx.authorityReport.count({ where: { incidentId, caseClosedAt: null } });
  }

  // Newest report first; the id breaks ties so pages never overlap.
  page(
    where: Prisma.AuthorityReportWhereInput,
    skip: number,
    take: number,
  ): Promise<[AuthorityReportRow[], number]> {
    return Promise.all([
      this.prisma.authorityReport.findMany({
        where,
        orderBy: [{ reportedAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
        select: LIST_FIELDS,
      }),
      this.prisma.authorityReport.count({ where }),
    ]);
  }
}
