import { Controller, Get } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { validate } from './modules/platform/config/environment-variables';
import { setupSwagger } from './swagger.setup';

@Controller('probe')
class SwaggerProbe {
  @Get()
  get() {
    return { ok: true };
  }
}

// Builds an app the way main.ts does: the validated SWAGGER_ENABLED decides whether /api/docs exists.
async function bootWith(
  env: Record<string, unknown>,
): Promise<{ app: NestExpressApplication; mounted: boolean }> {
  const module = await Test.createTestingModule({ controllers: [SwaggerProbe] }).compile();
  const app = module.createNestApplication<NestExpressApplication>();
  app.useLogger(false);
  app.setGlobalPrefix('api');
  const mounted = setupSwagger(app, validate(env).SWAGGER_ENABLED);
  await app.init();
  return { app, mounted };
}

describe('setupSwagger (REQ-OPT-01, SWAGGER_ENABLED)', () => {
  const REQUIRED = {
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/treklink?schema=public',
    DATABASE_DIRECT_URL: 'postgresql://postgres:postgres@localhost:5432/treklink?schema=public',
    MQTT_BROKER_URL: 'mqtt://localhost:1883',
    JWT_ACCESS_SECRET: 'access-secret',
  };
  let app: NestExpressApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('serves /api/docs when SWAGGER_ENABLED is true', async () => {
    const booted = await bootWith({ ...REQUIRED, SWAGGER_ENABLED: 'true' });
    app = booted.app;
    expect(booted.mounted).toBe(true);
    expect((await request(app.getHttpServer()).get('/api/docs')).status).toBe(200);
    const json = await request(app.getHttpServer()).get('/api/docs-json');
    expect(json.status).toBe(200);
    expect(Object.keys((json.body as { paths: object }).paths)).toContain('/api/probe');
  });

  it('does not serve /api/docs when SWAGGER_ENABLED is false', async () => {
    const booted = await bootWith({ ...REQUIRED, SWAGGER_ENABLED: 'false' });
    app = booted.app;
    expect(booted.mounted).toBe(false);
    expect((await request(app.getHttpServer()).get('/api/docs')).status).toBe(404);
    expect((await request(app.getHttpServer()).get('/api/docs-json')).status).toBe(404);
    expect((await request(app.getHttpServer()).get('/api/probe')).status).toBe(200);
  });

  it('defaults to off in production and on outside it', async () => {
    const production = await bootWith({
      ...REQUIRED,
      NODE_ENV: 'production',
      COMPANY_TAX_CODE: '0312345678',
      COMPANY_HOTLINE: '+84 28 1234 5678',
    });
    app = production.app;
    expect(production.mounted).toBe(false);
    expect((await request(app.getHttpServer()).get('/api/docs')).status).toBe(404);
    await app.close();
    const development = await bootWith({ ...REQUIRED, NODE_ENV: 'development' });
    app = development.app;
    expect(development.mounted).toBe(true);
    expect((await request(app.getHttpServer()).get('/api/docs')).status).toBe(200);
  });
});
