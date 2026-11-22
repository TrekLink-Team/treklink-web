import { isDatabaseUnreachable } from '../../../common/prisma/transient-error';

// Database errors that mean "not reachable right now": the message is retried, never acknowledged
// and dropped, so the broker keeps it until ingestion commits (design §2). The code list is shared
// with the transaction start retry (common/prisma/transient-error.ts).
export const isTransientDatabaseError = isDatabaseUnreachable;

export const backoffMs = (attempt: number): number => Math.min(30_000, 1_000 * 2 ** attempt);
