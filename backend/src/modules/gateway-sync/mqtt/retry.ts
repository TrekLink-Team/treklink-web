import { Prisma } from '@prisma/client';

// Database errors that mean "not reachable right now": the message is retried, never acknowledged
// and dropped, so the broker keeps it until ingestion commits (design §2).
const TRANSIENT_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

export const isTransientDatabaseError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientInitializationError ||
  (error instanceof Prisma.PrismaClientKnownRequestError && TRANSIENT_CODES.has(error.code));

export const backoffMs = (attempt: number): number => Math.min(30_000, 1_000 * 2 ** attempt);
