import { Prisma } from '@prisma/client';

// The compliance action of a loss-case triage (REQ-EVT-14, design §3, D-045, D-046): a suspected theft
// in renter custody opens or links a compliance case. The loss-case flow reaches it through this port and
// `DevicesModule` binds `ComplianceCasesService.openOrLink` to it. The channel key exposure is a direct
// call to `ChannelKeyService.markKeyExposed` (organizations 2.9, TK-120).
export const LOSS_ORGANIZATION_ACTIONS = Symbol('LOSS_ORGANIZATION_ACTIONS');

export interface ComplianceForLoss {
  organizationId: string;
  lossCaseId: string;
  lossCaseCode: string;
  evidence: string;
  policeReference: string | null;
  actorId: string;
  actorRoles: string[];
}

export interface LossOrganizationActions {
  // The compliance case opened or linked, or null when none was.
  openOrLinkComplianceCase(
    input: ComplianceForLoss,
    tx: Prisma.TransactionClient,
  ): Promise<string | null>;
}
