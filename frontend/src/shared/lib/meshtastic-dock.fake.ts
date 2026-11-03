// A fake TrekLink unit behind a fake Web Serial port, for the tests of the docking adapter and the
// docking feature only. It speaks the wire the firmware speaks (devices design section 8.2): frames of
// 0x94 0xC3 and a 16-bit length, ToRadio in, FromRadio out, with the protobuf field numbers of the
// firmware's generated headers. It encodes and decodes with a small hand-written codec, so the tests
// do not check the library against itself. Nothing here is imported by application code.

type Scalar = number | boolean | string | Uint8Array;
type Value = Scalar | { fixed32: number } | Encoded;
class Encoded {
  constructor(readonly bytes: Uint8Array) {}
}

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const varint = (input: number): Uint8Array => {
  const bytes: number[] = [];
  let value = input;
  while (value > 127) {
    bytes.push((value % 128) | 128);
    value = Math.floor(value / 128);
  }
  bytes.push(value);
  return new Uint8Array(bytes);
};

// Encodes the fields in order. A field listed is always written, zero included, as nanopb writes a set
// oneof member (a routing ack carries `error_reason` 0 explicitly).
export const message = (fields: [number, Value | undefined][]): Encoded =>
  new Encoded(
    concat(
      fields.flatMap(([field, value]) => {
        if (value === undefined) return [];
        if (value instanceof Encoded) {
          return [varint(field * 8 + 2), varint(value.bytes.length), value.bytes];
        }
        if (value instanceof Uint8Array) return [varint(field * 8 + 2), varint(value.length), value];
        if (typeof value === 'string') {
          const bytes = new TextEncoder().encode(value);
          return [varint(field * 8 + 2), varint(bytes.length), bytes];
        }
        if (typeof value === 'object') {
          const bytes = new Uint8Array(4);
          new DataView(bytes.buffer).setUint32(0, value.fixed32 >>> 0, true);
          return [varint(field * 8 + 5), bytes];
        }
        return [varint(field * 8), varint(typeof value === 'boolean' ? Number(value) : value)];
      }),
    ),
  );

export type Decoded = Map<number, (number | Uint8Array)[]>;

export const decode = (bytes: Uint8Array): Decoded => {
  const fields: Decoded = new Map();
  let at = 0;
  const readVarint = () => {
    let result = 0;
    let scale = 1;
    for (;;) {
      const byte = bytes[at++];
      result += (byte & 127) * scale;
      if (byte < 128) return result;
      scale *= 128;
    }
  };
  while (at < bytes.length) {
    const key = readVarint();
    const field = Math.floor(key / 8);
    const wire = key % 8;
    let value: number | Uint8Array;
    if (wire === 0) value = readVarint();
    else if (wire === 2) {
      const length = readVarint();
      value = bytes.subarray(at, at + length);
      at += length;
    } else if (wire === 5) {
      value = new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0, true);
      at += 4;
    } else if (wire === 1) {
      value = bytes.subarray(at, at + 8);
      at += 8;
    } else throw new Error(`wire type ${wire} not handled by the fake`);
    fields.set(field, [...(fields.get(field) ?? []), value]);
  }
  return fields;
};

const first = (fields: Decoded, field: number) => fields.get(field)?.[0];
const num = (fields: Decoded, field: number) => (first(fields, field) as number | undefined) ?? 0;
const bytesOf = (fields: Decoded, field: number) =>
  (first(fields, field) as Uint8Array | undefined) ?? new Uint8Array();
const text = (fields: Decoded, field: number) => new TextDecoder().decode(bytesOf(fields, field));
const nested = (fields: Decoded, field: number): Decoded | null => {
  const value = first(fields, field);
  return value instanceof Uint8Array ? decode(value) : null;
};

export interface UnitState {
  nodeNum: number;
  pioEnv: string;
  firmwareVersion: string;
  longName: string;
  shortName: string;
  psk: Uint8Array;
  channelName: string;
  uplinkEnabled: boolean;
  wifiEnabled: boolean;
  wifiSsid: string;
  wifiPsk: string;
  ntpServer: string;
  mqtt: {
    enabled: boolean;
    address: string;
    username: string;
    password: string;
    encryptionEnabled: boolean;
    jsonEnabled: boolean;
    tlsEnabled: boolean;
    root: string;
  };
}

export const unitState = (change: Partial<UnitState> = {}): UnitState => ({
  nodeNum: 0xa4b1c2d4,
  pioEnv: 'treklink-v3-tbeam',
  firmwareVersion: '2.7.26.a4aa98d',
  longName: 'Meshtastic c2d4',
  shortName: 'c2d4',
  psk: new Uint8Array([1]),
  channelName: '',
  uplinkEnabled: false,
  wifiEnabled: false,
  wifiSsid: '',
  wifiPsk: '',
  ntpServer: 'meshtastic.pool.ntp.org',
  mqtt: {
    enabled: false,
    address: 'mqtt.meshtastic.org',
    username: 'meshdev',
    password: 'large4cats',
    encryptionEnabled: true,
    jsonEnabled: false,
    tlsEnabled: false,
    root: 'msh',
  },
  ...change,
});

// How the fake unit misbehaves, one knob per failure the adapter must name.
export interface UnitBehaviour {
  // Answers nothing at all (a v2 unit on its USB port, vetting record section 3.3).
  silent?: boolean;
  // Drops the link when the nth admin write (1-based) arrives.
  dropOnAdminWrite?: number;
  // Never acknowledges the nth admin write.
  ignoreAdminWrite?: number;
  // Answers the nth admin write with a routing error.
  refuseAdminWrite?: number;
  // Does not keep the PSK it was sent on commit (a read-back that differs).
  losePskOnCommit?: boolean;
  // Does not keep the MQTT address on commit.
  loseMqttAddressOnCommit?: boolean;
  // How the commit restart looks from the browser: the port stays (a USB to UART bridge, v3), the port
  // drops and comes back as a granted port (native USB, v4), or the unit never comes back.
  restart?: 'port-stays' | 'port-returns' | 'never-returns';
  // Delay before the restart is visible, in milliseconds.
  restartAfterMs?: number;
}

export interface AdminWrite {
  variant:
    | 'set_owner'
    | 'set_channel'
    | 'set_config'
    | 'set_module_config'
    | 'begin_edit_settings'
    | 'commit_edit_settings'
    | 'other';
  fields: Decoded;
}

const ADMIN_VARIANTS: Record<number, AdminWrite['variant']> = {
  32: 'set_owner',
  33: 'set_channel',
  34: 'set_config',
  35: 'set_module_config',
  64: 'begin_edit_settings',
  65: 'commit_edit_settings',
};

type Listener = (event: { port: unknown }) => void;

// The navigator.serial the tests install: granted ports, the chooser's answer and the disconnect event.
export class FakeSerial {
  ports: FakePort[] = [];
  chooserAnswer: FakePort | null = null;
  requestCount = 0;
  private listeners = new Map<string, Set<Listener>>();

  async getPorts() {
    return this.ports.filter((port) => port.attached);
  }

  async requestPort() {
    this.requestCount += 1;
    if (!this.chooserAnswer) throw new DOMException('No port selected by the user.', 'NotFoundError');
    if (!this.ports.includes(this.chooserAnswer)) this.ports.push(this.chooserAnswer);
    return this.chooserAnswer;
  }

  addEventListener(type: string, listener: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, port: FakePort) {
    this.listeners.get(type)?.forEach((listener) => listener({ port }));
  }
}

// One USB device as the browser sees it. The unit state lives on the unit, so a port that drops and
// returns (v4) hands the same unit to a new port object.
export class FakePort {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  attached = true;
  openCount = 0;
  busy = false;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private buffer: Uint8Array = new Uint8Array();

  constructor(
    readonly unit: FakeUnit,
    private readonly serial: FakeSerial,
    private readonly info = { usbVendorId: 0x10c4, usbProductId: 0xea60 },
  ) {
    unit.port = this;
  }

  getInfo() {
    return this.info;
  }

  async open(_options: { baudRate: number }) {
    if (!this.attached) throw new DOMException('The device has been lost.', 'NetworkError');
    if (this.busy) throw new DOMException('Failed to open serial port.', 'NetworkError');
    if (this.readable) throw new DOMException('The port is already open.', 'InvalidStateError');
    this.openCount += 1;
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => this.receive(chunk),
    });
  }

  async close() {
    if (this.readable?.locked || this.writable?.locked) {
      throw new TypeError('Cannot close a port while its streams are locked.');
    }
    this.readable = null;
    this.writable = null;
    this.controller = null;
  }

  send(bytes: Uint8Array) {
    try {
      this.controller?.enqueue(
        concat([new Uint8Array([0x94, 0xc3, bytes.length >> 8, bytes.length & 255]), bytes]),
      );
    } catch {
      // The reader was cancelled; the bytes go nowhere, as on a closed port.
    }
  }

  // The USB device leaves: the open streams fail and the browser fires `disconnect`.
  detach() {
    this.attached = false;
    try {
      this.controller?.error(new DOMException('The device has been lost.', 'NetworkError'));
    } catch {
      // Already closed.
    }
    this.controller = null;
    this.serial.emit('disconnect', this);
  }

  private receive(chunk: Uint8Array) {
    if (!this.attached) throw new DOMException('The device has been lost.', 'NetworkError');
    this.buffer = concat([this.buffer, chunk]);
    while (this.buffer.length >= 4 && this.buffer[0] === 0x94 && this.buffer[1] === 0xc3) {
      const length = (this.buffer[2] << 8) + this.buffer[3];
      if (this.buffer.length < 4 + length) return;
      const frame = this.buffer.slice(4, 4 + length);
      this.buffer = this.buffer.slice(4 + length);
      this.unit.handle(frame);
    }
  }
}

export class FakeUnit {
  port: FakePort | null = null;
  readonly writes: AdminWrite[] = [];
  readonly handshakes: number[] = [];
  private pending: UnitState | null = null;
  private inTransaction = false;

  constructor(
    public state: UnitState,
    private readonly behaviour: UnitBehaviour = {},
    private readonly serial: FakeSerial,
  ) {}

  handle(frame: Uint8Array) {
    if (this.behaviour.silent) return;
    const toRadio = decode(frame);
    if (toRadio.has(3)) {
      this.handshakes.push(num(toRadio, 3));
      this.sendConfig(num(toRadio, 3));
      return;
    }
    const packet = nested(toRadio, 1);
    const data = packet && nested(packet, 4);
    if (!packet || !data || num(data, 1) !== 6) return;
    const admin = decode(bytesOf(data, 2));
    const fieldNo = [...admin.keys()][0];
    const write: AdminWrite = { variant: ADMIN_VARIANTS[fieldNo] ?? 'other', fields: admin };
    this.writes.push(write);
    const ordinal = this.writes.length;
    if (this.behaviour.dropOnAdminWrite === ordinal) {
      this.port?.detach();
      return;
    }
    if (this.behaviour.ignoreAdminWrite === ordinal) return;
    const refused = this.behaviour.refuseAdminWrite === ordinal;
    if (!refused) this.apply(write);
    this.ack(num(packet, 6), refused ? 32 : 0);
    if (write.variant === 'commit_edit_settings' && !refused) this.restart();
  }

  private apply(write: AdminWrite) {
    const value = (field: number) => nested(write.fields, field);
    const target = this.inTransaction ? (this.pending ?? this.state) : this.state;
    switch (write.variant) {
      case 'begin_edit_settings':
        this.inTransaction = true;
        this.pending = { ...this.state, mqtt: { ...this.state.mqtt } };
        return;
      case 'set_owner': {
        const user = value(32);
        if (user) Object.assign(target, { longName: text(user, 2), shortName: text(user, 3) });
        return;
      }
      case 'set_channel': {
        const channel = value(33);
        const settings = channel && nested(channel, 2);
        if (channel && num(channel, 1) === 0 && settings) {
          Object.assign(target, {
            psk: bytesOf(settings, 2).slice(),
            channelName: text(settings, 3),
            uplinkEnabled: num(settings, 5) === 1,
          });
        }
        return;
      }
      case 'set_config': {
        const network = nested(value(34) ?? new Map(), 4);
        if (network) {
          Object.assign(target, {
            wifiEnabled: num(network, 1) === 1,
            wifiSsid: text(network, 3),
            wifiPsk: text(network, 4),
            ntpServer: text(network, 5),
          });
        }
        return;
      }
      case 'set_module_config': {
        const mqtt = nested(value(35) ?? new Map(), 1);
        if (mqtt) {
          target.mqtt = {
            enabled: num(mqtt, 1) === 1,
            address: text(mqtt, 2),
            username: text(mqtt, 3),
            password: text(mqtt, 4),
            encryptionEnabled: num(mqtt, 5) === 1,
            jsonEnabled: num(mqtt, 6) === 1,
            tlsEnabled: num(mqtt, 7) === 1,
            root: text(mqtt, 8),
          };
        }
        return;
      }
      case 'commit_edit_settings':
        if (this.pending) {
          const before = this.state;
          this.state = this.pending;
          if (this.behaviour.losePskOnCommit) this.state.psk = before.psk;
          if (this.behaviour.loseMqttAddressOnCommit) this.state.mqtt.address = before.mqtt.address;
        }
        this.pending = null;
        this.inTransaction = false;
        return;
      default:
    }
  }

  private ack(requestId: number, errorReason: number) {
    const routing = message([[3, errorReason]]);
    const data = message([
      [1, 5],
      [2, routing],
      [6, { fixed32: requestId }],
    ]);
    const packet = message([
      [1, { fixed32: this.state.nodeNum }],
      [2, { fixed32: this.state.nodeNum }],
      [4, data],
      [6, { fixed32: (requestId + 1) >>> 0 }],
    ]);
    this.port?.send(message([[2, packet]]).bytes);
  }

  private sendConfig(nonce: number) {
    const s = this.state;
    const out = (fields: [number, Value | undefined][]) => this.port?.send(message(fields).bytes);
    out([
      [3, message([
        [1, s.nodeNum],
        [13, s.pioEnv],
      ])],
    ]);
    out([
      [4, message([
        [1, s.nodeNum],
        [2, message([
          [1, `!${s.nodeNum.toString(16).padStart(8, '0')}`],
          [2, s.longName],
          [3, s.shortName],
        ])],
      ])],
    ]);
    out([[13, message([[1, s.firmwareVersion]])]]);
    out([
      [10, message([
        [1, 0],
        [2, message([
          [2, s.psk],
          [3, s.channelName],
          [5, s.uplinkEnabled],
        ])],
        [3, 1],
      ])],
    ]);
    out([
      [5, message([
        [4, message([
          [1, s.wifiEnabled],
          [3, s.wifiSsid],
          [4, s.wifiPsk],
          [5, s.ntpServer],
        ])],
      ])],
    ]);
    out([
      [9, message([
        [1, message([
          [1, s.mqtt.enabled],
          [2, s.mqtt.address],
          [3, s.mqtt.username],
          [4, s.mqtt.password],
          [5, s.mqtt.encryptionEnabled],
          [6, s.mqtt.jsonEnabled],
          [7, s.mqtt.tlsEnabled],
          [8, s.mqtt.root],
        ])],
      ])],
    ]);
    out([[7, nonce]]);
  }

  // The commit reboots the unit once. Only the browser's view of it is simulated.
  private restart() {
    const mode = this.behaviour.restart ?? 'port-stays';
    setTimeout(() => {
      const port = this.port;
      if (!port) return;
      if (mode === 'port-stays') return;
      port.detach();
      if (mode === 'port-returns') {
        setTimeout(() => {
          const back = new FakePort(this, this.serial, port.getInfo());
          this.serial.ports.push(back);
        }, 10);
      }
    }, this.behaviour.restartAfterMs ?? 5);
  }
}

// One unit on one granted port, with navigator.serial installed for the test.
export const fakeDock = (state: Partial<UnitState> = {}, behaviour: UnitBehaviour = {}) => {
  const serial = new FakeSerial();
  const unit = new FakeUnit(unitState(state), behaviour, serial);
  const port = new FakePort(unit, serial);
  serial.ports.push(port);
  serial.chooserAnswer = port;
  return { serial, unit, port };
};
