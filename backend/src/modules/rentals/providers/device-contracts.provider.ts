import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DeviceContracts, LiveDeviceContract } from '../../devices';
import { OrganizationsService } from '../../organizations';
import { ContractsRepository } from '../contracts.repository';

// Provides the devices port DEVICE_CONTRACTS (rentals task 10.1, devices design section 11.5): the live
// contract row of each unit the device connector recognizes, with the organization code to show.
@Injectable()
export class RentalsDeviceContracts implements DeviceContracts {
  constructor(
    private readonly contracts: ContractsRepository,
    private readonly organizations: OrganizationsService,
  ) {}

  async liveContractsOf(
    deviceIds: readonly string[],
    tx?: Prisma.TransactionClient,
  ): Promise<LiveDeviceContract[]> {
    if (deviceIds.length === 0) return [];
    const rows = await this.contracts.liveContractsOfDevices(deviceIds, tx);
    const labels = await this.organizations.labelsOf(
      rows.map((row) => row.contract.organizationId),
      tx,
    );
    return rows.map((row) => ({
      deviceId: row.deviceId,
      contractId: row.contract.id,
      code: row.contract.code,
      status: row.contract.status,
      organizationId: row.contract.organizationId,
      organizationCode: labels.get(row.contract.organizationId)?.code ?? null,
    }));
  }
}
