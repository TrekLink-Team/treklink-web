import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Global prefix
  app.setGlobalPrefix('api');

  // CORS for frontend
  app.enableCors({
    origin: '*',
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Global response formatting & error handling
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Swagger OpenAPI setup
  const config = new DocumentBuilder()
    .setTitle('TrekLink Operations Platform API')
    .setDescription('Backend REST API for TrekLink fleet, rentals, incidents, and telemetry')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT_BACKEND || 3000;
  await app.listen(port);
  logger.log(`TrekLink Backend running on http://localhost:${port}/api`);
  logger.log(`Swagger documentation available at http://localhost:${port}/api/docs`);
}

void bootstrap().catch((err: unknown) => {
  console.error('Failed to bootstrap application', err);
  process.exit(1);
});
