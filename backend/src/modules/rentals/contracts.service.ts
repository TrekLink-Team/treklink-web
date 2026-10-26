import { Injectable } from '@nestjs/common';
import { ContractStatus, Prisma } from '@prisma/client';
import { ContractsRepository } from './contracts.repository';

export interface Custody {
  contractDeviceId: string;
  contractId: string;
  organizationId: string;
  contractStatus: ContractStatus;
  // `at` lies within `marginSeconds` of the handover or of the interval's end (D-040).
  nearBoundary: boolean;
}

const near = (at: Date, edge: Date | null, marginMs: number) =>
  edge !== null && Math.abs(at.getTime() - edge.getTime()) <= marginMs;

// Contract reads and the behaviours behind the ports `rentals` provides (rentals task 1.3, design §6).
// Until `organizations` and `devices` declare ORGANIZATION_EXIT_CHECKS, CUSTODY_RESOLVER and
// LOSS_CASE_LISTENERS, these methods are not yet registered under them (treklink-docs#103, 1).
@Injectable()
export class ContractsService {
  constructor(private readonly contracts: ContractsRepository) {}

  // The custody interval containing `at`, whatever state the contract is in now; null when none does.
  async custodyAt(deviceId: string, at: Date, marginSeconds: number): Promise<Custody | null> {
    const row = await this.contracts.findCustody(deviceId, at);
    if (!row?.handedOverAt) return null;

    const end = row.checkedInAt ?? row.lostAt;
    const marginMs = marginSeconds * 1000;
    return {
      contractDeviceId: row.id,
      contractId: row.contract.id,
      organizationId: row.contract.organizationId,
      contractStatus: row.contract.status,
      nearBoundary: near(at, row.handedOverAt, marginMs) || near(at, end, marginMs),
    };
  }

  // ORGANIZATION_EXIT_CHECKS.canClose: an organization with a contract that is not REJECTED,
  // CANCELLED or CLOSED may not close.
  async canClose(organizationId: string): Promise<boolean> {
    return (await this.contracts.countUnfinishedContracts(organizationId)) === 0;
  }

  // LOSS_CASE_LISTENERS.onSettled: the row's interval ends at the loss confirmation, inside the
  // caller's transaction (REQ-EVT-12, FR-DEV-13). `onConfirmed` does nothing for rentals.
  onLossSettled(
    contractDeviceId: string,
    confirmedAt: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    return this.contracts.setLostAt(contractDeviceId, confirmedAt, tx);
  }
}
