import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The reads of `test/fixtures/serial/node-stream.hex`, in order: each is one chunk off the port
// (design §3.1, AC-09). Comment lines name what the next read holds.
export const recordedReads = (): Uint8Array[] =>
  readFileSync(join(__dirname, '..', 'fixtures', 'serial', 'node-stream.hex'), 'utf8')
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => new Uint8Array(Buffer.from(line, 'hex')));
