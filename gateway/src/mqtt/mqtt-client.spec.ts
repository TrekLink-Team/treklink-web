import { EventEmitter } from 'events';
import * as mqtt from 'mqtt';
import { SQLitePriorityQueue } from '../queue/priority-queue';
import { connectOptions, GatewayMqttClient, redactBrokerUrl } from './mqtt-client';

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
    expect(options).toEqual({ clientId: 'gw-1', reconnectPeriod: 3000 });
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
