import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CustodyResolver } from '../../devices';
import { ContractsRepository } from '../contracts.repository';
import { custodyOf } from '../contracts.service';

// Provides the devices port CUSTODY_RESOLVER (rentals task 1.3, devices design §3, D-045): the
// custody interval loss-case triage reads at the device's last seen time. The same rule as
// `ContractsService.custodyAt`.
@Injectable()
export class RentalsCustodyResolver implements CustodyResolver {
  constructor(private readonly contracts: ContractsRepository) {}

  // Reads inside the caller's transaction (`tx`), so the answer matches what that transaction writes.
  async custodyAt(deviceId: string, at: Date, tx: Prisma.TransactionClient) {
    const custody = custodyOf(await this.contracts.findCustody(deviceId, at, tx));
    if (!custody) return null;
    return {
      contractId: custody.contractId,
      organizationId: custody.organizationId,
      contractDeviceId: custody.contractDeviceId,
    };
  }
}
