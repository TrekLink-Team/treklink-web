import { ConfigService } from '@nestjs/config';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { fixture } from '../testing/fixtures';
import { FieldStationJsonAdapter } from './field-station-json.adapter';

const adapter = new FieldStationJsonAdapter({
  get: () => 'treklink',
} as unknown as ConfigService<ValidatedEnvironment, true>);
const receivedAt = new Date('2026-10-24T02:00:00Z');
const TOPIC = 'treklink/fs/fs-org-a-1/2/json/LongFast/!de0000a1';
const station = () => {
  const [{ topic, body }] = fixture('station-sos-e02-7');
  return { topic, message: JSON.parse(body.toString('utf8')) as Record<string, unknown> };
};
const adaptMessage = (message: unknown, topic = TOPIC) =>
  adapter.adapt(topic, Buffer.from(JSON.stringify(message)), receivedAt);

describe('FieldStationJsonAdapter', () => {
  it('subscribes to the Field Station JSON topic under MQTT_ROOT', () => {
    expect(adapter.subscription).toBe('treklink/fs/+/2/json/+/+');
  });

  it('turns the E02-7 fixture into a FIELD_STATION envelope keyed by the station username', () => {
    const { topic, message } = station();
    const result = adaptMessage(message, topic);
    if (result.kind !== 'envelope') throw new Error('expected an envelope');
    expect(result.envelope).toMatchObject({
      ingress: 'FIELD_STATION',
      uplinkKey: 'fs-org-a-1',
      receivedAt,
      packet: { id: 2201000077, from: 0xde00000a, type: 'text', timestamp: 1792724400 },
      station: { capturedAtMs: 1792735200000, sentAtMs: 1792818000000 },
    });
    expect(result.envelope.packet).not.toHaveProperty('fs_captured_at');
  });

  it.each(['treklink/2/json/LongFast/!de0000a1', 'treklink/fs/fs-org-a-1/health'])(
    'ignores the topic %s',
    (topic) => {
      expect(adaptMessage(station().message, topic).kind).toBe('ignored');
    },
  );

  it('ignores a type ingestion does not read', () => {
    expect(adaptMessage({ ...station().message, type: 'nodeinfo' }).kind).toBe('ignored');
  });

  it('reports a body that is not JSON as malformed under the station username', () => {
    expect(adapter.adapt(TOPIC, Buffer.from('{not json'), receivedAt)).toMatchObject({
      kind: 'malformed',
      ingress: 'FIELD_STATION',
      uplinkKey: 'fs-org-a-1',
      detail: 'message is not JSON',
    });
  });

  it.each([
    ['missing', undefined],
    ['zero', 0],
    ['a string', '1792735200000'],
    ['fractional', 1.5],
  ])('reports fs_captured_at %s as malformed', (_label, value) => {
    expect(adaptMessage({ ...station().message, fs_captured_at: value })).toMatchObject({
      kind: 'malformed',
      ingress: 'FIELD_STATION',
      detail: 'fs_captured_at is not a positive epoch millisecond time',
    });
  });

  it('reports a missing fs_sent_at as malformed', () => {
    const message = station().message;
    delete message.fs_sent_at;
    expect(adaptMessage(message)).toMatchObject({
      kind: 'malformed',
      detail: 'fs_sent_at is not a positive epoch millisecond time',
    });
  });

  it('reports a malformed stock envelope field as malformed', () => {
    expect(adaptMessage({ ...station().message, from: -1 })).toMatchObject({
      kind: 'malformed',
      detail: 'from is not an unsigned 32-bit integer',
    });
  });
});
