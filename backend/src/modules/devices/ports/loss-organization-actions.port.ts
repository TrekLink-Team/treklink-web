import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// The compliance action of a loss-case triage (REQ-EVT-14, design §3, D-045, D-046): a suspected theft
// or fraud in renter custody opens or links a compliance case. `openOrLinkComplianceCase` is not built in
// organizations yet, so the loss-case flow reaches it through this port and `DevicesModule` binds the
// no-op default below; the case itself still records `suspectedTheft`. Once organizations exports the
// method, bind its provider in `devices.module.ts` instead of `NoOpLossOrganizationActions`. The channel
// key exposure is a direct call to `ChannelKeyService.markKeyExposed` (organizations 2.9, TK-120).
export const LOSS_ORGANIZATION_ACTIONS = Symbol('LOSS_ORGANIZATION_ACTIONS');

export interface ComplianceForLoss {
  organizationId: string;
  lossCaseId: string;
  lossCaseCode: string;
  evidence: string;
  policeReference: string | null;
  actorId: string;
}

export interface LossOrganizationActions {
  // The compliance case opened or linked, or null when none was.
  openOrLinkComplianceCase(
    input: ComplianceForLoss,
    tx: Prisma.TransactionClient,
  ): Promise<string | null>;
}

// The default until organizations provides the action: nothing happens outside the loss case.
@Injectable()
export class NoOpLossOrganizationActions implements LossOrganizationActions {
  openOrLinkComplianceCase(): Promise<string | null> {
    return Promise.resolve(null);
  }
}
