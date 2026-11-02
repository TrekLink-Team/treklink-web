import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../../common/errors';
import { COMPLIANCE_LOSS_CASES, ComplianceLossCaseProvider } from '../../organizations';
import { LossCasesRepository } from '../loss-cases.repository';

// devices' provider of the organizations port COMPLIANCE_LOSS_CASES (api-design 28 to 32, D-046): the
// loss case codes a compliance case shows, and the link of loss cases to a case opened by Staff. It adds
// itself to the array of the port when the module starts; without the port (a module test) it registers
// nowhere. A triage links its own loss case through `openOrLinkComplianceCase`, not through here.
@Injectable()
export class DevicesComplianceLossCases implements ComplianceLossCaseProvider {
  constructor(
    private readonly lossCases: LossCasesRepository,
    @Optional() @Inject(COMPLIANCE_LOSS_CASES) providers?: ComplianceLossCaseProvider[],
  ) {
    providers?.push(this);
  }

  async codesOf(complianceCaseIds: string[]): Promise<Map<string, string[]>> {
    const codes = new Map<string, string[]>();
    for (const row of await this.lossCases.codesOfComplianceCases(complianceCaseIds)) {
      if (!row.complianceCaseId) continue;
      codes.set(row.complianceCaseId, [...(codes.get(row.complianceCaseId) ?? []), row.code]);
    }
    return codes;
  }

  async link(
    complianceCaseId: string,
    organizationId: string,
    lossCaseIds: string[],
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const rows = await this.lossCases.findManyForLink(lossCaseIds, tx);
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of lossCaseIds) {
      const row = byId.get(id);
      if (!row || row.organizationId !== organizationId) {
        throw this.refused('A loss case is unknown or belongs to another organization.');
      }
      if (row.complianceCaseId && row.complianceCaseId !== complianceCaseId) {
        throw this.refused('A loss case is already linked to a compliance case.');
      }
    }
    await this.lossCases.linkToComplianceCase(lossCaseIds, complianceCaseId, tx);
  }

  private refused(message: string) {
    return new DomainException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, message);
  }
}
