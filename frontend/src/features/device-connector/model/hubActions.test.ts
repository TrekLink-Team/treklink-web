import { describe, expect, it } from 'vitest';
import type { RecognizedUnit } from '../../../entities/device/api';
import type { DeviceStatus } from '../../../shared/ui/status';
import type { Connection } from './ConnectorRegistry';
import type { CounterContext } from './connectorStore';
import { FLASH_NOT_BUILT } from './actionsFor';
import {
  LOCKED_TEXT,
  NOT_READY_TEXT,
  STAFF_ONLY_TEXT,
  UNREGISTERED_TEXT,
  hubActionsFor,
  noContractText,
  type HubAction,
  type HubActionKind,
} from './hubActions';

// The Actions table of devices design section 12.14 (REQ-EVT-44, REQ-ERR-32, leader UAT 2026-11-06): no status
// disables an action; RESERVED and RENTED add the typed confirmation.

const CAN = { register: true, operate: true, flash: false };
const RESET_DUE = { nextStep: { action: 'RESET' as const, contractId: 'c-40' } };

const connection = (
  device: Partial<NonNullable<RecognizedUnit['device']>> | null,
  contract: RecognizedUnit['contract'] = null,
  change: Partial<Connection> = {},
): Connection => ({
  id: 1,
  port: {} as SerialPort,
  state: 'ready',
  unit: { nodeNum: 1, nodeId: '!00000001', pioEnv: 'treklink-v3-tbeam', firmwareVersion: '2.7.19', longName: '', shortName: '' },
  recognized: {
    nodeNum: 1,
    nodeId: '!00000001',
    device: device
      ? ({
          id: 'd-42',
          assetTag: 'TL-0042',
          status: 'AVAILABLE',
          hardwareVariant: { code: 'treklink-v3' },
          openMaintenance: null,
          ...device,
        } as NonNullable<RecognizedUnit['device']>)
      : null,
    contract,
    docked: null,
  },
  message: null,
  ...change,
});

const counter = (): CounterContext => ({
  kind: 'counter',
  contractId: 'c-42',
  contractCode: 'RC-2026-0042',
  status: 'APPROVED',
  variantCode: 'treklink-v3',
  version: 4,
  keyVersion: 2,
  rows: [{ deviceId: 'd-1', assetTag: 'TL-0001', nodeNum: 11, provisionedKeyVersion: null }],
  provision: () => Promise.resolve(),
  swapIn: () => Promise.resolve(null),
});

const byKind = (actions: HubAction[]) =>
  Object.fromEntries(actions.map((action) => [action.kind, action])) as Record<HubActionKind, HubAction>;

const RENTED_ON = {
  id: 'c-40',
  code: 'RC-2026-0040',
  status: 'ACTIVE',
  organization: { id: 'o-1', code: 'ORG-SAPA' },
  provisionedKeyVersion: 2,
};

const STATUSES: DeviceStatus[] = ['IN_INTAKE', 'AVAILABLE', 'RESERVED', 'RENTED', 'RETURNED', 'MAINTENANCE', 'LOST', 'RETIRED', 'DISPOSED'];

describe('hubActionsFor (devices design section 12.14)', () => {
  it('lists the seven actions in their groups, in order', () => {
    const actions = hubActionsFor(connection({ status: 'AVAILABLE' }), null, CAN, null, null);
    expect(actions.map((action) => [action.kind, action.group])).toEqual([
      ['provision', 'configure'],
      ['swap', 'configure'],
      ['uplink', 'configure'],
      ['restoreDefaults', 'configure'],
      ['reboot', 'configure'],
      ['flash', 'firmware'],
      ['factoryReset', 'danger'],
    ]);
  });

  it.each(STATUSES)('never disables Factory reset, Restore defaults, uplink or Reboot because the unit is %s', (status) => {
    const actions = byKind(
      hubActionsFor(connection({ status }, RENTED_ON), null, { ...CAN, flash: true, flashUnavailable: () => null }, RESET_DUE, null),
    );
    for (const kind of ['uplink', 'restoreDefaults', 'reboot', 'flash', 'factoryReset', 'provision'] as const) {
      expect(actions[kind]).toMatchObject({ available: true, reason: null });
    }
  });

  it('asks for the asset tag typed for a reserved or rented unit and names the contract', () => {
    for (const status of ['RESERVED', 'RENTED'] as const) {
      const { factoryReset, reboot } = byKind(hubActionsFor(connection({ status }, RENTED_ON), null, CAN, {}, null));
      expect(factoryReset.confirm).toEqual({
        assetTag: 'TL-0042',
        statusLabel: status === 'RENTED' ? 'Rented' : 'Reserved',
        contractCode: 'RC-2026-0040',
        organizationCode: 'ORG-SAPA',
        typed: true,
      });
      expect(reboot.confirm?.typed).toBe(true);
    }
    expect(byKind(hubActionsFor(connection({ status: 'AVAILABLE' }), null, CAN, {}, null)).factoryReset.confirm).toBeNull();
  });

  it('notes the custody of a returned unit without asking for the tag', () => {
    const { factoryReset } = byKind(hubActionsFor(connection({ status: 'RETURNED' }, RENTED_ON), null, CAN, {}, null));
    expect(factoryReset).toMatchObject({ available: true, confirm: { typed: false, contractCode: 'RC-2026-0040' } });
  });

  it('opens the counter of the live contract for Provision, and says Re-provision once a key is on the unit', () => {
    const { provision } = byKind(
      hubActionsFor(connection({ status: 'RENTED', keyVersion: 3 }, RENTED_ON), null, CAN, {}, null),
    );
    expect(provision).toMatchObject({
      label: 'Re-provision',
      available: true,
      link: { label: 'Open RC-2026-0040', to: '/t/counter/c-40' },
    });
  });

  it('keeps Provision disabled with its reason when there is no contract', () => {
    const { provision } = byKind(hubActionsFor(connection({ status: 'AVAILABLE', keyVersion: null }), null, CAN, {}, null));
    expect(provision).toMatchObject({ label: 'Provision', available: false, reason: noContractText('TL-0042') });
  });

  it('provisions in place on its own counter row, even when it is already provisioned', () => {
    const context = { ...counter(), contractId: 'c-40', rows: [{ deviceId: 'd-42', assetTag: 'TL-0042', nodeNum: 1, provisionedKeyVersion: 2 }] };
    const { provision } = byKind(
      hubActionsFor(connection({ status: 'RESERVED', keyVersion: 2 }, RENTED_ON), context, CAN, {}, null),
    );
    expect(provision).toMatchObject({ available: true, label: 'Re-provision', unitAction: { kind: 'provision' } });
  });

  it('names the release reason for Update firmware, never the status', () => {
    expect(byKind(hubActionsFor(connection({ status: 'RENTED' }, RENTED_ON), null, CAN, {}, null)).flash.reason).toBe(
      FLASH_NOT_BUILT,
    );
    const none = { ...CAN, flash: true, flashUnavailable: () => 'No firmware release is published yet.' };
    expect(byKind(hubActionsFor(connection({ status: 'AVAILABLE' }), null, none, {}, null)).flash.reason).toBe(
      'No firmware release is published yet.',
    );
  });

  it('allows only Reboot on an unknown unit', () => {
    const actions = hubActionsFor(connection(null), null, CAN, null, null);
    expect(actions.filter((action) => action.available).map((action) => action.kind)).toEqual(['reboot']);
    expect(byKind(actions).factoryReset.reason).toBe(UNREGISTERED_TEXT);
  });

  it('disables everything for a caller who is not Staff, while another unit is written, or before the read', () => {
    const notStaff = hubActionsFor(connection({ status: 'AVAILABLE' }), null, { register: false, operate: false }, {}, null);
    expect(notStaff.every((action) => action.reason === STAFF_ONLY_TEXT)).toBe(true);
    const locked = hubActionsFor(connection({ status: 'AVAILABLE' }), null, CAN, {}, 2);
    expect(locked.every((action) => action.reason === LOCKED_TEXT)).toBe(true);
    const reading = hubActionsFor(connection({ status: 'AVAILABLE' }, null, { state: 'reading', unit: null }), null, CAN, {}, null);
    expect(reading.every((action) => action.reason === NOT_READY_TEXT)).toBe(true);
  });
});
