import { fromBinary, type DescMessage } from '@bufbuild/protobuf';
import { MeshDevice, Protobuf, Utils } from '@meshtastic/core';
import pino from 'pino';
import { recordedReads } from '../../test/support/serial-stream';
import { PriorityTier, SQLitePriorityQueue } from '../queue/priority-queue';
import { HEARTBEAT_MS, meshtasticPort, SerialFrameReader, type MeshDeviceLike, type MeshTransport, type SerialPortDeps } from './serial-reader';

const MESH = Protobuf.Mesh as unknown as Record<string, DescMessage>;
const silent = pino({ level: 'silent' });

// A port that replays the recorded reads through core's framing, as TransportNodeSerial does with the
// bytes of a real port, and records the bytes the client puts on the wire (design §3.1, AC-09). `close()` ends the
// stream the way a pulled cable does: a disconnected status, then the end.
const replayPort = (reads: Uint8Array[]) => {
  const written: Uint8Array[] = [];
  let control!: ReadableStreamDefaultController<unknown>;
  const fromDevice = new ReadableStream<unknown>({
    start(controller) {
      control = controller;
    },
  });
  const framing = Utils.fromDeviceStream();
  const framed = framing.readable.getReader();
  void (async () => {
    const writer = framing.writable.getWriter();
    for (const read of reads) await writer.write(read);
  })();
  void (async () => {
    for (;;) {
      const { value, done } = await framed.read();
      if (done) break;
      control.enqueue(value);
    }
  })();
  // Writes are framed by core's toDeviceStream on their way to the wire, as TransportNodeSerial frames them.
  const toWire = Utils.toDeviceStream();
  void toWire.readable.pipeTo(new WritableStream<Uint8Array>({ write: (chunk) => void written.push(chunk) }));
  const transport: MeshTransport = {
    toDevice: toWire.writable,
    fromDevice,
    disconnect: async () => undefined,
  };
  const close = () => control.enqueue({ type: 'status', data: { status: 2, reason: 'port-closed' } });
  return { transport, written, close };
};

// A real MeshDevice whose own wait for an answer to want_config is short, so no timer outlives the test.
const realDevice = (transport: MeshTransport): MeshDeviceLike => {
  const device = new MeshDevice(transport as never);
  (device.log.settings as { minLevel: number }).minLevel = 7;
  (device as unknown as { queue: { timeout: number } }).queue.timeout = 50;
  return device as unknown as MeshDeviceLike;
};

const waitFor = async (check: () => boolean, ms = 3000) => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('SerialFrameReader on a port (design §3.1, REQ-STA-04, REQ-ERR-07, AC-09)', () => {
  const config = { port: '/dev/ttyUSB0', baudRate: 115200, simulationMode: false, reconnectMs: 30 };
  let queue: SQLitePriorityQueue;
  let reader: SerialFrameReader | undefined;

  beforeEach(() => {
    queue = new SQLitePriorityQueue(':memory:', { logger: silent });
  });

  afterEach(async () => {
    await reader?.stop();
    reader = undefined;
    queue.close();
  });

  it('asks the node for its configuration and queues the recorded packets in the stock shape by tier', async () => {
    const port = replayPort(recordedReads());
    const opened: string[] = [];
    const deps: SerialPortDeps = {
      openTransport: async (path, baud) => {
        opened.push(`${path}@${baud}`);
        return port.transport;
      },
      createDevice: realDevice,
    };
    const enqueued = jest.fn();
    reader = new SerialFrameReader(config, queue, enqueued, () => undefined, deps);
    reader.start();

    await waitFor(() => queue.count() === 4);
    expect(opened).toEqual(['/dev/ttyUSB0@115200']);
    expect(reader.station()).toBe(0xde000009);
    expect(reader.status()).toMatchObject({ simulation: false, reading: true });
    expect(enqueued).toHaveBeenCalledTimes(4);

    const rows = queue.peek(10);
    expect(rows.map((row) => [row.eventId, row.priority])).toEqual([
      ['!de000009:3724541962:1004', PriorityTier.P0_SOS],
      ['!de000009:3724541962:1002', PriorityTier.P2_GPS],
      ['!de000009:3724541962:1003', PriorityTier.P3_TELEMETRY],
      ['!de000009:3724541962:1005', PriorityTier.P3_TELEMETRY],
    ]);
    const sos = JSON.parse(rows[0].payload) as Record<string, unknown>;
    expect(sos).toMatchObject({ sender: '!de000009', from: 0xde00000a, type: 'text', payload: { text: 'SOS - [11.554400], [108.538100]' } });

    // The first write is a framed ToRadio asking for the configuration (want_config_id).
    await waitFor(() => port.written.length > 0);
    const first = port.written[0];
    expect([first[0], first[1]]).toEqual([0x94, 0xc3]);
    const length = (first[2] << 8) | first[3];
    const toRadio = fromBinary(MESH.ToRadioSchema, first.subarray(4, 4 + length)) as unknown as {
      payloadVariant: { case: string };
    };
    expect(toRadio.payloadVariant.case).toBe('wantConfigId');
  });

  it('keeps the session with a heartbeat every 5 minutes', async () => {
    const port = replayPort([]);
    const heartbeat = jest.fn();
    const device: MeshDeviceLike = {
      events: { onMeshPacket: { subscribe: () => undefined }, onMyNodeInfo: { subscribe: () => undefined }, onDeviceStatus: { subscribe: () => undefined } },
      configure: async () => 0,
      setHeartbeatInterval: heartbeat,
      disconnect: async () => undefined,
    };
    reader = new SerialFrameReader(config, queue, undefined, undefined, {
      openTransport: async () => port.transport,
      createDevice: () => device,
    });
    reader.start();
    await waitFor(() => heartbeat.mock.calls.length === 1);
    expect(heartbeat).toHaveBeenCalledWith(HEARTBEAT_MS);
    expect(HEARTBEAT_MS).toBe(300_000);
  });

  it('opens the port again after it closes, and after an open that fails (REQ-ERR-07)', async () => {
    const first = replayPort(recordedReads().slice(0, 2));
    const second = replayPort(recordedReads());
    const opens: string[] = [];
    let attempt = 0;
    reader = new SerialFrameReader(config, queue, undefined, undefined, {
      openTransport: async () => {
        attempt += 1;
        opens.push(`attempt ${attempt}`);
        if (attempt === 1) return first.transport;
        if (attempt === 2) throw new Error('Error: No such file or directory, cannot open /dev/ttyUSB0');
        return second.transport;
      },
      createDevice: realDevice,
    });
    reader.start();
    await waitFor(() => reader!.station() !== null);
    first.close();
    await waitFor(() => queue.count() === 4);
    expect(opens).toEqual(['attempt 1', 'attempt 2', 'attempt 3']);
    expect(reader.status().reading).toBe(true);
  });

  it('reports not reading while the port is lost, and opens nothing after stop', async () => {
    let attempts = 0;
    reader = new SerialFrameReader(config, queue, undefined, undefined, {
      openTransport: async () => {
        attempts += 1;
        throw new Error('port busy');
      },
      createDevice: realDevice,
    });
    reader.start();
    await waitFor(() => attempts >= 2);
    expect(reader.status().reading).toBe(false);
    await reader.stop();
    const after = attempts;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(attempts).toBe(after);
  });

  it('refuses a port that does not exist without ending the process, with the real serial binding', async () => {
    await expect(meshtasticPort.openTransport('/dev/ttyTREKLINK-NONE', 115200)).rejects.toThrow(/ttyTREKLINK-NONE/);
  });

  // A stand-in MeshDevice whose events the test fires by hand.
  const handDevice = () => {
    const listeners = {
      packet: [] as ((packet: unknown) => void)[],
      info: [] as ((info: { myNodeNum: number }) => void)[],
      status: [] as ((status: number) => void)[],
    };
    const device: MeshDeviceLike = {
      events: {
        onMeshPacket: { subscribe: (fn) => void listeners.packet.push(fn as (packet: unknown) => void) },
        onMyNodeInfo: { subscribe: (fn) => void listeners.info.push(fn) },
        onDeviceStatus: { subscribe: (fn) => void listeners.status.push(fn) },
      },
      configure: async () => 0,
      setHeartbeatInterval: () => undefined,
      disconnect: async () => undefined,
    };
    return { device, listeners };
  };
  const positionPacket = (id: number) => ({
    id, from: 0xde00000a, to: 0xffffffff, channel: 0, rxTime: 1762230000, rxSnr: 0, rxRssi: 0, hopLimit: 0, hopStart: 0,
    payloadVariant: {
      case: 'decoded',
      // Position latitude_i 1 (sfixed32 field 1) and longitude_i 1 (sfixed32 field 2).
      value: { portnum: 3, payload: new Uint8Array([0x0d, 1, 0, 0, 0, 0x15, 1, 0, 0, 0]) },
    },
  });

  it('closes the open port when the client cannot start on it, and opens it again', async () => {
    const disconnect = jest.fn(async () => undefined);
    let opens = 0;
    reader = new SerialFrameReader(config, queue, undefined, undefined, {
      openTransport: async () => {
        opens += 1;
        return { ...replayPort([]).transport, disconnect };
      },
      createDevice: () => {
        throw new Error('client failed');
      },
    });
    reader.start();
    await waitFor(() => opens >= 2);
    expect(disconnect.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(reader.status().reading).toBe(false);
  });

  it('forgets the station node when the port is lost, so the next node names itself again', async () => {
    const first = handDevice();
    const second = handDevice();
    const devices = [first.device, second.device];
    reader = new SerialFrameReader({ ...config, reconnectMs: 1_000 }, queue, undefined, undefined, {
      openTransport: async () => replayPort([]).transport,
      createDevice: () => devices.shift()!,
    });
    reader.start();
    await waitFor(() => first.listeners.info.length === 1);
    first.listeners.info[0]({ myNodeNum: 0xde000009 });
    expect(reader.station()).toBe(0xde000009);
    first.listeners.status[0](2);
    expect(reader.station()).toBeNull();
    // A packet the lost port delivered late waits for the next node instead of taking the old sender.
    first.listeners.packet[0](positionPacket(2001));
    expect(queue.count()).toBe(0);
  });

  it('keeps at most 500 packets waiting for the node to name itself and drops the rest', async () => {
    const hand = handDevice();
    reader = new SerialFrameReader(config, queue, undefined, undefined, {
      openTransport: async () => replayPort([]).transport,
      createDevice: () => hand.device,
    });
    reader.start();
    await waitFor(() => hand.listeners.packet.length === 1);
    for (let id = 1; id <= 502; id += 1) hand.listeners.packet[0](positionPacket(id));
    expect(queue.count()).toBe(0);
    hand.listeners.info[0]({ myNodeNum: 0xde000009 });
    expect(queue.count()).toBe(500);
    expect(queue.peek(1)[0].eventId).toBe('!de000009:3724541962:1');
  });

  it('opens no port in simulation (GATEWAY_SERIAL_SIMULATION=true)', async () => {
    const openTransport = jest.fn();
    reader = new SerialFrameReader({ ...config, simulationMode: true }, queue, undefined, undefined, {
      openTransport,
      createDevice: realDevice,
    });
    reader.start();
    expect(reader.status()).toMatchObject({ simulation: true, reading: true });
    expect(openTransport).not.toHaveBeenCalled();
  });
});
