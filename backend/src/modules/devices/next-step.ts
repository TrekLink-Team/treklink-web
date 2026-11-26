import { DeviceStatus } from '@prisma/client';

// The next step of a unit back to AVAILABLE (devices REQ-EVT-23, design §2, D-092 rule 4). A passed
// inspection moves a RETURNED unit straight to AVAILABLE (REQ-EVT-07, leader ruling 2026-11-01); the
// intake check follows only a maintenance record or a new registration.
export type NextAction = 'RESET' | 'INSPECT' | 'COMPLETE_MAINTENANCE' | 'INTAKE';

export interface NextStep {
  action: NextAction;
  // The contract whose counter records the reset and the inspection (rentals api-design 16): the
  // contract of the unit's last check-in, or the one its loss case names (D-114); null for the other
  // actions and for a unit recovered outside a contract.
  contractId: string | null;
}

export interface NextStepInput {
  status: DeviceStatus;
  // A reset logged at or after the unit became RETURNED.
  resetSinceReturn: boolean;
  openMaintenance: boolean;
  returnContractId: string | null;
}

// The contract whose counter records the reset and inspection of a unit's last return (D-114): the
// contract of a check-in (refType CONTRACT), or the contract a loss case names when the unit came back
// from that case (refType LOSS_CASE); null for a unit recovered outside a contract.
export const returnContractOf = (
  move:
    { refType: string | null; refId: string | null; lossCaseContractId: string | null } | undefined,
): string | null => {
  if (move?.refType === 'CONTRACT') return move.refId ?? null;
  if (move?.refType === 'LOSS_CASE') return move.lossCaseContractId;
  return null;
};

export const nextStepOf = (input: NextStepInput): NextStep | null => {
  switch (input.status) {
    case DeviceStatus.RETURNED:
      return {
        action: input.resetSinceReturn ? 'INSPECT' : 'RESET',
        contractId: input.returnContractId,
      };
    case DeviceStatus.MAINTENANCE:
      return {
        action: input.openMaintenance ? 'COMPLETE_MAINTENANCE' : 'INTAKE',
        contractId: null,
      };
    case DeviceStatus.IN_INTAKE:
      return { action: 'INTAKE', contractId: null };
    default:
      return null;
  }
};
