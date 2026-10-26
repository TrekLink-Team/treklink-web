// Checks another module runs before a contract may close (specs/rentals/design.md §6). Declared by
// `rentals`, provided by `incidents` (FR-CON-13: no incident outside CLOSED on the contract's devices).
// Multi-provider: injected `@Optional()` as an array, so an unprovided port is empty (platform design
// §2.1).
export const CONTRACT_CLOSE_CHECKS = Symbol('CONTRACT_CLOSE_CHECKS');

export interface CloseBlockingReason {
  code: string;
  message: string;
}

export interface ContractCloseCheck {
  blockingReason(
    contractId: string,
    deviceIds: readonly string[],
  ): Promise<CloseBlockingReason | null>;
}
