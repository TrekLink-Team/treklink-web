import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// The organization actions of a loss-case triage (REQ-EVT-14, design §3, D-045, D-046): a RENTER
// custody case exposes the organization's channel key, and a suspected theft or fraud opens or links a
// compliance case. `organizations.markKeyExposed` is in an open pull request (treklink-web#209) and
// `openOrLinkComplianceCase` is not built, so the loss-case flow reaches both through this port and
// `DevicesModule` binds the no-op default below. The case itself still records `keyExposed` and
// `suspectedTheft`. Once organizations exports the two methods, bind its provider in
// `devices.module.ts` instead of `NoOpLossOrganizationActions`.
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
  markKeyExposed(
    organizationId: string,
    lossCaseCode: string,
    tx: Prisma.TransactionClient,
  ): Promise<void>;
  // The compliance case opened or linked, or null when none was.
  openOrLinkComplianceCase(
    input: ComplianceForLoss,
    tx: Prisma.TransactionClient,
  ): Promise<string | null>;
}

// The default until organizations provides the two actions: nothing happens outside the loss case.
@Injectable()
export class NoOpLossOrganizationActions implements LossOrganizationActions {
  markKeyExposed(): Promise<void> {
    return Promise.resolve();
  }

  openOrLinkComplianceCase(): Promise<string | null> {
    return Promise.resolve(null);
  }
}
