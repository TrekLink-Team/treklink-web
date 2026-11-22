import { AsyncLocalStorage } from 'async_hooks';

// Work that runs inside a scheduled job (platform/scheduler). Every job holds one pooled connection
// for its advisory-lock transaction while its handler queries on others, so a transaction started
// there must not wait long for a connection: nine jobs fire together at second 0 of each minute, and
// with a long wait their handlers held the whole pool and every request timed out (treklink-web#537).
// `TransactionalEvents` gives the long start wait only to work outside this scope.
const background = new AsyncLocalStorage<true>();

export const runAsBackgroundWork = <T>(work: () => T): T => background.run(true, work);

export const inBackgroundWork = (): boolean => background.getStore() === true;
