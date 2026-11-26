import { EventEmitter } from 'events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as mqtt from 'mqtt';
import { PriorityTier, SQLitePriorityQueue } from '../queue/priority-queue';
import {
  connectOptions,
  GatewayMqttClient,
  redactBrokerUrl,
  refusalCode,
  uplinkOf,
} from './mqtt-client';

const mockLines: string[] = [];
jest.mock('pino', () => ({
  __esModule: true,
  default: () => ({
    info: (line: string) => mockLines.push(line),
    warn: (line: string) => mockLines.push(line),
    error: (line: string) => mockLines.push(line),
  }),
}));
jest.mock('mqtt', () => ({
  connect: jest.fn(() => new (jest.requireActual('events').EventEmitter)()),
}));

const connect = mqtt.connect as unknown as jest.Mock<EventEmitter, [string, mqtt.IClientOptions]>;
const queue = {} as SQLitePriorityQueue;
const SECRET = 'fs_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';

describe('connectOptions (gateway-sync design §4, the Field Station credential)', () => {
  it('carries the username and the secret as the password when both are set', () => {
    expect(connectOptions({ username: 'fs-org-0001-1', secret: SECRET }, 'gw-1', 3000)).toEqual({
      clientId: 'gw-1',
      reconnectPeriod: 3000,
      protocolVersion: 5,
      username: 'fs-org-0001-1',
      password: SECRET,
    });
  });

  it.each([
    ['neither is set', { username: '', secret: '' }],
    ['only the username is set', { username: 'fs-org-0001-1', secret: '' }],
    ['only the secret is set', { username: '', secret: SECRET }],
  ])('omits both when %s', (_case, credential) => {
    const options = connectOptions(credential, 'gw-1', 3000);
    expect(options).toEqual({ clientId: 'gw-1', reconnectPeriod: 3000, protocolVersion: 5 });
    expect(options).not.toHaveProperty('username');
    expect(options).not.toHaveProperty('password');
  });
});

describe('redactBrokerUrl', () => {
  it('keeps a URL without user information as it is', () => {
    expect(redactBrokerUrl('mqtts://mqtt.treklink.vn:8883')).toBe('mqtts://mqtt.treklink.vn:8883');
  });

  it('drops a user and password written into the URL', () => {
    const redacted = redactBrokerUrl(`mqtts://fs-org-0001-1:${SECRET}@mqtt.treklink.vn:8883`);
    expect(redacted).not.toContain(SECRET);
    expect(redacted).toContain('mqtt.treklink.vn:8883');
  });
});

describe('GatewayMqttClient.connect', () => {
  beforeEach(() => {
    connect.mockClear();
    mockLines.length = 0;
  });

  it('passes an mqtts:// broker URL through and sends the credential, never logging the secret', () => {
    const client = new GatewayMqttClient('mqtts://mqtt.treklink.vn:8883', queue, {
      username: 'fs-org-0001-1',
      secret: SECRET,
    });
    client.connect();
    expect(connect).toHaveBeenCalledTimes(1);
    const [url, options] = connect.mock.calls[0];
    expect(url).toBe('mqtts://mqtt.treklink.vn:8883');
    expect(options).toMatchObject({ username: 'fs-org-0001-1', password: SECRET });
    expect(mockLines.join('\n')).toContain('as fs-org-0001-1');
    expect(mockLines.join('\n')).not.toContain(SECRET);
  });

  it('connects without credentials when the secret is missing and says so', () => {
    const client = new GatewayMqttClient('mqtt://localhost:1883', queue, {
      username: 'fs-org-0001-1',
      secret: '',
    });
    client.connect();
    const [, options] = connect.mock.calls[0];
    expect(options).not.toHaveProperty('username');
    expect(options).not.toHaveProperty('password');
    expect(mockLines.join('\n')).toContain('without credentials');
  });
});

// Gateway-sync design §4 (review of treklink-web#431): the topic and payload of a queued packet.
describe('uplinkOf', () => {
  const packet = { id: 7, from: 3724541961, type: 'position', sender: '!de000009', payload: {} };
  const item = { payload: JSON.stringify(packet), createdAt: '2026-11-07 03:25:18' };
  const settings = {
    topicPrefix: 'treklink/2/json',
    channelName: 'LongFast',
    stationTopic: false,
    mqttRoot: 'treklink',
    username: 'fs-org-0001-1',
  };

  it('keeps the Stage B node topic and the payload unchanged by default', () => {
    expect(uplinkOf(item, 1_000, settings)).toEqual({
      topic: 'treklink/2/json/LongFast/!de000009',
      payload: item.payload,
    });
  });

  it('publishes on the station data topic with fs_captured_at and fs_sent_at when asked', () => {
    const uplink = uplinkOf(item, 1_794_022_000_123, { ...settings, stationTopic: true });
    expect(uplink?.topic).toBe('treklink/fs/fs-org-0001-1/2/json/LongFast/!de000009');
    expect(JSON.parse(uplink!.payload)).toEqual({
      ...packet,
      fs_captured_at: Date.parse('2026-11-07T03:25:18Z'),
      fs_sent_at: 1_794_022_000_123,
    });
  });

  it('stays on the node topic when the station has no username', () => {
    expect(uplinkOf(item, 1, { ...settings, stationTopic: true, username: '' })?.topic).toBe(
      'treklink/2/json/LongFast/!de000009',
    );
  });

  it('returns null for a packet without a sender, an unparseable payload or capture time', () => {
    expect(uplinkOf({ ...item, payload: '{}' }, 1, settings)).toBeNull();
    expect(uplinkOf({ ...item, payload: 'not json' }, 1, settings)).toBeNull();
    expect(
      uplinkOf({ ...item, createdAt: 'later' }, 1, { ...settings, stationTopic: true }),
    ).toBeNull();
  });
});

// web#548: Mosquitto with its ACL refusing the topic, as a local Mosquitto 2.0.18 answers a QoS 1 publish
// through mqtt.js 5.15.2: under MQTT 5 the callback gets ErrorWithReasonCode 135 (Not authorized) and the
// PUBACK; under 3.1.1 a plain PUBACK and no error, so the refusal cannot be seen.
class RefusingBroker extends EventEmitter {
  outgoing: Record<number, unknown> = {};
  published: string[] = [];
  constructor(private readonly protocolVersion: number | undefined) {
    super();
  }
  publish(
    topic: string,
    _payload: string,
    _options: unknown,
    callback: (err?: Error, packet?: object) => void,
  ) {
    this.published.push(topic);
    if (this.protocolVersion === 5) {
      const err = Object.assign(new Error('Publish error: Not authorized'), { code: 135 });
      callback(err, { cmd: 'puback', reasonCode: 135 });
    } else {
      callback(undefined, { cmd: 'puback' });
    }
  }
  removeOutgoingMessage() {}
  end() {}
}

describe('GatewayMqttClient flush when the broker refuses a publish (web#548)', () => {
  let root: string;
  let queue: SQLitePriorityQueue;

  beforeEach(() => {
    mockLines.length = 0;
    root = mkdtempSync(join(tmpdir(), 'gateway-refused-'));
    queue = new SQLitePriorityQueue(join(root, 'queue.db'), {
      logger: { warn: () => undefined, error: () => undefined },
    });
    const packet = { id: 7, from: 0xde000009, sender: '!de000009', type: 'text', payload: { text: 'SOS' } };
    queue.enqueue('ev-7', PriorityTier.P0_SOS, packet);
  });

  afterEach(() => {
    queue.close();
    rmSync(root, { recursive: true, force: true });
    connect.mockReset();
    connect.mockImplementation(() => new EventEmitter());
  });

  it('keeps a row refused with reason 135, counts its attempt and shows the reason on the local page', () => {
    let broker: RefusingBroker | undefined;
    connect.mockImplementation((_url, options) => {
      broker = new RefusingBroker(options.protocolVersion);
      return broker as unknown as EventEmitter;
    });
    const client = new GatewayMqttClient('mqtt://localhost:1883', queue, { username: '', secret: '' });
    client.connect();
    broker!.emit('connect');

    expect(broker!.published).toHaveLength(1);
    expect(queue.count()).toBe(1);
    expect(queue.peek(1)[0].retryCount).toBe(1);
    expect(client.uplinkStatus().lastError?.message).toContain('reason code 135');
    expect(client.uplinkStatus().lastFlushAt).toBeNull();
    expect(mockLines.join('\n')).toContain('Failed to publish event ev-7: Publish refused by the broker, reason code 135');
  });

  it('reads the reason code from the PUBACK or the mqtt.js error, and only from 0x80', () => {
    expect(refusalCode(undefined, { reasonCode: 135 })).toBe(135);
    expect(refusalCode(Object.assign(new Error('x'), { code: 151 }), undefined)).toBe(151);
    expect(refusalCode(undefined, { reasonCode: 16 })).toBeNull();
    expect(refusalCode(undefined, { reasonCode: 0 })).toBeNull();
    expect(refusalCode(undefined, { cmd: 'puback' })).toBeNull();
    expect(refusalCode(Object.assign(new Error('x'), { code: 'ECONNRESET' }), undefined)).toBeNull();
    expect(refusalCode(undefined, undefined)).toBeNull();
  });
});
