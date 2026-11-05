import type { NextStep } from '../../../entities/device/api';
import { DEVICE_STATUS, type DeviceStatus } from '../../../shared/ui/status';
import type { Connection } from './ConnectorRegistry';
import { actionsFor, FLASH_NOT_BUILT, type UnitAction } from './actionsFor';
import type { ConnectorContext } from './connectorStore';

// The six actions of the device hub page (devices design section 12.13, REQ-EVT-44): always listed, in
// this order, each available or carrying its reason as text. Provision, Quick swap, Configure uplink and
// Update firmware follow actionsFor (section 12.3), so the page and the panel never disagree; Reboot and
// Factory reset are the page's own.

export type HubActionKind = 'provision' | 'swap' | 'uplink' | 'flash' | 'reboot' | 'factoryReset';

export interface HubAction {
  kind: HubActionKind;
  label: string;
  available: boolean;
  // Why it is unavailable, as text; null when available.
  reason: string | null;
  // The panel action it runs, for the four shared with section 12.3.
  unitAction?: UnitAction;
  // A way forward when unavailable here ("Open its counter").
  link?: { label: string; to: string };
}

// What the page knows of the device's record beyond the recognition (devices api-design 07).
export interface HubRecord {
  nextStep?: NextStep | null;
}

export const HUB_LABELS: Record<HubActionKind, string> = {
  provision: 'Provision',
  swap: 'Quick swap',
  uplink: 'Configure uplink',
  flash: 'Update firmware',
  reboot: 'Reboot',
  factoryReset: 'Factory reset',
};

export const LOCKED_TEXT = 'Another unit is being written.';
export const NOT_READY_TEXT = 'Wait until the unit is read.';

// A returned unit whose custody row on a contract is still open (REQ-ERR-32).
export const custodyText = (tag: string, contractCode: string) =>
  `${tag} is still in custody on ${contractCode}. Check it in on its contract first.`;

const statusLabel = (status: string) => DEVICE_STATUS[status as DeviceStatus]?.label ?? status;

export const hubActionsFor = (
  connection: Connection,
  context: ConnectorContext | null,
  can: { register: boolean; operate: boolean; flash?: boolean; flashUnavailable?: (variantCode: string) => string | null },
  // undefined while devices api-design 07 loads; null for an unknown unit.
  record: HubRecord | null | undefined,
  writing: number | null,
): HubAction[] => {
  const make = (kind: HubActionKind, reason: string | null, extra: Partial<HubAction> = {}): HubAction => ({
    kind,
    label: HUB_LABELS[kind],
    available: reason === null,
    reason,
    ...extra,
  });
  const kinds: HubActionKind[] = ['provision', 'swap', 'uplink', 'flash', 'reboot', 'factoryReset'];
  // A write on another unit holds the one lock (REQ-UBI-09, REQ-STA-06).
  if (writing !== null && writing !== connection.id) return kinds.map((kind) => make(kind, LOCKED_TEXT));
  if (connection.state !== 'ready' || !connection.unit) {
    return kinds.map((kind) => make(kind, connection.message ?? NOT_READY_TEXT));
  }

  const base = actionsFor(connection, context, can);
  const find = <K extends UnitAction['kind']>(kind: K) =>
    base.actions.find((action): action is Extract<UnitAction, { kind: K }> => action.kind === kind);
  const device = connection.recognized?.device ?? null;
  const contract = connection.recognized?.contract ?? null;
  const tag = device?.assetTag ?? connection.unit.nodeId;
  const counter = context?.kind === 'counter';
  const unregistered = 'Register this unit first.';
  const staffOnly = 'Only TrekLink Staff can do this.';

  const provisionAction = find('provision');
  const provision = provisionAction
    ? make('provision', null, { unitAction: provisionAction })
    : make('provision', !device ? unregistered : counter && base.reason ? base.reason : 'Provision from the counter of its contract.', {
        link:
          device?.status === 'RESERVED' && contract
            ? { label: 'Open its counter', to: `/t/counter/${contract.id}` }
            : undefined,
      });

  const swapAction = find('swap');
  const swap = swapAction
    ? make('swap', null, { unitAction: swapAction })
    : make('swap', !device ? unregistered : counter && base.reason ? base.reason : "Quick swap runs from a contract's counter.");

  const uplinkAction = find('uplink');
  const uplink = uplinkAction
    ? make('uplink', null, { unitAction: uplinkAction })
    : make(
        'uplink',
        !device
          ? unregistered
          : !can.operate
            ? staffOnly
            : device.status === 'RETIRED' || device.status === 'DISPOSED'
              ? 'Configure uplink needs a registered unit that is not retired.'
              : `Configure uplink is not available while ${tag} is ${statusLabel(device.status)}.`,
      );

  const flashAction = find('flash');
  const flash = flashAction
    ? make('flash', flashAction.disabledReason, { unitAction: flashAction })
    : make('flash', !device ? unregistered : !can.flash ? FLASH_NOT_BUILT : 'Update firmware needs an open firmware update record.');

  const reboot = make('reboot', can.operate ? null : staffOnly);

  let resetReason: string | null = null;
  if (!device) resetReason = unregistered;
  else if (!can.operate) resetReason = staffOnly;
  else if (device.status === 'RENTED') {
    resetReason = `${tag} is rented on ${contract?.code ?? 'its contract'}. Check it in at the return counter first.`;
  } else if (device.status !== 'RETURNED') {
    resetReason = `Factory reset is for returned units. ${tag} is ${statusLabel(device.status)}.`;
  } else if (contract) {
    // The recognition's contract is the unit's open custody row (devices design section 12.5): a returned
    // unit still in custody is refused before anything is written to it (REQ-ERR-32).
    resetReason = custodyText(tag, contract.code);
  } else if (record === undefined) resetReason = 'Checking the record.';
  else if (record?.nextStep?.action !== 'RESET') resetReason = `${tag} is already reset for this return.`;
  const factoryReset = make('factoryReset', resetReason);

  return [provision, swap, uplink, flash, reboot, factoryReset];
};
