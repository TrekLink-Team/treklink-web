import { Prisma } from '@prisma/client';

// Errors that mean the database connection failed before an answer came back: the server could not be
// reached (P1001), the connect timed out (P1002, P1008), or a pooled connection the database had
// already closed was used (P1017). A Neon compute that suspends when idle drops its connections, so
// the first query after an idle period can meet one of these (treklink-web#533).
const CONNECTION_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017']);

// Waiting errors: no pooled connection came free in time (P2024), or the transaction could not be
// started in time or was already closed (P2028).
const WAIT_CODES = new Set(['P2024', 'P2028']);

const knownCode = (error: unknown): string | undefined =>
  error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;

// An initialization error is the engine failing to open its first connection.
export const isConnectionError = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  const code = knownCode(error);
  return code !== undefined && CONNECTION_CODES.has(code);
};

export const isTransientDatabaseError = (error: unknown): boolean => {
  if (isConnectionError(error)) return true;
  const code = knownCode(error);
  return code !== undefined && WAIT_CODES.has(code);
};
