export const CONTRACT_REQUESTED = 'contract.requested';
export const DEVICE_FAULT_REPORTED = 'device.faultReported';

export interface ContractRequestedEvent {
  contractId: string;
  organizationId: string;
}

export interface DeviceFaultReportedEvent extends ContractRequestedEvent {
  reportId: string;
  deviceId: string;
}
