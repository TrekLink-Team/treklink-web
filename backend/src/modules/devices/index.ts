// Public surface of `devices`. Other modules import only from here.
export { DevicesModule } from './devices.module';
export {
  DevicesService,
  type DeviceDetail,
  type DeviceReading,
  type FleetDevice,
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
export {
  LOSS_CASE_LISTENERS,
  type LossCaseListener,
  type LossCaseView,
  registerLossCaseListener,
} from './ports/loss-case-listener.port';
