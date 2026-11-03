import { describe, expect, it } from 'vitest';
import type { RecognizedUnit } from '../../../entities/device/api';
import type { Connection } from './ConnectorRegistry';
import type { CounterContext } from './connectorStore';
import { FLASH_NOT_BUILT, actionsFor } from './actionsFor';

// The table of devices design section 11.3, one row per case (REQ-EVT-32, REQ-ERR-20, REQ-ERR-21,
// REQ-ERR-23, REQ-ERR-24).

const CAN = { register: true, operate: true };

const connection = (device: Partial<NonNullable<RecognizedUnit['device']>> | null, contract: RecognizedUnit['contract'] = null): Connection => ({
  id: 1,
  port: {} as SerialPort,
  state: 'ready',
  unit: { nodeNum: 1, nodeId: '!00000001', pioEnv: 'treklink-v3-tbeam', firmwareVersion: '2.7.19', longName: '', shortName: '' },
  recognized: {
    nodeNum: 1,
    nodeId: '!00000001',
    device: device
      ? ({
          id: 'd-51',
          assetTag: 'TL-0051',
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
});

const counter = (change: Partial<CounterContext> = {}): CounterContext => ({
  kind: 'counter',
  contractId: 'c-42',
  contractCode: 'RC-2026-0042',
  status: 'APPROVED',
  variantCode: 'treklink-v3',
  version: 4,
  keyVersion: 2,
  rows: [
    { deviceId: 'd-1', assetTag: 'TL-0001', nodeNum: 11, provisionedKeyVersion: null },
    { deviceId: 'd-2', assetTag: 'TL-0002', nodeNum: 12, provisionedKeyVersion: 2 },
  ],
  provision: () => Promise.resolve(),
  swapIn: () => Promise.resolve(),
  ...change,
});

const kinds = (result: ReturnType<typeof actionsFor>) => result.actions.map((action) => action.kind);

describe('actionsFor (devices design section 11.3)', () => {
  it('offers registration for an unknown unit, and only to a caller who may register', () => {
    expect(kinds(actionsFor(connection(null), null, CAN))).toEqual(['register']);
    expect(actionsFor(connection(null), null, { register: false, operate: false }).reason).toBe(
      'This unit is not registered.',
    );
  });

  it('offers the quick swap at the counter with only the reserved units not provisioned', () => {
    const result = actionsFor(connection({}), counter(), CAN);
    expect(kinds(result)).toEqual(['swap', 'uplink', 'link']);
    expect(result.actions[0]).toMatchObject({ rows: [{ assetTag: 'TL-0001' }] });
  });

  it('names a variant mismatch and offers no swap (REQ-ERR-23)', () => {
    const result = actionsFor(connection({ hardwareVariant: { code: 'treklink-v2' } as never }), counter(), CAN);
    expect(kinds(result)).not.toContain('swap');
    expect(result.reason).toBe('TL-0051 is treklink-v2; RC-2026-0042 rents treklink-v3.');
  });

  it('offers no swap when every reserved unit is provisioned (REQ-ERR-24)', () => {
    const result = actionsFor(
      connection({}),
      counter({ rows: [{ deviceId: 'd-2', assetTag: 'TL-0002', nodeNum: 12, provisionedKeyVersion: 2 }] }),
      CAN,
    );
    expect(kinds(result)).not.toContain('swap');
    expect(result.reason).toMatch(/only units not provisioned can be swapped out/);
  });

  it('provisions a unit reserved to this contract until it carries the current version', () => {
    const own = { id: 'c-42', code: 'RC-2026-0042', status: 'APPROVED', organization: { id: 'o', code: 'ORG' }, provisionedKeyVersion: null };
    const result = actionsFor(connection({ id: 'd-1', assetTag: 'TL-0001', status: 'RESERVED' }, own), counter(), CAN);
    expect(result.actions[0]).toMatchObject({ kind: 'provision', row: { deviceId: 'd-1' } });

    const done = actionsFor(connection({ id: 'd-2', assetTag: 'TL-0002', status: 'RESERVED' }, own), counter(), CAN);
    expect(kinds(done)).not.toContain('provision');
    expect(done.reason).toBe('Provisioned v2.');
  });

  it('names another contract and a rented unit, with the link to their counter (REQ-ERR-20, REQ-ERR-21)', () => {
    const other = { id: 'c-40', code: 'RC-2026-0040', status: 'REQUESTED', organization: { id: 'o', code: 'ORG' }, provisionedKeyVersion: null };
    const reserved = actionsFor(connection({ status: 'RESERVED' }, other), counter(), CAN);
    expect(reserved.reason).toBe('TL-0051 is reserved to RC-2026-0040.');
    expect(reserved.actions).toContainEqual({ kind: 'link', label: 'Open its counter', to: '/t/counter/c-40' });
    expect(kinds(reserved)).not.toContain('swap');

    const rented = actionsFor(connection({ status: 'RENTED' }, other), counter(), CAN);
    expect(rented.reason).toBe('TL-0051 is rented on RC-2026-0040. Check it in at the return counter.');
    expect(kinds(rented)).toEqual(['link', 'link']);
  });

  it('shows Update firmware for an open FIRMWARE_UPDATE record, unavailable until the flash panel exists', () => {
    const result = actionsFor(
      connection({ status: 'MAINTENANCE', openMaintenance: { id: 'mr-1', reason: 'FIRMWARE_UPDATE', status: 'OPEN' } }),
      null,
      CAN,
    );
    expect(result.actions[0]).toEqual({ kind: 'flash', disabledReason: FLASH_NOT_BUILT });
  });

  it('allows nothing but the device page for a retired unit, and nothing while a unit is not ready', () => {
    expect(kinds(actionsFor(connection({ status: 'RETIRED' }), counter(), CAN))).toEqual(['link']);
    expect(actionsFor({ ...connection({}), state: 'writing' }, counter(), CAN)).toEqual({ actions: [], reason: null });
  });
});
