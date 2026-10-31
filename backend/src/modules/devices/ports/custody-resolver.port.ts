import { Prisma } from '@prisma/client';

// The custody port of devices design §3 (task 1.4): the loss-case flow (task 2.7) asks who has
// custody of a device without `devices` importing `rentals`, because `rentals` already imports
// `devices` (`platform` design Figure 3) and a reverse import would cycle. `rentals` provides the
// token from its global `RentalsPortsModule` (`RentalsCustodyResolver`, rentals task 1.3), with the
// rule of `ContractsService.custodyAt`.
//
// The caller passes its transaction, so the custody read runs on the same connection as the
// report or triage write and sees a check-in that committed before the read.
//
// `devices` injects it required, so Nest refuses to boot without a provider:
//
//   constructor(@Inject(CUSTODY_RESOLVER) private readonly custody: CustodyResolver) {}
export const CUSTODY_RESOLVER = Symbol('CUSTODY_RESOLVER');

// The custody interval at a point in time, or null when no interval contains it (TREKLINK custody).
export interface CustodyResolver {
  custodyAt(
    deviceId: string,
    at: Date,
    tx: Prisma.TransactionClient,
  ): Promise<{ contractId: string; organizationId: string; contractDeviceId: string } | null>;
}
