import { AsyncLocalStorage } from 'async_hooks';

// Per-request context (specs/platform/design.md §4.1, REQ-UBI-08). Set by requestIdMiddleware for
// the whole request, read by the logger and the audit sink. Outside a request (a scheduled job, a
// test) there is no context and every reader gets undefined.
export interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <T>(context: RequestContext, callback: () => T): T =>
  storage.run(context, callback);

export const currentRequestId = (): string | undefined => storage.getStore()?.requestId;
