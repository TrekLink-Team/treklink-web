import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const SWAGGER_PATH = 'api/docs';

// OpenAPI documentation at /api/docs, served only WHERE `SWAGGER_ENABLED` is true (REQ-OPT-01).
// The flag is validated in environment-variables.ts and defaults to off in production.
// Returns whether the documentation was mounted.
export function setupSwagger(app: INestApplication, enabled: boolean): boolean {
  if (!enabled) return false;
  const config = new DocumentBuilder()
    .setTitle('TrekLink Operations Platform API')
    .setDescription('Backend REST API for TrekLink fleet, rentals, incidents, and telemetry')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(SWAGGER_PATH, app, document);
  return true;
}
