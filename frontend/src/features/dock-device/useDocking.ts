import { useCallback, useEffect, useRef, useState } from 'react';
import { issueChannelKey } from '../../entities/contract/api';
import { ApiError } from '../../shared/api/apiClient';
import {
  choosePort,
  isDockSupported,
  toNodeId,
  type DockTimings,
  type UnitReading,
  type UplinkSettings,
} from '../../shared/lib/meshtastic-dock';
import {
  DockingError,
  DockingService,
  type DockStage,
  type ExpectedUnit,
} from './DockingService';
import type { DockingFailureInfo } from './messages';

// The hook the pages call for a docking (devices design section 8.1). One docking runs at a time; the
// state names the row or device it runs for and its stage, for the "Docking in progress" state of
// screen 5.4 and the restart wait of screen 4.2.
//
// The channel key (rentals api-design 21) lives in one local variable of `dockAndProvision` and is
// wiped when `provision` returns, before the caller records anything. It never enters React state,
// the query cache, storage or a log line (REQ-UBI-05).

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

export const useDocking = (options: { timings?: DockTimings } = {}) => {
  const [service] = useState(() => new DockingService(options.timings));
  const [state, setState] = useState<DockingState>(IDLE);
  const pendingReconnect = useRef<((port: SerialPort | null) => void) | null>(null);
  const supported = isDockSupported();

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

  const hooksFor = (target: string) => ({
    onStage: (stage: DockStage) => setState({ target, stage }),
    reconnect: () =>
      new Promise<SerialPort | null>((resolve) => {
        pendingReconnect.current = resolve;
      }),
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

  // Read from unit on the Register panel (design section 8.3): read, then let the port go.
  const readUnit = async (target = 'intake'): Promise<DockResult<{ unit: UnitReading }>> => {
    setState({ target, stage: 'reading' });
    try {
      const unit = await service.readUnit();
      return { ok: true, unit };
    } catch (error) {
      return { ok: false, ...failureOf(error) };
    } finally {
      await service.release();
      setState(IDLE);
    }
  };

  // Dock and provision on a counter row (design section 8.4 steps 1 to 4). The caller records the
  // provisioning with the returned nodeNum and keyVersion (step 5).
  const dockAndProvision = async (
    target: ProvisionTarget,
  ): Promise<DockResult<{ nodeNum: number; keyVersion: number }>> => {
    const hooks = hooksFor(target.deviceId);
    let key: Uint8Array | null = null;
    try {
      hooks.onStage('reading');
      await service.readUnit();
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
          );
        }
        throw error;
      }
      const result = await service.provision(target, key, keyVersion, hooks);
      return { ok: true, ...result };
    } catch (error) {
      await service.release();
      return { ok: false, ...failureOf(error) };
    } finally {
      key?.fill(0);
      pendingReconnect.current = null;
      setState(IDLE);
    }
  };

  // Configure uplink on the device page (design section 8.8). The settings are only read here; the
  // caller clears the passwords afterwards.
  const configureUplink = async (
    target: ExpectedUnit & { deviceId: string },
    settings: UplinkSettings,
  ): Promise<DockResult<object>> => {
    const hooks = hooksFor(target.deviceId);
    try {
      hooks.onStage('reading');
      await service.readUnit();
      await service.configureUplink(target, settings, hooks);
      return { ok: true };
    } catch (error) {
      await service.release();
      return { ok: false, ...failureOf(error) };
    } finally {
      pendingReconnect.current = null;
      setState(IDLE);
    }
  };

  return {
    supported,
    state,
    busy: state.stage !== null,
    readUnit,
    dockAndProvision,
    configureUplink,
    reconnect,
    giveUp,
  };
};
