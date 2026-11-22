import { Prisma } from '@prisma/client';
import { isTransientDatabaseError } from './retry';

const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('failed', { code, clientVersion: 'test' });

// Ingestion retries "not reachable right now" and keeps the message (design §2); the list is shared
// with the transaction start retry since treklink-web#537 and keeps the codes it had.
describe('MQTT ingestion retry codes', () => {
  it.each(['P1001', 'P1002', 'P1008', 'P1017', 'P2024'])('retries %s', (code) => {
    expect(isTransientDatabaseError(known(code))).toBe(true);
  });

  it('retries an initialization error', () => {
    expect(
      isTransientDatabaseError(new Prisma.PrismaClientInitializationError('cannot reach', 'test')),
    ).toBe(true);
  });

  it.each(['P2028', 'P2002', 'P2025'])('does not retry %s', (code) => {
    expect(isTransientDatabaseError(known(code))).toBe(false);
  });
});
