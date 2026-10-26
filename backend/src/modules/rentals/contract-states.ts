import { ContractStatus } from '@prisma/client';

const S = ContractStatus;

// The D-035 lifecycle (specs/rentals/design.md §2, Figure 2): every allowed `from -> to` pair and
// nothing else. A contract is born REQUESTED by `insertRequested`, not by a transition.
export const ALLOWED_TRANSITIONS: Readonly<Record<ContractStatus, readonly ContractStatus[]>> = {
  [S.REQUESTED]: [S.APPROVED, S.REJECTED, S.CANCELLED],
  [S.APPROVED]: [S.CANCELLED, S.ACTIVE],
  [S.ACTIVE]: [S.ENDING, S.RETURN_DUE],
  [S.ENDING]: [S.RETURN_DUE],
  [S.RETURN_DUE]: [S.OVERDUE, S.RETURNED],
  [S.OVERDUE]: [S.DEFAULTED, S.RETURNED],
  [S.DEFAULTED]: [S.RETURNED],
  [S.RETURNED]: [S.CLOSED],
  [S.REJECTED]: [],
  [S.CANCELLED]: [],
  [S.CLOSED]: [],
};

export const isAllowedTransition = (from: ContractStatus, to: ContractStatus): boolean =>
  ALLOWED_TRANSITIONS[from].includes(to);

// States after which a contract holds nothing: an organization with no contract outside these may
// close (design §6, ORGANIZATION_EXIT_CHECKS).
export const FINISHED_STATES: readonly ContractStatus[] = [S.REJECTED, S.CANCELLED, S.CLOSED];
