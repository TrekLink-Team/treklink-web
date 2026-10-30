import { Injectable } from '@nestjs/common';
import { CustodyResolver } from '../../devices';
import { ContractsRepository } from '../contracts.repository';
import { custodyOf } from '../contracts.service';

// Provides the devices port CUSTODY_RESOLVER (rentals task 1.3, devices design §3, D-045): the
// custody interval loss-case triage reads at the device's last seen time. The same rule as
// `ContractsService.custodyAt`, with no margin, because triage has no use for `nearBoundary`.
@Injectable()
export class RentalsCustodyResolver implements CustodyResolver {
  constructor(private readonly contracts: ContractsRepository) {}

  async custodyAt(deviceId: string, at: Date) {
    const custody = custodyOf(await this.contracts.findCustody(deviceId, at), at, 0);
    if (!custody) return null;
    return {
      contractId: custody.contractId,
      organizationId: custody.organizationId,
      contractDeviceId: custody.contractDeviceId,
    };
  }
}
