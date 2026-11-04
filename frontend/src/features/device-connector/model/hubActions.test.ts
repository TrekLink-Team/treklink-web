import { describe, expect, it } from 'vitest';
import type { RecognizedUnit } from '../../../entities/device/api';
import type { Connection } from './ConnectorRegistry';
import type { CounterContext } from './connectorStore';
import { FLASH_NOT_BUILT } from './actionsFor';
import { LOCKED_TEXT, NOT_READY_TEXT, hubActionsFor, type HubAction, type HubActionKind } from './hubActions';

// The Actions table of devices design section 11.13 (REQ-EVT-42, REQ-ERR-30).

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

describe('hubActionsFor (devices design section 11.13)', () => {
  it('always lists the six actions in the order of the brief', () => {
    expect(hubActionsFor(connection(null), null, CAN, null, null).map((action) => action.kind)).toEqual([
      'provision',
      'swap',
      'uplink',
      'flash',
      'reboot',
      'factoryReset',
    ]);
  });

  it('offers factory reset only for a returned unit due its reset', () => {
    const actions = byKind(hubActionsFor(connection({ status: 'RETURNED' }), null, CAN, RESET_DUE, null));
    expect(actions.factoryReset).toMatchObject({ available: true, reason: null });
    expect(actions.reboot.available).toBe(true);
  });

  it('names why factory reset is unavailable (REQ-ERR-30)', () => {
    const reason = (device: Parameters<typeof connection>[0], record: object | null | undefined = RESET_DUE, contract: RecognizedUnit['contract'] = null) =>
      byKind(hubActionsFor(connection(device, contract), null, CAN, record, null)).factoryReset.reason;
    expect(reason(null, null)).toBe('Register this unit first.');
    expect(reason({ status: 'RENTED' }, RESET_DUE, RENTED_ON)).toBe(
      'TL-0042 is rented on RC-2026-0040. Check it in at the return counter first.',
    );
    expect(reason({ status: 'AVAILABLE' })).toBe('Factory reset is for returned units. TL-0042 is Available.');
    expect(reason({ status: 'RETURNED' }, { nextStep: { action: 'INSPECT', contractId: 'c-40' } })).toBe(
      'TL-0042 is already reset for this return.',
    );
    // The record of devices api-design 07 is still loading.
    expect(byKind(hubActionsFor(connection({ status: 'RETURNED' }), null, CAN, undefined, null)).factoryReset.reason).toBe(
      'Checking the record.',
    );
    expect(
      byKind(hubActionsFor(connection({ status: 'RETURNED' }), null, { register: false, operate: false }, RESET_DUE, null))
        .factoryReset.reason,
    ).toBe('Only TrekLink Staff can do this.');
  });

  it('sends provisioning and the quick swap to the counter outside it, with its link for a reserved unit', () => {
    const actions = byKind(
      hubActionsFor(connection({ status: 'RESERVED' }, { ...RENTED_ON, status: 'APPROVED' }), null, CAN, {}, null),
    );
    expect(actions.provision).toMatchObject({
      available: false,
      reason: 'Provision from the counter of its contract.',
      link: { label: 'Open its counter', to: '/t/counter/c-40' },
    });
    expect(actions.swap.reason).toBe("Quick swap runs from a contract's counter.");
    expect(actions.uplink.available).toBe(true);
  });

  it('runs the section 11.3 actions in the counter context', () => {
    const actions = byKind(hubActionsFor(connection({ status: 'AVAILABLE' }), counter(), CAN, {}, null));
    expect(actions.swap).toMatchObject({ available: true, unitAction: { kind: 'swap' } });
  });

  it('keeps Update firmware unavailable until task 8.3 registers its panel', () => {
    const maintenance = {
      status: 'MAINTENANCE' as const,
      openMaintenance: { id: 'm-1', reason: 'FIRMWARE_UPDATE', status: 'OPEN' },
    };
    expect(byKind(hubActionsFor(connection(maintenance), null, CAN, {}, null)).flash.reason).toBe(FLASH_NOT_BUILT);
    expect(byKind(hubActionsFor(connection(maintenance), null, { ...CAN, flash: true }, {}, null)).flash.available).toBe(true);
    expect(byKind(hubActionsFor(connection({ status: 'AVAILABLE' }), null, { ...CAN, flash: true }, {}, null)).flash.reason).toBe(
      'Update firmware needs an open firmware update record.',
    );
  });

  it('disables every action while another unit is written, or while this one is read (REQ-STA-06)', () => {
    const locked = hubActionsFor(connection({ status: 'RETURNED' }), null, CAN, RESET_DUE, 7);
    expect(locked.every((action) => !action.available && action.reason === LOCKED_TEXT)).toBe(true);
    const reading = hubActionsFor(connection({ status: 'RETURNED' }, null, { state: 'reading' }), null, CAN, RESET_DUE, null);
    expect(reading.every((action) => action.reason === NOT_READY_TEXT)).toBe(true);
  });
});
