// Public surface of `devices`. Other modules import only from here.
export { DevicesModule } from './devices.module';
export {
  DevicesService,
  type DeviceDetail,
  type ContractMove,
  type DeviceReading,
  type FleetDevice,
  type HandoverUnit,
  type ReturnCheck,
  type ReturnState,
  type TrailEntry,
} from './devices.service';
export type {
  DeviceIdentity,
  DeviceProjection,
  DeviceTag,
  ProvisionedDevice,
  VariantSummary,
} from './devices.repository';
export { fromNodeId, toNodeId } from './node-id';
export type { NextAction, NextStep } from './next-step';
// demo module (D-088): the asset-maintenance scenario opens a record as Staff would.
export { MaintenanceService } from './maintenance.service';
export { LossCaseService, type LossCaseSummary } from './loss-cases.service';
export type { OpenMaintenanceDto } from './dto/maintenance.dto';
export {
  LOSS_CASE_LISTENERS,
  type LossCaseListener,
  type LossCaseView,
  registerLossCaseListener,
} from './ports/loss-case-listener.port';
export { CUSTODY_RESOLVER, type CustodyResolver } from './ports/custody-resolver.port';
export {
  DEVICE_CONTRACTS,
  type DeviceContracts,
  type LiveDeviceContract,
} from './ports/device-contracts.port';
export {
  DeviceConnectorService,
  type DockedUnit,
  type DockedUnitWithContract,
  type RecognizedUnit,
} from './dock/device-connector.service';
export {
  DEVICE_DOCKED,
  DEVICE_UNDOCKED,
  type DeviceDockedEvent,
  type DeviceUndockedEvent,
} from './dock/dock-events';
export {
  LOSS_ORGANIZATION_ACTIONS,
  type ComplianceForLoss,
  type LossOrganizationActions,
} from './ports/loss-organization-actions.port';
