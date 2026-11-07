import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { quickSosUplink } from './demo-sos-packet';

it('keeps the compiled serverless SOS equal to the existing fixture except fresh id and time', () => {
  const fixture = JSON.parse(
    readFileSync(join(__dirname, '../../../test/fixtures/mqtt/sos.json'), 'utf8'),
  ) as { messages: { topic: string; message: Record<string, unknown> }[] };
  const now = new Date('2026-11-07T08:00:00Z');
  const packet = quickSosUplink(now, 42);
  expect(packet.topic).toBe(fixture.messages[0].topic);
  expect(JSON.parse(packet.body.toString())).toEqual({
    ...fixture.messages[0].message,
    id: 42,
    timestamp: Math.floor(now.getTime() / 1000),
  });
});
