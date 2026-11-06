import type { NextStep } from '../../../entities/device/api';
import { DEVICE_STATUS, type DeviceStatus } from '../../../shared/ui/status';
import type { Connection } from './ConnectorRegistry';
import { actionsFor, FLASH_NOT_BUILT, type UnitAction } from './actionsFor';
import type { ConnectorContext, CounterRow } from './connectorStore';

// The actions of the device hub page (devices design sections 12.13 and 12.14, REQ-EVT-44), always listed, in
// this order and in three groups, each available or carrying its reason as text. The leader's rule of 2026-11-06:
// TrekLink Staff may run every action on a unit in their hands in every device status. The status never disables
// an action; for a RESERVED or RENTED unit it only adds the typed confirmation (`confirm`). What may still disable
// one is a fact that is not the status: the unit is not read, another unit is being written, the caller is not
// Staff, the unit is not registered, no release carries its variant, or there is no contract to provision for.

export type HubActionKind =
  | 'provision'
  | 'swap'
  | 'uplink'
  | 'restoreDefaults'
  | 'reboot'
  | 'flash'
  | 'factoryReset';

export type HubActionGroup = 'configure' | 'firmware' | 'danger';

// The warning a RESERVED or RENTED unit adds (design section 12.14): the dialog names the contract and the
// organization and asks for the asset tag typed. `typed` is false for a RETURNED unit still in custody, which
// only gets the custody note.
export interface HubConfirm {
  assetTag: string;
  statusLabel: string;
  contractCode: string | null;
  organizationCode: string | null;
  typed: boolean;
}

export interface HubAction {
  kind: HubActionKind;
  label: string;
  group: HubActionGroup;
  available: boolean;
  // Why it is unavailable, as text; null when available.
  reason: string | null;
  // The panel action it runs, for those shared with section 12.3.
  unitAction?: UnitAction;
  // Where an available action goes when it runs on another page (Provision opens its contract's counter).
  link?: { label: string; to: string };
  confirm: HubConfirm | null;
}

// What the page knows of the device's record beyond the recognition (devices api-design 07).
export interface HubRecord {
  nextStep?: NextStep | null;
}

export const HUB_LABELS: Record<HubActionKind, string> = {
  provision: 'Provision',
  swap: 'Quick swap',
  uplink: 'Configure uplink',
  restoreDefaults: 'Restore TrekLink defaults',
  reboot: 'Reboot',
  flash: 'Update firmware',
  factoryReset: 'Factory reset',
};

export const HUB_GROUPS: { group: HubActionGroup; title: string }[] = [
  { group: 'configure', title: 'Configure' },
  { group: 'firmware', title: 'Firmware' },
  { group: 'danger', title: 'Danger zone' },
];

const GROUP_OF: Record<HubActionKind, HubActionGroup> = {
  provision: 'configure',
  swap: 'configure',
  uplink: 'configure',
  restoreDefaults: 'configure',
  reboot: 'configure',
  flash: 'firmware',
  factoryReset: 'danger',
};

const KINDS: HubActionKind[] = ['provision', 'swap', 'uplink', 'restoreDefaults', 'reboot', 'flash', 'factoryReset'];

export const LOCKED_TEXT = 'Another unit is being written.';
export const NOT_READY_TEXT = 'Wait until the unit is read.';
export const UNREGISTERED_TEXT = 'Register this unit first.';
export const STAFF_ONLY_TEXT = 'Only TrekLink Staff can do this.';
export const noContractText = (tag: string) => `No contract to provision for. Reserve ${tag} on a contract first.`;

// A returned unit whose custody row on a contract is still open: its reset is not the return's reset yet.
export const custodyText = (tag: string, contractCode: string) =>
  `${tag} is still in custody on ${contractCode}. This is not recorded as the reset of the return while it is.`;

export const statusLabel = (status: string) => DEVICE_STATUS[status as DeviceStatus]?.label ?? status;

// The statuses whose actions need the asset tag typed (design section 12.14, REQ-ERR-34).
export const CONFIRMED_STATUSES: ReadonlySet<string> = new Set(['RESERVED', 'RENTED']);

export const confirmFor = (connection: Connection): HubConfirm | null => {
  const device = connection.recognized?.device;
  if (!device) return null;
  const contract = connection.recognized?.contract ?? null;
  const typed = CONFIRMED_STATUSES.has(device.status);
  if (!typed && !(device.status === 'RETURNED' && contract)) return null;
  return {
    assetTag: device.assetTag,
    statusLabel: statusLabel(device.status),
    contractCode: contract?.code ?? null,
    organizationCode: contract?.organization.code ?? null,
    typed,
  };
};

export const hubActionsFor = (
  connection: Connection,
  context: ConnectorContext | null,
  can: { register: boolean; operate: boolean; flash?: boolean; flashUnavailable?: (variantCode: string) => string | null },
  // Kept for the callers that read devices api-design 07; the status no longer gates the factory reset.
  _record: HubRecord | null | undefined,
  writing: number | null,
): HubAction[] => {
  const confirm = confirmFor(connection);
  const make = (kind: HubActionKind, reason: string | null, extra: Partial<HubAction> = {}): HubAction => ({
    kind,
    label: HUB_LABELS[kind],
    group: GROUP_OF[kind],
    available: reason === null,
    reason,
    confirm,
    ...extra,
  });
  // A write on another unit holds the one lock (REQ-UBI-09, REQ-STA-06).
  if (writing !== null && writing !== connection.id) return KINDS.map((kind) => make(kind, LOCKED_TEXT));
  if (connection.state !== 'ready' || !connection.unit) {
    return KINDS.map((kind) => make(kind, connection.message ?? NOT_READY_TEXT));
  }
  if (!can.operate) return KINDS.map((kind) => make(kind, STAFF_ONLY_TEXT));

  const device = connection.recognized?.device ?? null;
  const contract = connection.recognized?.contract ?? null;
  const counter = context?.kind === 'counter' ? context : null;
  const reboot = make('reboot', null);
  if (!device) {
    return KINDS.map((kind) => (kind === 'reboot' ? reboot : make(kind, UNREGISTERED_TEXT)));
  }

  const base = actionsFor(connection, context, can);
  const find = <K extends UnitAction['kind']>(kind: K) =>
    base.actions.find((action): action is Extract<UnitAction, { kind: K }> => action.kind === kind);

  // Provision, or Re-provision once the unit carries a key: in place on the counter row of its contract; elsewhere
  // it opens the counter of the unit's live contract focused on the unit (design section 12.14).
  const reprovision = device.keyVersion !== null && device.keyVersion !== undefined;
  const provisionLabel = reprovision ? 'Re-provision' : HUB_LABELS.provision;
  const row: CounterRow | undefined = counter?.rows.find((candidate) => candidate.deviceId === device.id);
  let provision: HubAction;
  if (counter && row && counter.contractId === contract?.id) {
    provision = make('provision', null, { label: provisionLabel, unitAction: { kind: 'provision', row } });
  } else if (contract) {
    provision = make('provision', null, {
      label: provisionLabel,
      link: { label: `Open ${contract.code}`, to: `/t/counter/${contract.id}` },
    });
  } else {
    provision = make('provision', noContractText(device.assetTag), { label: provisionLabel });
  }

  const swapAction = find('swap');
  const swap = swapAction
    ? make('swap', null, { unitAction: swapAction })
    : make('swap', counter && base.reason ? base.reason : "Quick swap runs from a contract's counter.");

  const uplink = make('uplink', null, { unitAction: { kind: 'uplink' } });
  const restoreDefaults = make('restoreDefaults', null);

  const flashReason = !can.flash ? FLASH_NOT_BUILT : (can.flashUnavailable?.(device.hardwareVariant.code) ?? null);
  const flash = make('flash', flashReason, { unitAction: { kind: 'flash', disabledReason: flashReason } });

  const factoryReset = make('factoryReset', null);

  return [provision, swap, uplink, restoreDefaults, reboot, flash, factoryReset];
};

// Whether the typed text confirms the asset tag (devices design section 12.14): case-insensitive, trimmed, as the
// server compares it on api-design 33.
export const typedMatches = (typed: string, assetTag: string) =>
  typed.trim().toUpperCase() === assetTag.trim().toUpperCase();

// The contract line the dialog of a RESERVED, RENTED or still-in-custody unit opens with.
export const contractLine = (confirm: HubConfirm) =>
  `${confirm.assetTag} is ${confirm.statusLabel.toLowerCase()}${confirm.contractCode ? ` on ${confirm.contractCode}` : ''}${
    confirm.organizationCode ? ` for ${confirm.organizationCode}` : ''
  }.`;
