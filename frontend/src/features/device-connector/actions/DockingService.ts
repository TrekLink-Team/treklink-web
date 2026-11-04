import {
  DEFAULT_TIMINGS,
  DockError,
  openDock,
  toNodeId,
  type DockSession,
  type DockTimings,
  type ReturnedPortFinder,
  type UnitReading,
  type UplinkSettings,
} from '../../../shared/lib/meshtastic-dock';

// The docking flows of devices design sections 8.3, 8.4 and 8.8 over the one adapter. The service keeps
// the open session between `readUnit()` and the write that follows it, and closes it when the flow
// ends, whatever the outcome. It never stores the key it is handed (REQ-UBI-05). The port comes from the
// device connector's registry (design section 11.2), which alone chooses and enumerates ports.

export type DockStage = 'reading' | 'getting-key' | 'writing' | 'restarting' | 'reconnect' | 'checking';

export type DockingFailure =
  // The docked unit is another device (REQ-ERR-12).
  | 'mismatch'
  // The unit answered nothing over USB: the v2 gap (REQ-ERR-14).
  | 'no-response'
  // A port, read or write step failed (REQ-ERR-13).
  | 'dock'
  // The read-back after the restart differs (REQ-ERR-13, REQ-ERR-15).
  | 'read-back'
  // The unit did not come back after its restart and Staff did not reconnect it.
  | 'not-returned'
  // Staff closed the browser's port chooser.
  | 'cancelled'
  // Several units are connected and none is the expected one: Staff choose in the connector.
  | 'choose'
  // The unit may not take this write now, checked before anything is sent (REQ-ERR-30).
  | 'refused';

export class DockingError extends Error {
  constructor(
    readonly failure: DockingFailure,
    message: string,
    // The node id of the unit that was docked, for the mismatch message.
    readonly nodeId?: string,
  ) {
    super(message);
    this.name = 'DockingError';
  }
}

export interface ExpectedUnit {
  assetTag: string;
  nodeNum: number | null | undefined;
}

export interface DockHooks {
  onStage: (stage: DockStage) => void;
  // Called when the port did not come back by itself; resolves with the port Staff chose in the
  // browser's chooser, or null when they gave up.
  reconnect: () => Promise<SerialPort | null>;
  // The port the unit came back on after its restart (the connector's registry knows which ports
  // belong to other units, design section 11.4 rule 1).
  findReturned?: ReturnedPortFinder;
}

// The owner names TrekLink writes (D-080 rule 2, design section 8.6 decision 2): the long name is the
// asset tag (39 characters at most, `mesh.pb.h:704`), the short name its last four characters.
export const ownerFor = (assetTag: string) => ({
  longName: assetTag.slice(0, 39),
  shortName: assetTag.slice(-4),
});

// `Config.LoRaConfig.RegionCode.UNSET`.
export const UNSET_REGION = 0;

// The delay the reboot asks for, in seconds: long enough for its acknowledgement to arrive first.
export const REBOOT_SECONDS = 2;

const fromDockError = (error: unknown): DockingError => {
  if (error instanceof DockingError) return error;
  if (error instanceof DockError) {
    if (error.failure === 'no-response') return new DockingError('no-response', error.message);
    if (error.failure === 'no-port') return new DockingError('cancelled', error.message);
    return new DockingError('dock', error.message);
  }
  return new DockingError('dock', 'The docking failed.');
};

export class DockingService {
  private session: DockSession | null = null;

  constructor(private readonly timings: DockTimings = DEFAULT_TIMINGS) {}

  // Opens the port the connector lends and runs the config-only handshake (design section 8.4 step 1).
  // The session stays open for a write.
  async readUnit(port: SerialPort): Promise<UnitReading> {
    await this.release();
    try {
      this.session = await openDock(port, this.timings);
      return this.session.unit;
    } catch (error) {
      throw fromDockError(error);
    }
  }

  // Closes the open session, if any.
  async release() {
    const session = this.session;
    this.session = null;
    await session?.close();
  }

  // The mismatch guard (REQ-ERR-12): a docked unit that is not the expected device closes the session
  // before anything is written or a key is asked for.
  async confirmUnit(expected: ExpectedUnit): Promise<DockSession> {
    const session = this.session;
    if (!session) throw new DockingError('dock', 'Dock the unit first.');
    if (session.unit.nodeNum !== expected.nodeNum) {
      await this.release();
      throw new DockingError(
        'mismatch',
        `The docked unit is ${session.unit.nodeId}, not ${expected.assetTag}. Nothing was written.`,
        session.unit.nodeId,
      );
    }
    return session;
  }

  // The restart the commit causes, then a fresh handshake; the reconnect prompt when the browser
  // dropped the port (design section 8.4 step 4, section 8.8 step 3).
  private async afterRestart(session: DockSession, hooks: DockHooks): Promise<DockSession> {
    hooks.onStage('restarting');
    this.session = null;
    let back = await session.awaitRestart(hooks.findReturned);
    while (!back) {
      hooks.onStage('reconnect');
      const port = await hooks.reconnect();
      if (!port) {
        throw new DockingError('not-returned', 'The unit did not come back after its restart.');
      }
      hooks.onStage('checking');
      try {
        back = await openDock(port, this.timings);
      } catch {
        // The chosen port did not answer yet: ask again.
      }
    }
    hooks.onStage('checking');
    return back;
  }

  // Writes the owner names and the channel key, then reads them back (design section 8.4 steps 4
  // and 5). The key is only read here; the caller wipes it.
  async provision(
    expected: ExpectedUnit,
    key: Uint8Array,
    keyVersion: number,
    hooks: DockHooks,
  ): Promise<{ nodeNum: number; keyVersion: number }> {
    const session = await this.confirmUnit(expected);
    const owner = ownerFor(expected.assetTag);
    hooks.onStage('writing');
    try {
      await session.writeOwnerAndChannel(owner, key);
    } catch (error) {
      await this.release();
      throw fromDockError(error);
    }
    const back = await this.afterRestart(session, hooks);
    try {
      const differs = [
        back.unit.nodeNum !== expected.nodeNum && `node ${back.unit.nodeId}`,
        back.unit.longName !== owner.longName && 'owner long name',
        back.unit.shortName !== owner.shortName && 'owner short name',
        !back.primaryKeyEquals(key) && 'channel key',
      ].filter((item): item is string => Boolean(item));
      if (differs.length > 0) {
        throw new DockingError('read-back', `The read-back differs: ${differs.join(', ')}.`);
      }
      return { nodeNum: back.unit.nodeNum, keyVersion };
    } finally {
      await back.close();
    }
  }

  // Reboot (devices design section 11.13, REQ-EVT-43): `reboot_seconds`, the restart, and the same node
  // number again. Nothing is recorded on the server.
  async reboot(expected: { nodeNum: number }, hooks: DockHooks): Promise<void> {
    const session = this.session;
    if (!session) throw new DockingError('dock', 'Dock the unit first.');
    if (session.unit.nodeNum !== expected.nodeNum) {
      await this.release();
      throw new DockingError('mismatch', `The docked unit is ${session.unit.nodeId}. Nothing was sent.`, session.unit.nodeId);
    }
    hooks.onStage('writing');
    try {
      await session.reboot(REBOOT_SECONDS);
    } catch (error) {
      await this.release();
      throw fromDockError(error);
    }
    const back = await this.afterRestart(session, hooks);
    try {
      if (back.unit.nodeNum !== expected.nodeNum) {
        throw new DockingError('read-back', `A different unit answered after the restart: ${back.unit.nodeId}.`);
      }
    } finally {
      await back.close();
    }
  }

  // Factory reset of a returned unit (devices design section 11.13 steps 2 to 6, REQ-EVT-44):
  // `factory_reset_config`, the restart, the owner of the asset tag and the region read before the reset
  // written back in one transaction, the second restart, and the read-back. The caller records the reset.
  async factoryReset(expected: ExpectedUnit, hooks: DockHooks): Promise<{ nodeNum: number }> {
    const session = await this.confirmUnit(expected);
    const region = session.loraRegion();
    // No LoRa config, or UNSET (0), leaves nothing to write back: the reset unit would drop every received
    // LoRa packet (firmware `RadioLibInterface.cpp:547-552`), so the unit is refused before the wipe.
    if (region === null || region === UNSET_REGION) {
      await this.release();
      throw new DockingError(
        'refused',
        `${expected.assetTag} reports no LoRa region, so it could not be written back after the reset. Set its region first. Nothing was written.`,
      );
    }
    hooks.onStage('writing');
    try {
      await session.factoryResetConfig();
    } catch (error) {
      await this.release();
      throw fromDockError(error);
    }
    const wiped = await this.afterRestart(session, hooks);
    if (wiped.unit.nodeNum !== expected.nodeNum) {
      await wiped.close();
      throw new DockingError('read-back', `A different unit answered after the reset: ${wiped.unit.nodeId}.`);
    }
    const owner = ownerFor(expected.assetTag);
    hooks.onStage('writing');
    try {
      await wiped.writeOwnerAndRegion(owner, region);
    } catch (error) {
      await wiped.close();
      throw fromDockError(error);
    }
    const back = await this.afterRestart(wiped, hooks);
    try {
      const differs = [
        back.unit.nodeNum !== expected.nodeNum && `node ${back.unit.nodeId}`,
        back.unit.longName !== owner.longName && 'owner long name',
        back.unit.shortName !== owner.shortName && 'owner short name',
        back.loraRegion() !== region && 'region',
        !back.primaryKeyIsDefault() && 'channel key',
        !back.networkOff() && 'Wi-Fi and MQTT off',
      ].filter((item): item is string => Boolean(item));
      if (differs.length > 0) {
        throw new DockingError('read-back', `The read-back differs: ${differs.join(', ')}.`);
      }
      return { nodeNum: back.unit.nodeNum };
    } finally {
      await back.close();
    }
  }

  // The Stage A uplink of design section 8.8: writes, restart, read-back of the named checks.
  async configureUplink(
    expected: ExpectedUnit,
    settings: UplinkSettings,
    hooks: DockHooks,
  ): Promise<void> {
    const session = await this.confirmUnit(expected);
    hooks.onStage('writing');
    try {
      await session.writeUplink(settings);
    } catch (error) {
      await this.release();
      throw fromDockError(error);
    }
    const back = await this.afterRestart(session, hooks);
    try {
      const differs = [
        ...(back.unit.nodeNum !== expected.nodeNum ? [`node ${toNodeId(back.unit.nodeNum)}`] : []),
        ...back.uplinkDifferences(settings),
      ];
      if (differs.length > 0) {
        throw new DockingError('read-back', `The read-back differs: ${differs.join(', ')}.`);
      }
    } finally {
      await back.close();
    }
  }
}
