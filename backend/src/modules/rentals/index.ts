// Public surface of `rentals`. Other modules import only from here.
export { RentalsModule } from './rentals.module';
export {
  CONTRACT_STATUS_CHANGED,
  ContractLifecycleService,
  type ContractStatusChangedEvent,
} from './contract-lifecycle.service';
export {
  ContractsService,
  type Custody,
  type DeviceContractRow,
  type HolderLabel,
  type RentalPeriod,
  type VariantUtilization,
  type VisibleDevice,
} from './contracts.service';
export {
  ContractDecisionsService,
  DEVICE_LABEL_CHANGED,
  type DeviceLabelChangedEvent,
} from './contract-decisions.service';
export { TermRolloverJob, type RolloverOutcome } from './term-rollover.job';
export { rolloverTermEnd } from './rental-daily-cutoff';
export { ALLOWED_TRANSITIONS, isAllowedTransition } from './contract-states';
export {
  CONTRACT_CLOSE_CHECKS,
  type CloseBlockingReason,
  type ContractCloseCheck,
} from './ports/contract-close-checks.port';
export { DEVICE_HANDED_OVER, type DeviceHandedOverEvent } from './handover.service';
export { DEVICE_CHECKED_IN, type DeviceCheckedInEvent } from './return.service';
