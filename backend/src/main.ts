import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { ValidatedEnvironment } from './modules/platform/config/environment-variables';
import { configureApp, parseCorsOrigins } from './app.setup';
import { LiveIoAdapter } from './modules/monitoring';
import { SWAGGER_PATH, setupSwagger } from './swagger.setup';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  configureApp(app);
  const env = app.get<ConfigService<ValidatedEnvironment, true>>(ConfigService);
  app.useWebSocketAdapter(
    new LiveIoAdapter(app, parseCorsOrigins(env.get('CORS_ORIGINS', { infer: true }))),
  );

  const swaggerEnabled = setupSwagger(app, env.get('SWAGGER_ENABLED', { infer: true }));

  const port = process.env.PORT_BACKEND || 3000;
  await app.listen(port);
  logger.log(`TrekLink Backend running on http://localhost:${port}/api`);
  if (swaggerEnabled) {
    logger.log(`Swagger documentation available at http://localhost:${port}/${SWAGGER_PATH}`);
  } else {
    logger.log('Swagger documentation is off (SWAGGER_ENABLED=false)');
  }
}

void bootstrap().catch((err: unknown) => {
  console.error('Failed to bootstrap application', err);
  process.exit(1);
});
