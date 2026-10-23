import { Injectable } from '@nestjs/common';
import { AuthorityReport, Prisma } from '@prisma/client';

type ReportFields = Pick<
  Prisma.AuthorityReportUncheckedCreateInput,
  'agency' | 'reference' | 'reportedAt' | 'reportedById' | 'note'
>;

export type NewAuthorityReport = ReportFields &
  ({ incidentId: string; contractId?: never } | { contractId: string; incidentId?: never });

@Injectable()
export class AuthorityReportsRepository {
  // Subject exclusivity is also enforced by authority_reports_one_subject in Postgres.
  insert(data: NewAuthorityReport, tx: Prisma.TransactionClient): Promise<AuthorityReport> {
    return tx.authorityReport.create({ data });
  }
}
