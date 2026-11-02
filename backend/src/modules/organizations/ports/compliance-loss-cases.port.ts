import { Prisma } from '@prisma/client';

// The loss cases of a compliance case (api-design 28 to 32, D-046). Declared by `organizations`;
// `devices` provides it, because a loss case belongs to `devices` and `organizations` may not read its
// table. The token holds an array the provider adds itself to when its module starts, like
// ORGANIZATION_COUNTS; with no provider a case reports no loss cases and refuses to link one.
export const COMPLIANCE_LOSS_CASES = Symbol('COMPLIANCE_LOSS_CASES');

export interface ComplianceLossCaseProvider {
  // The loss case codes of each compliance case id, in code order; a case with none has no entry.
  codesOf(complianceCaseIds: string[]): Promise<Map<string, string[]>>;
  // Links loss cases of the organization to the compliance case, in the caller's transaction. Throws
  // 400 `VALIDATION_FAILED` when one is unknown, belongs to another organization, or is already
  // linked to another compliance case.
  link(
    complianceCaseId: string,
    organizationId: string,
    lossCaseIds: string[],
    tx: Prisma.TransactionClient,
  ): Promise<void>;
}
