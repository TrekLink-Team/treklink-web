import { Prisma } from '@prisma/client';
import {
  isConnectionError,
  isDatabaseUnreachable,
  isTransientDatabaseError,
} from './transient-error';

const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('failed', { code, clientVersion: 'test' });

describe('transient database errors (treklink-web#533)', () => {
  it.each(['P1001', 'P1002', 'P1008', 'P1017'])('treats %s as a connection error', (code) => {
    expect(isConnectionError(known(code))).toBe(true);
    expect(isDatabaseUnreachable(known(code))).toBe(true);
    expect(isTransientDatabaseError(known(code))).toBe(true);
  });

  it('treats an initialization error as a connection error', () => {
    const error = new Prisma.PrismaClientInitializationError('cannot reach', 'test');

    expect(isConnectionError(error)).toBe(true);
  });

  it('counts a pool timeout (P2024) as unreachable, not as a connection error', () => {
    expect(isConnectionError(known('P2024'))).toBe(false);
    expect(isDatabaseUnreachable(known('P2024'))).toBe(true);
  });

  it('counts a transaction start timeout (P2028) as transient only', () => {
    expect(isDatabaseUnreachable(known('P2028'))).toBe(false);
    expect(isTransientDatabaseError(known('P2028'))).toBe(true);
  });

  it('keeps every other error out', () => {
    for (const error of [known('P2002'), known('P2025'), new Error('P1001')]) {
      expect(isTransientDatabaseError(error)).toBe(false);
    }
  });
});
