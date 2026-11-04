import { useCallback, useEffect, useRef, useState } from 'react';
import { exchangeDevice, issueChannelKey } from '../../../entities/contract/api';
import { recognizeUnits, recordReset } from '../../../entities/device/api';
import { ApiError } from '../../../shared/api/apiClient';
import {
  choosePort,
  toNodeId,
  type DockTimings,
  type UnitReading,
  type UplinkSettings,
} from '../../../shared/lib/meshtastic-dock';
import {
  connectorRegistry,
  type Connection,
  type ConnectionState,
  type ConnectorRegistry,
} from '../model/ConnectorRegistry';
import { useConnectorStore } from '../model/connectorStore';
import {
  DockingError,
  DockingService,
  type DockStage,
  type ExpectedUnit,
} from './DockingService';
import type { DockingFailureInfo } from './messages';
import { custodyText } from '../model/hubActions';

// The docking flows the pages and the connector panel run (devices design sections 8.1 and 11.7). The
// device connector's registry lends the port and holds the one write lock (REQ-UBI-09, REQ-UBI-10): a
// page never chooses or opens a port itself. One docking runs at a time; the state names the row or
// device it runs for and its stage, for the "Docking in progress" state of screen 5.4 and the restart
// wait of screen 4.2.
//
// The channel key (rentals api-design 21) lives in one local variable of `provisionOn` and is wiped
// when `provision` returns, before the caller records anything. It never enters React state, the
// query cache, storage or a log line (REQ-UBI-05).

export type DockResult<T> = ({ ok: true } & T) | ({ ok: false } & DockingFailureInfo);

export interface DockingState {
  target: string | null;
  stage: DockStage | null;
}

const IDLE: DockingState = { target: null, stage: null };

const hexToBytes = (hex: string): Uint8Array => {
  if (!/^([0-9a-f]{2})+$/i.test(hex)) throw new DockingError('dock', 'The channel key is malformed.');
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
};

const failureOf = (error: unknown): DockingFailureInfo => {
  if (error instanceof DockingError) return { failure: error.failure, reason: error.message };
  if (error instanceof ApiError) return { failure: 'api', reason: error.message };
  return { failure: 'dock', reason: 'The docking failed.' };
};

export interface ProvisionTarget extends ExpectedUnit {
  contractId: string;
  deviceId: string;
}

const CHOOSE_TEXT = 'Several units are connected. Choose the unit in the device connector.';

const settled = (state: ConnectionState) =>
  state !== 'reading' && state !== 'looking-up';

// The connection an action runs on (REQ-EVT-39): the connected unit with the expected node number,
// else the only connected unit, else a unit Staff connect now through the chooser. With several units
// and none expected, Staff choose in the panel.
const connectionFor = async (
  registry: ConnectorRegistry,
  expectedNodeNum: number | null | undefined,
  prefer?: (connection: Connection) => boolean,
): Promise<Connection> => {
  const wait = async (id: number) => {
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const connection = registry.get(id);
      if (!connection || settled(connection.state)) return connection;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return registry.get(id);
  };
  const exact = registry.byNodeNum(expectedNodeNum);
  if (exact) return (await wait(exact.id)) ?? exact;
  const live = registry
    .getSnapshot()
    .connections.filter((connection) => connection.state !== 'unplugged');
  const preferred = prefer ? live.filter(prefer) : [];
  const candidates = preferred.length === 1 ? preferred : live;
  if (candidates.length === 1) return (await wait(candidates[0].id)) ?? candidates[0];
  if (candidates.length > 1) throw new DockingError('choose', CHOOSE_TEXT);
  const id = await registry.connectNew();
  if (id === null) throw new DockingError('cancelled', 'No port was chosen.');
  const connection = await wait(id);
  if (!connection) throw new DockingError('dock', 'The unit is no longer connected.');
  return connection;
};

// The connection's failure, worded as the docking flows word it.
const readFailure = (connection: Connection): DockingError | null => {
  if (connection.state === 'no-response') return new DockingError('no-response', 'No response.');
  if (connection.state === 'busy') return new DockingError('dock', connection.message ?? 'The port is busy.');
  if (connection.state === 'failed' || connection.state === 'unplugged') {
    return new DockingError('dock', connection.message ?? 'The unit could not be read.');
  }
  return null;
};

export const useDocking = (options: { timings?: DockTimings } = {}) => {
  const [service] = useState(() => new DockingService(options.timings));
  const [registry] = useState(() => connectorRegistry(recognizeUnits, options.timings));
  const [state, setState] = useState<DockingState>(IDLE);
  const pendingReconnect = useRef<((port: SerialPort | null) => void) | null>(null);
  const reconnectRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const openFor = useConnectorStore((store) => store.openFor);
  const supported = registry.getSnapshot().supported;

  useEffect(() => {
    void registry.start();
  }, [registry]);

  const giveUp = useCallback(() => {
    const resolve = pendingReconnect.current;
    pendingReconnect.current = null;
    resolve?.(null);
  }, []);

  // A docking still open when the page unmounts is abandoned and its port let go.
  useEffect(
    () => () => {
      giveUp();
      void service.release();
    },
    [giveUp, service],
  );

  const hooksFor = (
    target: string,
    stage: (state: ConnectionState) => void,
    connectionId: number,
  ) => ({
    onStage: (next: DockStage) => {
      setState({ target, stage: next });
      stage(next);
    },
    reconnect: () =>
      new Promise<SerialPort | null>((resolve) => {
        pendingReconnect.current = (port) => {
          registry.offerReconnect(null);
          resolve(port);
        };
        // The connector panel shows the same Reconnect and Stop on the unit's row (screen 4.6).
        registry.offerReconnect({ connectionId, reconnect: reconnectRef.current, stop: giveUp });
      }),
    findReturned: (original: SerialPort) => registry.returnedPort(original, connectionId),
  });

  // The Reconnect button's click handler: the chooser needs this user gesture.
  const reconnect = useCallback(async () => {
    if (!pendingReconnect.current) return;
    try {
      const port = await choosePort();
      const resolve = pendingReconnect.current;
      pendingReconnect.current = null;
      resolve?.(port);
    } catch {
      // The chooser was closed: keep waiting for Staff.
    }
  }, []);
  useEffect(() => {
    reconnectRef.current = reconnect;
  }, [reconnect]);

  // Read from unit on the Register panel (design sections 8.3 and 11.3): the identity the connector
  // already read, preferring an unknown unit; no second chooser when one is connected (REQ-EVT-31).
  const readUnit = async (
    target = 'intake',
    connectionId?: number,
  ): Promise<DockResult<{ unit: UnitReading }>> => {
    setState({ target, stage: 'reading' });
    try {
      const connection =
        (connectionId !== undefined && registry.get(connectionId)) ||
        (await connectionFor(registry, null, (candidate) => candidate.recognized?.device === null));
      const failure = readFailure(connection);
      if (failure) throw failure;
      if (!connection.unit) throw new DockingError('dock', 'The unit could not be read.');
      return { ok: true, unit: connection.unit };
    } catch (error) {
      if (error instanceof DockingError && error.failure === 'choose') openFor({ action: 'register' });
      return { ok: false, ...failureOf(error) };
    } finally {
      setState(IDLE);
    }
  };

  // Provisions the reserved device on a connection's port (design section 8.4 steps 1 to 4); the
  // caller records it with the returned nodeNum and keyVersion (step 5).
  const provisionOn = async (
    connection: Connection,
    target: ProvisionTarget,
  ): Promise<{ nodeNum: number; keyVersion: number }> =>
    registry.withWriteLock(connection.id, async (port, stage) => {
      const hooks = hooksFor(target.deviceId, stage, connection.id);
      let key: Uint8Array | null = null;
      try {
        hooks.onStage('reading');
        await service.readUnit(port);
        const { nodeNum } = (await service.confirmUnit(target)).unit;
        hooks.onStage('getting-key');
        let keyVersion: number;
        try {
          const issued = await issueChannelKey(target.contractId, target.deviceId, nodeNum);
          key = hexToBytes(issued.keyHex);
          keyVersion = issued.keyVersion;
        } catch (error) {
          await service.release();
          if (error instanceof ApiError && error.errorCode === 'NODE_MISMATCH') {
            throw new DockingError(
              'mismatch',
              `The docked unit is ${toNodeId(nodeNum)}, not ${target.assetTag}. Nothing was written.`,
              toNodeId(nodeNum),
            );
          }
          throw error;
        }
        return await service.provision(target, key, keyVersion, hooks);
      } finally {
        key?.fill(0);
        await service.release();
      }
    });

  // Dock and provision on a counter row (REQ-EVT-39): the connected unit with the row's node number,
  // or the only connected unit, which a mismatch refuses before anything is written (REQ-ERR-12). The
  // mismatch carries the connection, so the counter can offer the quick swap (REQ-EVT-35).
  const dockAndProvision = async (
    target: ProvisionTarget,
    connectionId?: number,
  ): Promise<DockResult<{ nodeNum: number; keyVersion: number }> & { connectionId?: number }> => {
    let id: number | undefined = connectionId;
    try {
      const connection =
        (connectionId !== undefined && registry.get(connectionId)) ||
        (await connectionFor(registry, target.nodeNum));
      id = connection.id;
      const failure = readFailure(connection);
      if (failure) throw failure;
      if (connection.unit && connection.unit.nodeNum !== target.nodeNum) {
        throw new DockingError(
          'mismatch',
          `The docked unit is ${connection.unit.nodeId}, not ${target.assetTag}. Nothing was written.`,
          connection.unit.nodeId,
        );
      }
      const result = await provisionOn(connection, target);
      return { ok: true, ...result, connectionId: id };
    } catch (error) {
      if (error instanceof DockingError && error.failure === 'choose') {
        openFor({ action: 'provision', assetTag: target.assetTag, nodeNum: target.nodeNum });
      }
      return { ok: false, ...failureOf(error), connectionId: id };
    } finally {
      pendingReconnect.current = null;
      if (registry.reconnectOffer) registry.offerReconnect(null);
      setState(IDLE);
    }
  };

  // The quick swap with hot provisioning (design sections 11.6 and 11.7, REQ-EVT-33, REQ-EVT-34): the
  // exchange of rentals api-design 30 with the docked node number, then the provisioning of the docked
  // unit on the port the connector already holds. A failure after the exchange leaves it in place and
  // the unit not provisioned (REQ-ERR-19).
  const exchangeAndProvision = async (
    connectionId: number,
    replaced: { contractId: string; deviceId: string; expectedVersion: number },
  ): Promise<
    | { ok: true; contractVersion: number; reserved: { deviceId: string; assetTag: string }; nodeNum: number; keyVersion: number }
    | ({ ok: false; exchanged: { deviceId: string; assetTag: string; contractVersion: number } | null } & DockingFailureInfo)
  > => {
    const connection = registry.get(connectionId);
    const device = connection?.recognized?.device;
    let exchanged: { deviceId: string; assetTag: string; contractVersion: number } | null = null;
    try {
      if (!connection?.unit || !device) throw new DockingError('dock', 'The unit is not recognized.');
      setState({ target: replaced.deviceId, stage: 'getting-key' });
      const swap = await exchangeDevice(replaced.contractId, replaced.deviceId, {
        replacementDeviceId: device.id,
        nodeNum: connection.unit.nodeNum,
        expectedVersion: replaced.expectedVersion,
      });
      exchanged = {
        deviceId: swap.reserved.id,
        assetTag: swap.reserved.assetTag,
        contractVersion: swap.contractVersion,
      };
      const result = await provisionOn(connection, {
        contractId: replaced.contractId,
        deviceId: swap.reserved.id,
        assetTag: swap.reserved.assetTag,
        nodeNum: connection.unit.nodeNum,
      });
      return {
        ok: true,
        contractVersion: swap.contractVersion,
        reserved: { deviceId: swap.reserved.id, assetTag: swap.reserved.assetTag },
        ...result,
      };
    } catch (error) {
      return { ok: false, exchanged, ...failureOf(error) };
    } finally {
      pendingReconnect.current = null;
      if (registry.reconnectOffer) registry.offerReconnect(null);
      setState(IDLE);
      await registry.refreshRecognition(connectionId);
    }
  };

  // Configure uplink (design sections 8.8 and 11.7): the device's connected unit. The settings are only
  // read here; the caller clears the passwords afterwards.
  const configureUplink = async (
    target: ExpectedUnit & { deviceId: string },
    settings: UplinkSettings,
  ): Promise<DockResult<object>> => {
    try {
      const connection = await connectionFor(registry, target.nodeNum);
      const failure = readFailure(connection);
      if (failure) throw failure;
      await registry.withWriteLock(connection.id, async (port, stage) => {
        const hooks = hooksFor(target.deviceId, stage, connection.id);
        try {
          hooks.onStage('reading');
          await service.readUnit(port);
          await service.configureUplink(target, settings, hooks);
        } finally {
          await service.release();
        }
      });
      return { ok: true };
    } catch (error) {
      if (error instanceof DockingError && error.failure === 'choose') {
        openFor({ action: 'uplink', assetTag: target.assetTag, nodeNum: target.nodeNum });
      }
      return { ok: false, ...failureOf(error) };
    } finally {
      pendingReconnect.current = null;
      if (registry.reconnectOffer) registry.offerReconnect(null);
      setState(IDLE);
    }
  };

  // Reboot from the device hub page (devices design section 11.13, REQ-EVT-43): on the unit's held port,
  // under the write lock; nothing goes to the server.
  const reboot = async (connectionId: number): Promise<DockResult<object>> => {
    try {
      const connection = registry.get(connectionId);
      if (!connection?.unit) throw new DockingError('dock', 'The unit is no longer connected.');
      const failure = readFailure(connection);
      if (failure) throw failure;
      const nodeNum = connection.unit.nodeNum;
      await registry.withWriteLock(connectionId, async (port, stage) => {
        const hooks = hooksFor(`reboot-${connectionId}`, stage, connectionId);
        try {
          hooks.onStage('reading');
          await service.readUnit(port);
          await service.reboot({ nodeNum }, hooks);
        } finally {
          await service.release();
        }
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, ...failureOf(error) };
    } finally {
      pendingReconnect.current = null;
      if (registry.reconnectOffer) registry.offerReconnect(null);
      setState(IDLE);
    }
  };

  // Factory reset of a returned unit from the device hub page (devices design section 11.13,
  // REQ-EVT-44): the wipe and its read-back under the write lock, then the reset recorded with the
  // docked node number (devices api-design 10). `wiped` tells the page whether the unit was already
  // wiped when the server refused, so it can say the record is what is missing.
  const factoryReset = async (
    connectionId: number,
    target: ExpectedUnit & { deviceId: string },
  ): Promise<DockResult<object> & { wiped: boolean }> => {
    let wiped = false;
    try {
      const connection = registry.get(connectionId);
      if (!connection?.unit) throw new DockingError('dock', 'The unit is no longer connected.');
      const failure = readFailure(connection);
      if (failure) throw failure;
      if (connection.unit.nodeNum !== target.nodeNum) {
        throw new DockingError(
          'mismatch',
          `The docked unit is ${connection.unit.nodeId}, not ${target.assetTag}. Nothing was written.`,
          connection.unit.nodeId,
        );
      }
      // The custody check before the wipe (REQ-ERR-30): the recognition is asked again, so a check-in or
      // a handover since the page loaded is seen, and a unit still in custody gets nothing written.
      await registry.refreshRecognition(connectionId);
      const custody = registry.get(connectionId)?.recognized?.contract;
      if (custody) throw new DockingError('refused', custodyText(target.assetTag, custody.code));
      const { nodeNum } = await registry.withWriteLock(connectionId, async (port, stage) => {
        const hooks = hooksFor(target.deviceId, stage, connectionId);
        try {
          hooks.onStage('reading');
          await service.readUnit(port);
          return await service.factoryReset(target, hooks);
        } finally {
          await service.release();
        }
      });
      wiped = true;
      await recordReset(target.deviceId, nodeNum);
      return { ok: true, wiped };
    } catch (error) {
      return { ok: false, wiped, ...failureOf(error) };
    } finally {
      pendingReconnect.current = null;
      if (registry.reconnectOffer) registry.offerReconnect(null);
      setState(IDLE);
      await registry.refreshRecognition(connectionId);
    }
  };

  return {
    supported,
    state,
    busy: state.stage !== null,
    reboot,
    factoryReset,
    readUnit,
    dockAndProvision,
    exchangeAndProvision,
    configureUplink,
    reconnect,
    giveUp,
  };
};
