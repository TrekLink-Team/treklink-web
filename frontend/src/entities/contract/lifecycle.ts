import type { Contract, ContractStatus, ContractTransition } from './api';
import { STATUS_LABELS } from './api';

// The contract lifecycle as the contract home draws it (chapter 06 §10.4, D-096), generated from the
// rentals state machine (specs/rentals/design.md §2, D-035), never from sample data. The main path
// is the happy path of the plan; REJECTED and CANCELLED leave it for good, OVERDUE and DEFAULTED
// are a detour after RETURN_DUE that can still end in RETURNED. Exits are drawn as branch markers on
// the step they left from.

export const MONTHLY_PATH: readonly ContractStatus[] = [
  'REQUESTED',
  'APPROVED',
  'ACTIVE',
  'ENDING',
  'RETURN_DUE',
  'RETURNED',
  'CLOSED',
];

// A day plan moves from ACTIVE to RETURN_DUE when it ends; it has no notice (rentals design §2).
export const DAY_PATH: readonly ContractStatus[] = [
  'REQUESTED',
  'APPROVED',
  'ACTIVE',
  'RETURN_DUE',
  'RETURNED',
  'CLOSED',
];

/** States off the main path: terminal exits and the overdue detour. */
export const EXIT_STATES: readonly ContractStatus[] = [
  'REJECTED',
  'CANCELLED',
  'OVERDUE',
  'DEFAULTED',
];
const TERMINAL_EXITS: readonly ContractStatus[] = ['REJECTED', 'CANCELLED'];

/** What moves a contract into each state (rentals design §2, the trigger column). */
export const STEP_HINTS: Record<ContractStatus, string> = {
  REQUESTED: 'Manager requests, devices held',
  APPROVED: 'Staff approve',
  REJECTED: 'Staff reject',
  CANCELLED: 'Cancelled, or the unpaid hold expired',
  ACTIVE: 'First payment and handover signed',
  ENDING: 'Monthly notice given',
  RETURN_DUE: 'Plan or term ends',
  OVERDUE: 'Grace elapsed, devices out',
  DEFAULTED: 'Default threshold elapsed',
  RETURNED: 'Every device back or lost',
  CLOSED: 'Nothing owed, no open incident',
};

export type StepState = 'done' | 'current' | 'todo' | 'skipped';

export interface LifecycleExit {
  status: ContractStatus;
  label: string;
  at: string | null;
  /** True while the contract is in this state. */
  current: boolean;
}

export interface LifecycleStep {
  status: ContractStatus;
  label: string;
  state: StepState;
  /** When the contract entered this step, where known. */
  at: string | null;
  /** Exits taken from this step, in order. */
  exits: LifecycleExit[];
}

export interface Lifecycle {
  steps: LifecycleStep[];
  /** The index of the step the contract is on, or left the path from. */
  index: number;
}

/** When the contract last entered each state, from the history (rentals api-design 18). */
const enteredAt = (history: readonly ContractTransition[]) => {
  const at = new Map<ContractStatus, string>();
  history.forEach((step) => {
    const known = at.get(step.toStatus);
    if (!known || known < step.createdAt) at.set(step.toStatus, step.createdAt);
  });
  return at;
};

/** The step a contract left the path from, for each exit state. */
const exitStepOf = (
  status: ContractStatus,
  contract: Pick<Contract, 'handoverAppointmentAt'>,
  history: readonly ContractTransition[],
): ContractStatus => {
  if (status === 'REJECTED') return 'REQUESTED';
  if (status === 'OVERDUE' || status === 'DEFAULTED') return 'RETURN_DUE';
  // CANCELLED leaves from REQUESTED or APPROVED: the history says which; without it (an Org Operator
  // cannot read it) a handover appointment means the request was approved.
  const from = [...history].reverse().find((step) => step.toStatus === 'CANCELLED')?.fromStatus;
  if (from === 'REQUESTED' || from === 'APPROVED') return from;
  return contract.handoverAppointmentAt ? 'APPROVED' : 'REQUESTED';
};

export const lifecyclePath = (contract: Pick<Contract, 'planType'>): readonly ContractStatus[] =>
  contract.planType === 'DAY' ? DAY_PATH : MONTHLY_PATH;

/**
 * The steps of one contract: done, current, still to come, or not reached after a terminal exit,
 * each with the date it was entered and the exits taken from it.
 */
export const lifecycleOf = (
  contract: Pick<
    Contract,
    | 'planType'
    | 'status'
    | 'statusChangedAt'
    | 'handedOverAt'
    | 'noticeGivenAt'
    | 'handoverAppointmentAt'
  >,
  history: readonly ContractTransition[] = [],
): Lifecycle => {
  const path = lifecyclePath(contract);
  const at = enteredAt(history);
  // Dates the contract itself carries, for a reader without the history.
  if (contract.handedOverAt && !at.has('ACTIVE')) at.set('ACTIVE', contract.handedOverAt);
  if (contract.noticeGivenAt && !at.has('ENDING')) at.set('ENDING', contract.noticeGivenAt);
  if (!at.has(contract.status)) at.set(contract.status, contract.statusChangedAt);

  const status = contract.status;
  const onExit = EXIT_STATES.includes(status);
  const terminal = TERMINAL_EXITS.includes(status);
  const exitStep = onExit ? exitStepOf(status, contract, history) : null;
  const index = exitStep !== null ? path.indexOf(exitStep) : path.indexOf(status);

  // Exits shown on a step: the current one, and an overdue detour the contract came back from.
  const exitsAt = (step: ContractStatus): LifecycleExit[] => {
    const exits: LifecycleExit[] = [];
    const add = (exit: ContractStatus) =>
      exits.push({
        status: exit,
        label: STATUS_LABELS[exit],
        at: at.get(exit) ?? null,
        current: exit === status,
      });
    if (step === 'RETURN_DUE') {
      if (at.has('OVERDUE') || status === 'OVERDUE' || status === 'DEFAULTED') add('OVERDUE');
      if (at.has('DEFAULTED') || status === 'DEFAULTED') add('DEFAULTED');
    }
    if (terminal && step === exitStep) add(status);
    return exits;
  };

  const steps = path.map((step, position): LifecycleStep => {
    let state: StepState;
    if (status === 'CLOSED') state = 'done';
    else if (terminal) state = position <= index ? 'done' : 'skipped';
    else if (onExit) state = position <= index ? 'done' : 'todo';
    else state = position < index ? 'done' : position === index ? 'current' : 'todo';
    return {
      status: step,
      label: STATUS_LABELS[step],
      state,
      at: state === 'done' || state === 'current' ? (at.get(step) ?? null) : null,
      exits: exitsAt(step),
    };
  });

  return { steps, index: index < 0 ? 0 : index };
};

/** The readable line of one history entry (the History tab). */
export const TRANSITION_LABELS: Record<ContractStatus, string> = {
  REQUESTED: 'Request sent, devices held',
  APPROVED: 'Request approved',
  REJECTED: 'Request rejected',
  CANCELLED: 'Contract cancelled',
  ACTIVE: 'Handover signed, contract active',
  ENDING: 'Notice given, ends at term end',
  RETURN_DUE: 'Return due',
  OVERDUE: 'Return overdue',
  // A transition records the contract only; the organization's status is not part of it.
  DEFAULTED: 'Contract defaulted',
  RETURNED: 'Every unit back or recorded lost',
  CLOSED: 'Contract closed',
};

/** Reason codes the server writes for SYSTEM transitions (rentals design §2 and §5). */
export const REASON_LABELS: Record<string, string> = {
  HOLD_EXPIRED: 'The unpaid hold expired',
  LOST: 'The last unit out was recorded lost',
};

export const transitionLine = (step: ContractTransition): string => {
  const base = TRANSITION_LABELS[step.toStatus];
  if (step.toStatus === 'CANCELLED' && step.reason === 'HOLD_EXPIRED')
    return 'Request cancelled, the unpaid hold expired';
  return base;
};
