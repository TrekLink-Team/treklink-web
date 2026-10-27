// Public surface of `rentals`. Other modules import only from here.
export { RentalsModule } from './rentals.module';
export {
  CONTRACT_STATUS_CHANGED,
  ContractLifecycleService,
  type ContractStatusChangedEvent,
} from './contract-lifecycle.service';
export { ContractsService, type Custody } from './contracts.service';
export { DEVICE_LABEL_CHANGED, type DeviceLabelChangedEvent } from './contract-decisions.service';
export { ALLOWED_TRANSITIONS, isAllowedTransition } from './contract-states';
export {
  CONTRACT_CLOSE_CHECKS,
  type CloseBlockingReason,
  type ContractCloseCheck,
} from './ports/contract-close-checks.port';
