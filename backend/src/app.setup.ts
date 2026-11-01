import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { RequestIdLogger } from './common/logging/request-id.logger';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { validationExceptionFactory } from './common/pipes/validation-exception.factory';
import { ValidatedEnvironment } from './modules/platform/config/environment-variables';

// `CORS_ORIGINS` is a comma-separated list (specs/platform/requirements.md §4). A credentialed
// request needs an explicit origin; browsers reject `*` together with credentials.
export const parseCorsOrigins = (raw: string): string[] =>
  raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

type CorsRequest = { headers: { origin?: string }; url?: string; originalUrl?: string };

const HEALTH_PATH = '/api/health';

const isHealthRoute = (req: CorsRequest): boolean =>
  (req.originalUrl ?? req.url ?? '').split('?')[0] === HEALTH_PATH;

// Global HTTP wiring shared by main.ts and the e2e tests, so tests exercise the real envelope.
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<ValidatedEnvironment, true>>(ConfigService);

  app.useLogger(new RequestIdLogger());

  // Request id before the body parser, so a 413 carries X-Request-Id too (REQ-UBI-08).
  app.use(requestIdMiddleware);
  const bodyLimit = config.get('HTTP_BODY_LIMIT', { infer: true });
  // Parse the signature endpoint first; the general parser skips an already-consumed body. Body
  // parsing runs before the JWT guard, so an unauthenticated caller can still send up to this limit
  // before the 401; the route stays small enough that this is accepted (review of #144).
  app.useBodyParser('json', {
    limit: config.get('RENTALS_HANDOVER_BODY_LIMIT', { infer: true }),
    type: (request) =>
      request.method === 'POST' &&
      /^\/api\/contracts\/[^/?]+\/handover\/?(?:\?|$)/.test(request.url ?? '') &&
      request.headers['content-type']?.split(';')[0].trim().toLowerCase() === 'application/json',
  });
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { limit: bodyLimit, extended: true });

  app.setGlobalPrefix('api');

  // The health route is public and carries no credentials, so any origin may read it: the landing
  // page probes it from GitHub Pages and Vercel before opening the system (D-088). Every other
  // route, and a listed origin on the health route, keeps the credentialed CORS_ORIGINS rule.
  const corsOrigins = parseCorsOrigins(config.get('CORS_ORIGINS', { infer: true }));
  app.enableCors((req: CorsRequest, callback) => {
    const origin = req.headers.origin;
    const listed = typeof origin === 'string' && corsOrigins.includes(origin);
    callback(
      null,
      isHealthRoute(req) && !listed
        ? { origin: '*', credentials: false }
        : { origin: corsOrigins, credentials: true },
    );
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  // Global response formatting & error handling (D-002, D-026)
  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new GlobalExceptionFilter());
}
