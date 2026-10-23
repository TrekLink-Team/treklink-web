import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { runWithRequestContext } from '../context/request-context';

export const REQUEST_ID_HEADER = 'X-Request-Id';

// A caller-supplied id is reused only when it is short and plain, so it cannot inject text into a
// log line; anything else is replaced by a fresh UUID.
const ACCEPTED_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export const resolveRequestId = (incoming: string | string[] | undefined): string => {
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  return candidate !== undefined && ACCEPTED_REQUEST_ID.test(candidate) ? candidate : randomUUID();
};

// Registered first in configureApp, ahead of the body parser, so even a 413 carries the header
// (REQ-UBI-08). The rest of the request runs inside the request context.
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER.toLowerCase()]);
  res.setHeader(REQUEST_ID_HEADER, requestId);
  runWithRequestContext({ requestId }, next);
};
