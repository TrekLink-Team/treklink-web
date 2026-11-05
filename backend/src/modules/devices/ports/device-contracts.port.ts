import { Prisma } from '@prisma/client';

// The contract port of devices design section 12.5 (task 10.2): the device connector recognizes a unit
// by its node number and shows the contract it is on, which `devices` cannot read because `rentals`
// imports `devices` (`platform` design Figure 3). `rentals` provides the token from its global
// `RentalsPortsModule`, as it provides CUSTODY_RESOLVER.
export const DEVICE_CONTRACTS = Symbol('DEVICE_CONTRACTS');

// The live contract row of a device: not released, not replaced, not checked in and not lost.
export interface LiveDeviceContract {
  deviceId: string;
  contractId: string;
  code: string;
  status: string;
  organizationId: string;
  organizationCode: string | null;
}

export interface DeviceContracts {
  liveContractsOf(
    deviceIds: readonly string[],
    tx?: Prisma.TransactionClient,
  ): Promise<LiveDeviceContract[]>;
}
