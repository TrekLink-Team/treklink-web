import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { validationExceptionFactory } from './common/pipes/validation-exception.factory';
import { ValidatedEnvironment } from './modules/platform/config/environment-variables';

// `CORS_ORIGINS` is a comma-separated list (specs/platform/requirements.md §4). A credentialed
// request needs an explicit origin; browsers reject `*` together with credentials.
export const parseCorsOrigins = (raw: string): string[] =>
  raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

// Global HTTP wiring shared by main.ts and the e2e tests, so tests exercise the real envelope.
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<ValidatedEnvironment, true>>(ConfigService);

  app.setGlobalPrefix('api');

  app.enableCors({
    origin: parseCorsOrigins(config.get('CORS_ORIGINS', { infer: true })),
    credentials: true,
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
