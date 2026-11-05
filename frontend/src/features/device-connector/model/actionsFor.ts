import type { Connection } from './ConnectorRegistry';
import type { ConnectorContext, CounterRow } from './connectorStore';

// The actions a connected unit allows on this page (devices design section 12.3, REQ-EVT-34): one pure
// function over the unit's recognition and the page context, so every row and the device view agree.
// A unit with no action carries the reason as text.

export type UnitAction =
  | { kind: 'register' }
  | { kind: 'provision'; row: CounterRow }
  | { kind: 'swap'; rows: CounterRow[] }
  | { kind: 'uplink' }
  | { kind: 'flash'; disabledReason: string | null }
  | { kind: 'link'; label: string; to: string };

export interface UnitActions {
  actions: UnitAction[];
  // Why the unit allows nothing here, or why the counter actions do not apply to it.
  reason: string | null;
}

const NONE: UnitActions = { actions: [], reason: null };

// The reason Update firmware is unavailable while no flash panel is registered (devices design section 9.2,
// task 8.3, which publishes the releases and supplies the panel). Shown as text (chapter 06 §9.8).
export const FLASH_NOT_BUILT = 'Firmware releases are not published yet';

export const actionsFor = (
  connection: Connection,
  context: ConnectorContext | null,
  can: { register: boolean; operate: boolean; flash?: boolean },
): UnitActions => {
  if (connection.state !== 'ready' || !connection.unit) return NONE;
  const recognized = connection.recognized;
  const device = recognized?.device ?? null;
  if (!device) {
    return can.register
      ? { actions: [{ kind: 'register' }], reason: null }
      : { actions: [], reason: 'This unit is not registered.' };
  }
  const devicePage: UnitAction = { kind: 'link', label: 'Open device page', to: `/t/devices/${device.id}` };
  const contract = recognized?.contract ?? null;
  const counter = context?.kind === 'counter' ? context : null;
  const onThisContract = counter !== null && contract?.id === counter.contractId;
  const actions: UnitAction[] = [];
  let reason: string | null = null;

  const uplinkAllowed =
    can.operate && device.status !== 'RETIRED' && device.status !== 'DISPOSED';
  switch (device.status) {
    case 'IN_INTAKE':
      actions.push({ kind: 'link', label: 'Record intake check', to: `/t/devices/${device.id}` });
      break;
    case 'AVAILABLE': {
      if (uplinkAllowed) actions.push({ kind: 'uplink' });
      if (counter) {
        const swappable = counter.rows.filter((row) => row.provisionedKeyVersion === null);
        if (counter.status !== 'APPROVED') {
          reason = `${counter.contractCode} is not approved.`;
        } else if (device.hardwareVariant.code !== counter.variantCode) {
          reason = `${device.assetTag} is ${device.hardwareVariant.code}; ${counter.contractCode} rents ${counter.variantCode}.`;
        } else if (swappable.length === 0) {
          reason = `Every reserved unit of ${counter.contractCode} is provisioned; only units not provisioned can be swapped out.`;
        } else if (can.operate) {
          actions.unshift({ kind: 'swap', rows: swappable });
        }
      }
      break;
    }
    case 'RESERVED': {
      if (onThisContract && counter) {
        const row = counter.rows.find((candidate) => candidate.deviceId === device.id);
        if (row && can.operate) {
          if (row.provisionedKeyVersion === null || row.provisionedKeyVersion !== counter.keyVersion) {
            actions.push({ kind: 'provision', row });
          } else {
            reason = `Provisioned v${row.provisionedKeyVersion}.`;
          }
        }
      } else if (contract) {
        reason = `${device.assetTag} is reserved to ${contract.code}.`;
        actions.push({ kind: 'link', label: 'Open its counter', to: `/t/counter/${contract.id}` });
      }
      if (uplinkAllowed) actions.push({ kind: 'uplink' });
      break;
    }
    case 'RENTED':
      if (contract) {
        reason = `${device.assetTag} is rented on ${contract.code}. Check it in at the return counter.`;
        actions.push({ kind: 'link', label: 'Open its counter', to: `/t/counter/${contract.id}` });
      }
      break;
    case 'RETURNED':
      if (contract) {
        actions.push({ kind: 'link', label: 'Open its counter', to: `/t/counter/${contract.id}` });
      }
      break;
    case 'MAINTENANCE':
      if (device.openMaintenance?.reason === 'FIRMWARE_UPDATE' && device.openMaintenance.status === 'OPEN') {
        actions.push({
          kind: 'flash',
          disabledReason: can.operate && can.flash ? null : FLASH_NOT_BUILT,
        });
      }
      if (uplinkAllowed) actions.push({ kind: 'uplink' });
      break;
    default:
      break;
  }
  actions.push(devicePage);
  return { actions, reason };
};
