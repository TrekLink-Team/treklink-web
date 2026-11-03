// The one adapter between TrekLink and the Meshtastic client libraries (devices design section 8.1,
// D-082 decision 3): `@meshtastic/core` 2.6.7 and `@meshtastic/transport-web-serial` 0.2.5, pinned
// exactly. Nothing else in the frontend imports them, so a later fork replaces this file only.
//
// A docking is one session on one Web Serial port: open the port, run the config-only handshake
// (`want_config_id` 69420, design section 8.2), write inside one edit transaction, wait for the one
// restart the commit causes, read back. The session holds the unit's raw messages (the channel PSK, the
// Wi-Fi and broker passwords) only while it is open; `close()` drops them, and the readings it hands
// out carry no secret (REQ-UBI-05). The libraries' own logger is silenced, so nothing about the unit
// reaches the console through it.
//
// The libraries are loaded on first use, so pages that never dock do not download them. Their npm build
// carries a Node logger; `vite.config.ts` stubs the three Node built-ins it imports for the browser.

export const CONFIG_ONLY_NONCE = 69420;
const BAUD_RATE = 115200;
const PRIMARY_ROLE = 1;

// The timings are estimates, not measured on hardware: a commit restarts the unit 7 s later
// (firmware `configuration.h:372`), and an ESP32 boots in a few seconds.
export interface DockTimings {
  handshakeMs: number;
  writeMs: number;
  restartDelayMs: number;
  restartDeadlineMs: number;
  retryMs: number;
}

export const DEFAULT_TIMINGS: DockTimings = {
  handshakeMs: 8000,
  writeMs: 10000,
  restartDelayMs: 15000,
  restartDeadlineMs: 60000,
  retryMs: 2000,
};

// What went wrong, in terms the pages can word (REQ-ERR-13, REQ-ERR-14, REQ-ERR-15).
export type DockFailure =
  | 'unsupported'
  | 'no-port'
  | 'port-busy'
  | 'no-response'
  | 'incomplete'
  | 'disconnected'
  | 'write-refused'
  | 'write-timeout';

export class DockError extends Error {
  constructor(
    readonly failure: DockFailure,
    readonly step: string,
    message: string,
  ) {
    super(message);
    this.name = 'DockError';
  }
}

// The unit as the handshake reported it, without any secret.
export interface UnitReading {
  nodeNum: number;
  nodeId: string;
  pioEnv: string | null;
  firmwareVersion: string | null;
  longName: string;
  shortName: string;
}

export interface UplinkSettings {
  wifiSsid: string;
  wifiPassword: string;
  brokerAddress: string;
  brokerUsername: string;
  brokerPassword: string;
  tls: boolean;
}

// Frozen by D-005: shown read-only and always written.
export const UPLINK_ROOT = 'treklink';

export interface DockSession {
  readonly unit: UnitReading;
  // Whether channel 0 carries exactly this PSK.
  primaryKeyEquals(key: Uint8Array): boolean;
  // The checks of design section 8.8 step 3 that this unit fails for these settings; empty on a match.
  uplinkDifferences(settings: UplinkSettings): string[];
  // set_owner and set_channel 0 inside one edit transaction (design section 8.4 step 4).
  writeOwnerAndChannel(owner: { longName: string; shortName: string }, key: Uint8Array): Promise<void>;
  // set_config network, set_module_config MQTT and set_channel 0 inside one transaction (section 8.8).
  writeUplink(settings: UplinkSettings): Promise<void>;
  // Waits for the restart the commit causes and docks again. Null when the port did not come back
  // before the deadline: the page then asks Staff to reconnect (a user gesture opens the chooser).
  awaitRestart(): Promise<DockSession | null>;
  close(): Promise<void>;
}

export const toNodeId = (nodeNum: number) => `!${(nodeNum >>> 0).toString(16).padStart(8, '0')}`;

const serial = (): Serial | null =>
  typeof navigator !== 'undefined' && 'serial' in navigator ? navigator.serial : null;

// Web Serial needs a Chromium desktop browser and a secure context (design section 8.1).
export const isDockSupported = (): boolean =>
  serial() !== null && (typeof window === 'undefined' || window.isSecureContext !== false);

// A port this site may already use: the only granted port that is connected, else null.
export const grantedPort = async (): Promise<SerialPort | null> => {
  const ports = (await serial()?.getPorts()) ?? [];
  return ports.length === 1 ? ports[0] : null;
};

// The browser's own chooser; needs a user gesture (REQ-UBI-05).
export const choosePort = async (): Promise<SerialPort> => {
  const api = serial();
  if (!api) throw new DockError('unsupported', 'choose port', 'Web Serial is not available.');
  try {
    return await api.requestPort();
  } catch {
    throw new DockError('no-port', 'choose port', 'No port was chosen.');
  }
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The structural slice of the library's protobuf messages this file reads and writes. The npm `core`
// types refer to `@meshtastic/protobufs`, which is bundled and not installed, so they resolve to any.
interface ProtoMessage {
  $typeName?: string;
  [field: string]: unknown;
}
interface Variant {
  case?: string;
  value?: ProtoMessage;
}
interface ChannelMessage extends ProtoMessage {
  index: number;
  role: number;
  settings?: ProtoMessage & { psk?: Uint8Array; uplinkEnabled?: boolean };
}

type CoreModule = typeof import('@meshtastic/core');
type MeshDeviceInstance = InstanceType<CoreModule['MeshDevice']>;

let libraries: Promise<
  [CoreModule, typeof import('@meshtastic/transport-web-serial')]
> | null = null;
const loadLibraries = () => {
  libraries ??= Promise.all([import('@meshtastic/core'), import('@meshtastic/transport-web-serial')]);
  return libraries;
};

// Owns the port's streams for the library. The library's transport cannot release the port's readable
// lock on disconnect (its device keeps the stream piped), so a real `SerialPort.close()` would fail and
// leave the port open; the link reads and writes the port itself and can always let it go.
class PortLink {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  readonly lost: Promise<void>;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null;
  private closing = false;
  private markLost: () => void = () => undefined;
  private readonly onDisconnect = (event: Event) => {
    if ((event as Event & { port?: unknown }).port === this.port) this.markLost();
  };

  constructor(private readonly port: SerialPort) {
    if (!port.readable || !port.writable) throw new Error('The port is not open.');
    this.reader = port.readable.getReader();
    this.writer = port.writable.getWriter();
    this.lost = new Promise((resolve) => {
      this.markLost = () => {
        if (!this.closing) resolve();
      };
    });
    serial()?.addEventListener('disconnect', this.onDisconnect);
    // A failed read ends the stream instead of erroring it: the library pipes this stream without a
    // rejection handler, so an error would surface as an uncaught rejection in the console. The loss
    // is reported through `lost`.
    this.readable = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        try {
          const chunk = await this.reader?.read();
          if (!chunk || chunk.done) {
            this.markLost();
            controller.close();
          } else controller.enqueue(chunk.value);
        } catch {
          this.markLost();
          controller.close();
        }
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        try {
          await this.writer?.write(chunk);
        } catch (error) {
          this.markLost();
          throw error;
        }
      },
    });
  }

  // The SerialPort shape the library's transport takes.
  asPort(): SerialPort {
    return {
      readable: this.readable,
      writable: this.writable,
      close: () => this.close(),
    } as unknown as SerialPort;
  }

  async close() {
    if (this.closing) return;
    this.closing = true;
    serial()?.removeEventListener('disconnect', this.onDisconnect);
    try {
      await this.reader?.cancel();
    } catch {
      // The port already failed.
    }
    this.reader?.releaseLock();
    this.writer?.releaseLock();
    this.reader = null;
    this.writer = null;
    try {
      await this.port.close();
    } catch {
      // A port the browser dropped is closed already.
    }
  }
}

const withTimeout = <T>(work: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

class Session implements DockSession {
  unit!: UnitReading;
  private user: ProtoMessage | null = null;
  private channel: ChannelMessage | null = null;
  private networkConfig: ProtoMessage | null = null;
  private mqttConfig: ProtoMessage | null = null;
  private closed = false;

  constructor(
    private readonly port: SerialPort,
    private readonly link: PortLink,
    private readonly device: MeshDeviceInstance,
    private readonly timings: DockTimings,
  ) {}

  // The config-only handshake. A unit that sends nothing at all is the v2 USB gap (REQ-ERR-14).
  async handshake(core: CoreModule) {
    const { DeviceStatusEnum } = core.Types;
    const events = this.device.events;
    let heard = false;
    let nodeNum: number | null = null;
    let pioEnv: string | null = null;
    let firmwareVersion: string | null = null;

    const done = new Promise<void>((resolve, reject) => {
      events.onFromRadio.subscribe(() => {
        heard = true;
      });
      events.onMyNodeInfo.subscribe((info: ProtoMessage) => {
        nodeNum = Number(info.myNodeNum);
        pioEnv = (info.pioEnv as string) || null;
      });
      events.onNodeInfoPacket.subscribe((info: ProtoMessage) => {
        if (nodeNum !== null && Number(info.num) === nodeNum && info.user) {
          this.user = info.user as ProtoMessage;
        }
      });
      events.onDeviceMetadataPacket.subscribe((packet: { data: ProtoMessage }) => {
        firmwareVersion = (packet.data.firmwareVersion as string) || null;
      });
      events.onChannelPacket.subscribe((channel: ChannelMessage) => {
        if (channel.index === 0) this.channel = channel;
      });
      events.onConfigPacket.subscribe((config: ProtoMessage) => {
        if ((config.payloadVariant as Variant).case === 'network') this.networkConfig = config;
      });
      events.onModuleConfigPacket.subscribe((config: ProtoMessage) => {
        if ((config.payloadVariant as Variant).case === 'mqtt') this.mqttConfig = config;
      });
      events.onDeviceStatus.subscribe((status: number) => {
        if (status === DeviceStatusEnum.DeviceConfigured) resolve();
        if (status === DeviceStatusEnum.DeviceDisconnected) {
          reject(new DockError('disconnected', 'read', 'The unit disconnected while it was read.'));
        }
      });
      void this.link.lost.then(() =>
        reject(new DockError('disconnected', 'read', 'The unit disconnected while it was read.')),
      );
    });
    // The library resolves a want_config request only after its own 60 s queue timeout; the
    // configured status is the answer.
    this.device.configure().catch(() => undefined);
    await withTimeout(done, this.timings.handshakeMs, () =>
      heard
        ? new DockError('incomplete', 'read', 'The unit did not finish reporting its settings.')
        : new DockError('no-response', 'read', 'The unit answered nothing over USB.'),
    );
    if (nodeNum === null || !this.user || !this.channel?.settings) {
      throw new DockError('incomplete', 'read', 'The unit did not report its node, owner or channel.');
    }
    this.unit = {
      nodeNum,
      nodeId: toNodeId(nodeNum),
      pioEnv,
      firmwareVersion,
      longName: String(this.user.longName ?? ''),
      shortName: String(this.user.shortName ?? ''),
    };
  }

  primaryKeyEquals(key: Uint8Array) {
    const psk = this.channel?.settings?.psk;
    return !!psk && psk.length === key.length && psk.every((byte, index) => byte === key[index]);
  }

  uplinkDifferences(settings: UplinkSettings) {
    const network = (this.networkConfig?.payloadVariant as Variant | undefined)?.value ?? {};
    const mqtt = (this.mqttConfig?.payloadVariant as Variant | undefined)?.value ?? {};
    const checks: [string, boolean][] = [
      ['Wi-Fi on', network.wifiEnabled === true],
      ['Wi-Fi network name', network.wifiSsid === settings.wifiSsid],
      ['MQTT on', mqtt.enabled === true],
      ['broker address', mqtt.address === settings.brokerAddress],
      ['broker user name', mqtt.username === settings.brokerUsername],
      ['TLS', mqtt.tlsEnabled === settings.tls],
      ['JSON on', mqtt.jsonEnabled === true],
      ['MQTT encryption off', mqtt.encryptionEnabled === false],
      [`root ${UPLINK_ROOT}`, mqtt.root === UPLINK_ROOT],
      ['uplink on channel 0', this.channel?.settings?.uplinkEnabled === true],
    ];
    return checks.filter(([, passed]) => !passed).map(([name]) => name);
  }

  private async admin(step: string, send: () => Promise<number>) {
    if (this.closed) throw new DockError('disconnected', step, 'The docking has ended.');
    const lost = this.link.lost.then(() => {
      throw new DockError('disconnected', step, `The unit disconnected during ${step}.`);
    });
    try {
      await withTimeout(
        Promise.race([send(), lost]),
        this.timings.writeMs,
        () => new DockError('write-timeout', step, `The unit did not acknowledge ${step}.`),
      );
    } catch (error) {
      if (error instanceof DockError) throw error;
      // The library rejects with { id, error } on a routing error.
      throw new DockError('write-refused', step, `The unit refused ${step}.`);
    }
  }

  private beginEdit() {
    // `beginEditSettings` is private in the library's types; the commit counterpart is public.
    const device = this.device as unknown as { beginEditSettings(): Promise<number> };
    return this.admin('begin_edit_settings', () => device.beginEditSettings());
  }

  private async commit() {
    try {
      await this.admin('commit_edit_settings', () => this.device.commitEditSettings());
    } catch (error) {
      // A unit that restarts before its acknowledgement arrives is judged by the read-back.
      if (!(error instanceof DockError && error.failure === 'disconnected')) throw error;
    }
  }

  private requireChannel(): ChannelMessage & { settings: ProtoMessage } {
    if (!this.channel?.settings) {
      throw new DockError('incomplete', 'set_channel', 'The unit did not report channel 0.');
    }
    return this.channel as ChannelMessage & { settings: ProtoMessage };
  }

  async writeOwnerAndChannel(owner: { longName: string; shortName: string }, key: Uint8Array) {
    const channel = this.requireChannel();
    const user = this.user;
    if (!user) throw new DockError('incomplete', 'set_owner', 'The unit did not report its owner.');
    await this.beginEdit();
    await this.admin('set_owner', () =>
      this.device.setOwner({ ...user, longName: owner.longName, shortName: owner.shortName } as never),
    );
    await this.admin('set_channel', () =>
      this.device.setChannel({
        ...channel,
        index: 0,
        role: PRIMARY_ROLE,
        settings: { ...channel.settings, psk: key },
      } as never),
    );
    await this.commit();
  }

  async writeUplink(settings: UplinkSettings) {
    const channel = this.requireChannel();
    const network = this.networkConfig;
    const mqtt = this.mqttConfig;
    if (!network || !mqtt) {
      throw new DockError('incomplete', 'set_config', 'The unit did not report its network or MQTT settings.');
    }
    const networkValue = (network.payloadVariant as Variant).value;
    const mqttValue = (mqtt.payloadVariant as Variant).value;
    await this.beginEdit();
    await this.admin('set_config network', () =>
      this.device.setConfig({
        ...network,
        payloadVariant: {
          case: 'network',
          value: {
            ...networkValue,
            wifiEnabled: true,
            wifiSsid: settings.wifiSsid,
            wifiPsk: settings.wifiPassword,
          },
        },
      } as never),
    );
    await this.admin('set_module_config MQTT', () =>
      this.device.setModuleConfig({
        ...mqtt,
        payloadVariant: {
          case: 'mqtt',
          value: {
            ...mqttValue,
            enabled: true,
            address: settings.brokerAddress,
            username: settings.brokerUsername,
            password: settings.brokerPassword,
            tlsEnabled: settings.tls,
            jsonEnabled: true,
            encryptionEnabled: false,
            root: UPLINK_ROOT,
          },
        },
      } as never),
    );
    await this.admin('set_channel uplink', () =>
      this.device.setChannel({
        ...channel,
        settings: { ...channel.settings, uplinkEnabled: true },
      } as never),
    );
    await this.commit();
  }

  async awaitRestart(): Promise<DockSession | null> {
    const info = this.port.getInfo();
    // A USB to UART bridge (v3) keeps the port through the restart; native USB (v4) drops it.
    await Promise.race([this.link.lost, sleep(this.timings.restartDelayMs)]);
    await this.close();
    const deadline = Date.now() + this.timings.restartDeadlineMs;
    while (Date.now() < deadline) {
      const ports = (await serial()?.getPorts()) ?? [];
      const port =
        ports.find((candidate) => candidate === this.port) ??
        ports.find((candidate) => {
          const other = candidate.getInfo();
          return (
            other.usbVendorId === info.usbVendorId && other.usbProductId === info.usbProductId
          );
        });
      if (port) {
        try {
          return await openDock(port, this.timings);
        } catch {
          // Still booting, or the port is not ready yet: try again until the deadline.
        }
      }
      await sleep(this.timings.retryMs);
    }
    return null;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.user = null;
    this.channel = null;
    this.networkConfig = null;
    this.mqttConfig = null;
    this.device.complete();
    await this.link.close();
  }
}

// Opens the port, runs the handshake and returns the open session. Any failure closes the port.
export const openDock = async (
  port: SerialPort,
  timings: DockTimings = DEFAULT_TIMINGS,
): Promise<DockSession> => {
  const [core, { TransportWebSerial }] = await loadLibraries();
  try {
    await port.open({ baudRate: BAUD_RATE });
  } catch {
    throw new DockError(
      'port-busy',
      'open',
      'The port could not be opened. Close other apps that use the unit and try again.',
    );
  }
  let link: PortLink;
  try {
    link = new PortLink(port);
  } catch {
    await port.close().catch(() => undefined);
    throw new DockError('port-busy', 'open', 'The port could not be opened.');
  }
  const transport = new TransportWebSerial(link.asPort());
  const device = new core.MeshDevice(transport, CONFIG_ONLY_NONCE);
  // tslog: 7 is above its highest level, so no log line is built or printed.
  device.log.settings.minLevel = 7;
  device.log.settings.type = 'hidden';
  const session = new Session(port, link, device, timings);
  try {
    await session.handshake(core);
    return session;
  } catch (error) {
    await session.close();
    throw error;
  }
};
