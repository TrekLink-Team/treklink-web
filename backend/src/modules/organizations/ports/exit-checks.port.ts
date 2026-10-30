import { Prisma } from '@prisma/client';

// Checks other modules run before an organization may change status (specs/organizations/design.md
// §2 and §5, platform design §2.1). Declared by `organizations`; `rentals` provides the closing check
// (no contract that is not finished) and `billing` the reactivation check (no balance outstanding).
// Each provider answers both and returns null for the one it has no view on. The token holds an array
// the providers add themselves to when their module starts, so several modules can contribute; an
// organization with no provider is never blocked.
export const ORGANIZATION_EXIT_CHECKS = Symbol('ORGANIZATION_EXIT_CHECKS');

// Why a change is blocked: the error code the call answers with (`BALANCE_OUTSTANDING` or
// `OPEN_CONTRACTS`) and its message.
export interface ExitBlockingReason {
  code: string;
  message: string;
}

export interface OrganizationExitCheck {
  // `tx` is the transaction of the change, so a check reads what it has locked and never waits on it.
  // `at` is the time of the reactivation: what is due is judged at that time (leader ruling 2026-10-30).
  canReactivate(
    organizationId: string,
    tx: Prisma.TransactionClient,
    at: Date,
  ): Promise<ExitBlockingReason | null>;
  canClose(
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<ExitBlockingReason | null>;
}
