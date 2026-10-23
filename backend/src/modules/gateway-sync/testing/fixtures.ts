import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The MQTT fixtures of task 1.2 (backend/test/fixtures/mqtt), as the broker would deliver them.
export interface FixtureMessage {
  topic: string;
  body: Buffer;
}

const FIXTURES = join(__dirname, '..', '..', '..', '..', 'test', 'fixtures', 'mqtt');

export const fixture = (name: string): FixtureMessage[] => {
  const doc = JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as {
    messages: { topic: string; message?: unknown; raw?: string }[];
  };
  return doc.messages.map(({ topic, message, raw }) => ({
    topic,
    body: Buffer.from(raw ?? JSON.stringify(message)),
  }));
};
