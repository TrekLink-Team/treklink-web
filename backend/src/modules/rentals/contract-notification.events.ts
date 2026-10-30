export const CONTRACT_REQUESTED = 'contract.requested';

export interface ContractRequestedEvent {
  contractId: string;
  organizationId: string;
}
