import { Prisma } from '@prisma/client';

// Checks another module runs before a contract may close (specs/rentals/design.md §6). Declared by
// `rentals`, provided by `incidents` (FR-CON-13: no incident outside CLOSED on the contract's devices).
// Multi-provider: injected `@Optional()` as an array, so an unprovided port is empty (platform design
// §2.1).
export const CONTRACT_CLOSE_CHECKS = Symbol('CONTRACT_CLOSE_CHECKS');

export interface CloseBlockingReason {
  code: string;
  message: string;
  // The records that block, so the close check (rentals api-design 20) links each one; optional.
  refs?: { id: string; code: string }[];
}

export interface ContractCloseCheck {
  // `tx` is the close transaction, so the check reads what it has locked and never waits on it.
  blockingReason(
    contractId: string,
    deviceIds: readonly string[],
    tx: Prisma.TransactionClient,
  ): Promise<CloseBlockingReason | null>;
}
