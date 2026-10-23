import { ConfigService } from '@nestjs/config';
import { ValidatedEnvironment } from '../../platform/config/environment-variables';
import { fixture } from '../testing/fixtures';
import { NodeJsonAdapter } from './node-json.adapter';

const adapter = new NodeJsonAdapter({
  get: () => 'treklink',
} as unknown as ConfigService<ValidatedEnvironment, true>);
const receivedAt = new Date('2026-10-23T03:00:05Z');
const adapt = (name: string) => {
  const [{ topic, body }] = fixture(name);
  return adapter.adapt(topic, body, receivedAt);
};

describe('NodeJsonAdapter', () => {
  it('subscribes to the node JSON topic under MQTT_ROOT', () => {
    expect(adapter.subscription).toBe('treklink/2/json/+/+');
  });

  it.each(['position', 'telemetry', 'chat', 'sos', 'sos-fall', 'rx-time-zero', 'unknown-device'])(
    'turns the %s fixture into a canonical envelope',
    (name) => {
      const result = adapt(name);
      expect(result.kind).toBe('envelope');
    },
  );

  it('keeps the stock packet fields and the publishing node as the uplink key', () => {
    const result = adapt('position');
    if (result.kind !== 'envelope') throw new Error('expected an envelope');
    expect(result.envelope).toMatchObject({
      ingress: 'MQTT_NODE',
      uplinkKey: '!de000009',
      receivedAt,
      packet: {
        id: 1834576211,
        from: 0xde000009,
        type: 'position',
        rssi: -97,
        snr: 6.25,
        hops_away: 0,
      },
    });
  });

  it.each(['nodeinfo', 'unlisted-portnum', 'queue-health'])('ignores the %s fixture', (name) => {
    expect(adapt(name).kind).toBe('ignored');
  });

  it('reports a body that is not JSON as malformed, with the raw text (AC-05)', () => {
    const result = adapt('malformed');
    expect(result).toMatchObject({
      kind: 'malformed',
      uplinkKey: '!de000009',
      detail: 'message is not JSON',
    });
  });

  it('reports a missing or out-of-range envelope field as malformed', () => {
    const topic = 'treklink/2/json/LongFast/!de000009';
    const base = {
      id: 1,
      from: 2,
      timestamp: 3,
      type: 'text',
      sender: '!de000009',
      payload: { text: 'x' },
    };
    const bad = (patch: Record<string, unknown>) =>
      adapter.adapt(topic, Buffer.from(JSON.stringify({ ...base, ...patch })), receivedAt);
    expect(bad({ id: -1 })).toMatchObject({
      kind: 'malformed',
      detail: 'id is not an unsigned 32-bit integer',
    });
    expect(bad({ from: 2 ** 32 })).toMatchObject({ kind: 'malformed' });
    expect(bad({ sender: undefined })).toMatchObject({
      kind: 'malformed',
      detail: 'sender is missing',
    });
    expect(bad({ payload: undefined })).toMatchObject({
      kind: 'malformed',
      detail: 'payload is missing',
    });
    expect(adapter.adapt(topic, Buffer.from('[1,2]'), receivedAt)).toMatchObject({
      kind: 'malformed',
    });
  });

  it('ignores a topic that is not a node JSON topic', () => {
    expect(
      adapter.adapt('treklink/2/e/LongFast/!de000009', Buffer.from('{}'), receivedAt).kind,
    ).toBe('ignored');
    expect(adapter.adapt('msh/2/json/LongFast/!de000009', Buffer.from('{}'), receivedAt).kind).toBe(
      'ignored',
    );
  });
});
