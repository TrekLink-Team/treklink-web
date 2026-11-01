import { DeviceStatus } from '@prisma/client';

// The next step of a unit back to AVAILABLE (devices REQ-EVT-23, design §2, D-092 rule 4). A passed
// inspection moves a RETURNED unit straight to AVAILABLE (REQ-EVT-07, leader ruling 2026-11-01); the
// intake check follows only a maintenance record or a new registration.
export type NextAction = 'RESET' | 'INSPECT' | 'COMPLETE_MAINTENANCE' | 'INTAKE';

export interface NextStep {
  action: NextAction;
  // The contract whose counter records the reset and the inspection (rentals api-design 16): the
  // contract of the unit's last check-in; null for the other actions and for a unit recovered outside
  // a contract.
  contractId: string | null;
}

export interface NextStepInput {
  status: DeviceStatus;
  // A reset logged at or after the unit became RETURNED.
  resetSinceReturn: boolean;
  openMaintenance: boolean;
  returnContractId: string | null;
}

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
