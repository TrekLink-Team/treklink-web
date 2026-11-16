import { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

// Security headers on every backend response (finding M1). The API returns JSON, so the content
// security policy denies everything and forbids framing. Swagger UI is the one HTML page and needs
// its own inline script and style, so /api/docs keeps helmet's other headers without the policy.
// Cross-origin reads stay allowed: the frontend on another origin calls this API under CORS.
const common = { crossOriginResourcePolicy: { policy: 'cross-origin' as const } };

const api = helmet({
  ...common,
  contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
});
const docs = helmet({ ...common, contentSecurityPolicy: false });

const DOCS_PATH = /^\/api\/docs(?:\/|\?|$)/;

export const securityHeadersMiddleware = (req: Request, res: Response, next: NextFunction): void =>
  (DOCS_PATH.test(req.originalUrl ?? req.url) ? docs : api)(req, res, next);
