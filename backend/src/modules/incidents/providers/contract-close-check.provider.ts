import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CloseBlockingReason, ContractCloseCheck } from '../../rentals';
import { IncidentsRepository } from '../incidents.repository';

// incidents' provider of the rentals port CONTRACT_CLOSE_CHECKS (rentals design §6, FR-CON-13,
// rentals api-design 17, AC-06): a contract does not close while an incident on it or on one of its
// devices is not CLOSED (MSG29). It reads in the close transaction rentals passes.
@Injectable()
export class IncidentsCloseCheck implements ContractCloseCheck {
  constructor(private readonly incidents: IncidentsRepository) {}

  async blockingReason(
    contractId: string,
    deviceIds: readonly string[],
    tx: Prisma.TransactionClient,
  ): Promise<CloseBlockingReason | null> {
    const open = await this.incidents.openFor(contractId, deviceIds, tx);
    return open.length > 0
      ? {
          code: 'OPEN_INCIDENTS',
          message: 'This cannot be done while it has open incidents.',
          refs: open,
        }
      : null;
  }
}
