import type { Invoice } from '../../entities/billing/api';
import type { CloseCheck, ContractDetail } from '../../entities/contract/api';
import { formatDateTime } from '../../shared/lib/format';

// What the contract home offers each viewer in each state (chapter 06 §10.4, D-096): one primary
// action, the rest in More actions with the reason when one is unavailable, destructive ones last
// behind a Dialog. The states and who may act come from specs/rentals/design.md §2 and screen 5.2
// (specs/frontend/ui-design/5-2-contractdetailpage-and-contract-lists.md); the server re-checks every
// action.

export type Viewer = 'staff' | 'manager' | 'operator';
export type HomeMode = 'review' | 'handover' | null;

export type ActionKey =
  | 'review'
  | 'approve'
  | 'leave'
  | 'reject'
  | 'cancel'
  | 'handover'
  | 'counter'
  | 'close'
  | 'notice'
  | 'end'
  | 'pay';

export interface HomeAction {
  key: ActionKey;
  label: string;
  /** Why the action cannot run now; shown as text, the control stays visible. */
  reason?: string;
  destructive?: boolean;
}

export interface HomeActions {
  primary: HomeAction | null;
  /** Shown in place of a primary action when nothing is due from this viewer. */
  idle: string | null;
  more: HomeAction[];
}

export interface PolicyInput {
  contract: Pick<ContractDetail, 'status' | 'planType' | 'devices'>;
  viewer: Viewer;
  mode: HomeMode;
  /** rentals api-design 20, Staff only. */
  closeCheck?: CloseCheck;
  /** An invoice of this contract with something left to pay, for the Org Manager (billing 08). */
  openInvoiceId?: string | null;
  /** What is due now on the contract (billing api-design 10); Pay is offered only when it is above 0. */
  dueNowVnd?: number;
  /**
   * What is left to pay on the deposit, the first line of the term 1 invoice (billing api-design 09).
   * The deposit falls due at the hold expiry, not before, so a request offers Pay deposit while it is
   * above 0 even with nothing due now (rentals design §2.1, billing design §4, D-092 rule 1).
   */
  depositUnpaidVnd?: number;
}

const OUT_STATES = ['RETURN_DUE', 'OVERDUE', 'DEFAULTED'];

// End now (D-097, rentals design §12): Staff and the Org Manager, ACTIVE or ENDING, destructive and
// last in More actions; it never takes the primary slot.
const END_NOW: HomeAction = { key: 'end', label: 'End contract now', destructive: true };

const unitsOut = (contract: PolicyInput['contract']) =>
  contract.devices.filter((device) => device.handedOverAt && !device.checkedInAt && !device.lostAt)
    .length;

const closeReason = (input: PolicyInput): string | undefined => {
  const check = input.closeCheck;
  if (check?.canClose) return undefined;
  if (check && check.blockers.length > 0) return check.blockers[0].message;
  const out = unitsOut(input.contract);
  if (out > 0) return `${out} ${out === 1 ? 'unit is' : 'units are'} still out`;
  return check ? undefined : 'Checking what blocks the close';
};

/** Destructive actions go last (§9.6 rule 3, §10.4). */
const ordered = (more: HomeAction[]) => [
  ...more.filter((action) => !action.destructive),
  ...more.filter((action) => action.destructive),
];

export const homeActions = (input: PolicyInput): HomeActions => {
  const { contract, viewer, mode } = input;
  const status = contract.status;
  const leave: HomeAction = {
    key: 'leave',
    label: mode === 'review' ? 'Leave review mode' : 'Leave handover',
  };

  if (viewer === 'staff') {
    switch (status) {
      case 'REQUESTED':
        return {
          primary:
            mode === 'review'
              ? { key: 'approve', label: 'Approve request' }
              : { key: 'review', label: 'Review request' },
          idle: null,
          more: ordered([
            ...(mode === 'review' ? [leave] : []),
            { key: 'reject', label: 'Reject request', destructive: true },
            { key: 'cancel', label: 'Cancel request', destructive: true },
          ]),
        };
      case 'APPROVED':
        return {
          primary: mode === 'handover' ? null : { key: 'handover', label: 'Start handover' },
          idle: mode === 'handover' ? 'Back and Next below move through the four steps' : null,
          more: ordered([
            ...(mode === 'handover' ? [leave] : []),
            { key: 'cancel', label: 'Cancel contract', destructive: true },
          ]),
        };
      case 'ACTIVE':
      case 'ENDING':
        return {
          primary: null,
          idle: 'No action due from TrekLink Staff',
          more: ordered([{ key: 'counter', label: 'Open the counter' }, END_NOW]),
        };
      case 'RETURN_DUE':
      case 'OVERDUE':
      case 'DEFAULTED':
        return {
          primary: { key: 'counter', label: 'Record return' },
          idle: null,
          more: [
            {
              key: 'close',
              label: 'Close contract',
              reason: closeReason(input) ?? 'Only a returned contract closes',
            },
          ],
        };
      case 'RETURNED':
        return {
          primary: { key: 'close', label: 'Close contract', reason: closeReason(input) },
          idle: null,
          more: [{ key: 'counter', label: 'Open the counter' }],
        };
      default:
        return { primary: null, idle: 'No further steps', more: [] };
    }
  }

  if (viewer === 'manager') {
    // An open invoice whose lines are not due yet (a paid deposit, the term balance due at handover)
    // gives no Pay action; the balance says what is due now.
    const payable =
      Boolean(input.openInvoiceId) &&
      (status === 'REQUESTED' && input.depositUnpaidVnd !== undefined
        ? input.depositUnpaidVnd > 0
        : input.dueNowVnd === undefined || input.dueNowVnd > 0);
    const pay: HomeAction = { key: 'pay', label: status === 'REQUESTED' ? 'Pay deposit' : 'Pay invoice' };
    switch (status) {
      case 'REQUESTED':
        return {
          primary: payable ? pay : null,
          idle: payable ? null : 'TrekLink Staff review the request',
          more: [{ key: 'cancel', label: 'Cancel request', destructive: true }],
        };
      // Screen 5.2, "Later states: Pay invoice while something is due now": an approved contract whose
      // deposit fell due before the handover offers Pay invoice (treklink-web#488).
      case 'APPROVED':
        return {
          primary: payable ? pay : null,
          idle: payable ? null : 'Collect the units at the TrekLink counter',
          more: [{ key: 'cancel', label: 'Cancel contract', destructive: true }],
        };
      case 'ACTIVE': {
        const notice: HomeAction | null =
          contract.planType === 'MONTHLY' ? { key: 'notice', label: 'Give notice' } : null;
        if (payable)
          return { primary: pay, idle: null, more: ordered([...(notice ? [notice] : []), END_NOW]) };
        // Nothing to pay: no Pay at all, not a disabled one (review of treklink-web#350).
        return notice
          ? { primary: notice, idle: null, more: [END_NOW] }
          : { primary: null, idle: 'Return the units when the day plan ends', more: [END_NOW] };
      }
      case 'ENDING':
        return payable
          ? { primary: pay, idle: null, more: [END_NOW] }
          : { primary: null, idle: 'Return the units at the TrekLink counter', more: [END_NOW] };
      default:
        if (payable) return { primary: pay, idle: null, more: [] };
        return {
          primary: null,
          idle:
            OUT_STATES.includes(status)
              ? 'Return the units at the TrekLink counter'
              : status === 'RETURNED'
                ? 'TrekLink Staff close the contract'
                : 'No further steps',
          more: [],
        };
    }
  }

  // An Org Operator reads the contract and labels holders on the Devices tab (screen 5.2).
  return { primary: null, idle: 'Your role reads this contract', more: [] };
};

/** The Next step line of the lifecycle card: who acts, and what. */
export const nextStepOf = (
  contract: Pick<
    ContractDetail,
    | 'status'
    | 'planType'
    | 'quantity'
    | 'holdExpiresAt'
    | 'handoverAppointmentAt'
    | 'currentTerm'
    | 'endsAt'
    | 'returnDueAt'
    | 'devices'
  >,
  viewer: Viewer,
): { actor: string; text: string } => {
  const org =
    viewer === 'staff'
      ? 'Organization Manager'
      : viewer === 'manager'
        ? 'You'
        : 'Organization Manager';
  const staff = 'TrekLink Staff';
  const when = (iso: string | null | undefined) => (iso ? formatDateTime(iso) : null);
  const out = unitsOut(contract);
  const units = (count: number) => `${count} ${count === 1 ? 'unit' : 'units'}`;
  switch (contract.status) {
    case 'REQUESTED': {
      const hold = when(contract.holdExpiresAt);
      return viewer === 'staff'
        ? {
            actor: staff,
            text: `Review the request${hold ? ` before the hold expires on ${hold}` : ''}.`,
          }
        : {
            actor: org,
            text: `Pay the deposit${hold ? ` before the hold expires on ${hold}` : ''}. TrekLink Staff then review the request.`,
          };
    }
    case 'APPROVED': {
      const appointment = when(contract.handoverAppointmentAt);
      return viewer === 'staff'
        ? {
            actor: staff,
            text: `Hand over ${units(contract.quantity)} at the counter${appointment ? ` on ${appointment}` : ''}.`,
          }
        : {
            actor: org,
            text: `Collect ${units(contract.quantity)} at the TrekLink counter${appointment ? ` on ${appointment}` : ''}.`,
          };
    }
    case 'ACTIVE':
      if (contract.planType === 'DAY')
        return {
          actor: org,
          text: `Return the units when the day plan ends${when(contract.endsAt) ? ` on ${when(contract.endsAt)}` : ''}.`,
        };
      // MSG18: notice ends the contract when the current term ends.
      return {
        actor: org,
        text: `Give notice to end the contract when the current term ends${when(contract.currentTerm?.endsAt) ? ` on ${when(contract.currentTerm?.endsAt)}` : ''}.`,
      };
    case 'ENDING':
      return {
        actor: org,
        text: `Return all units to the counter when the term ends${when(contract.endsAt) ? ` on ${when(contract.endsAt)}` : ''}.`,
      };
    case 'RETURN_DUE':
      return {
        actor: staff,
        text: `Check in each unit as it comes back. ${units(out)} still out.`,
      };
    case 'OVERDUE':
      return {
        actor: viewer === 'staff' ? staff : org,
        text: `The return was due${when(contract.returnDueAt) ? ` on ${when(contract.returnDueAt)}` : ''}. ${units(out)} still out.`,
      };
    case 'DEFAULTED':
      // No claim about the organization: the contract detail carries no organization status, and a
      // default suspends only an ACTIVE organization when the overdue-and-default job moves the
      // contract (organizations.service.ts suspendForDefault). The demo seed defaults RC-2026-0003
      // and keeps ORG-0001 ACTIVE.
      return {
        actor: staff,
        text: `Recover the ${units(out)} still out or record them lost.`,
      };
    case 'RETURNED':
      return {
        actor: staff,
        text: 'Close the contract once nothing is owed and no incident is open.',
      };
    default:
      return { actor: 'No one', text: 'No further steps.' };
  }
};

/** The deadline chip of the header: a label and the instant it names. */
export const deadlineOf = (
  contract: Pick<
    ContractDetail,
    | 'status'
    | 'holdExpiresAt'
    | 'handoverAppointmentAt'
    | 'reservationExpiresAt'
    | 'currentTerm'
    | 'endsAt'
    | 'returnDueAt'
    | 'statusChangedAt'
  >,
): { label: string; at: string } | null => {
  switch (contract.status) {
    case 'REQUESTED':
      return contract.holdExpiresAt ? { label: 'Hold expires', at: contract.holdExpiresAt } : null;
    case 'APPROVED':
      if (contract.handoverAppointmentAt)
        return { label: 'Handover appointment', at: contract.handoverAppointmentAt };
      return contract.reservationExpiresAt
        ? { label: 'Reservation expires', at: contract.reservationExpiresAt }
        : null;
    case 'ACTIVE':
      if (contract.currentTerm)
        return { label: `Term ${contract.currentTerm.seq} ends`, at: contract.currentTerm.endsAt };
      return contract.endsAt ? { label: 'Plan ends', at: contract.endsAt } : null;
    case 'ENDING':
      return contract.endsAt ? { label: 'Ends, notice given', at: contract.endsAt } : null;
    case 'RETURN_DUE':
    case 'OVERDUE':
    case 'DEFAULTED':
      return contract.returnDueAt ? { label: 'Return due', at: contract.returnDueAt } : null;
    case 'RETURNED':
      return { label: 'Returned on', at: contract.statusChangedAt };
    case 'CLOSED':
      return { label: 'Closed on', at: contract.statusChangedAt };
    case 'REJECTED':
      return { label: 'Rejected on', at: contract.statusChangedAt };
    case 'CANCELLED':
      return { label: 'Cancelled on', at: contract.statusChangedAt };
    default:
      return null;
  }
};

/** An invoice with something left to pay, the target of Pay invoice and Pay deposit. */
export const openInvoiceOf = (invoices: readonly Invoice[] | undefined): Invoice | undefined =>
  invoices
    ?.filter((invoice) => invoice.paidVnd < invoice.totalVnd)
    .slice()
    .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))[0];
