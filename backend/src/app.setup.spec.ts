import { Body, Controller, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { configureApp, parseCorsOrigins } from './app.setup';

@Controller('contracts')
class BodyLimitProbe {
  @Post(':id/handover')
  handover(@Body() body: { signature: string }) {
    return { length: body.signature.length };
  }

  @Post(':id/other')
  other(@Body() body: { signature: string }) {
    return { length: body.signature.length };
  }
}

describe('configured handover body limit (rentals task 2.4)', () => {
  let app: NestExpressApplication;
  beforeAll(async () => {
    const values: Record<string, string> = {
      HTTP_BODY_LIMIT: '1kb',
      RENTALS_HANDOVER_BODY_LIMIT: '2kb',
      CORS_ORIGINS: 'http://localhost:5173',
    };
    const module = await Test.createTestingModule({
      controllers: [BodyLimitProbe],
      providers: [{ provide: ConfigService, useValue: { get: (key: string) => values[key] } }],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureApp(app);
    app.useLogger(false);
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('allows a handover signature above the global limit without raising other routes', async () => {
    const body = { signature: 'x'.repeat(1500) };
    const accepted = await request(app.getHttpServer())
      .post('/api/contracts/c-1/handover?preview=false')
      .send(body);
    expect(accepted.status).toBe(201);
    expect(accepted.body as unknown).toMatchObject({ result: { length: 1500 } });
    const rejected = await request(app.getHttpServer()).post('/api/contracts/c-1/other').send(body);
    expect(rejected.status).toBe(413);
    expect(rejected.body as unknown).toMatchObject({ result: { errorCode: 'PAYLOAD_TOO_LARGE' } });
  });

  it('refuses a handover above its own limit with the envelope and request id', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/contracts/c-1/handover')
      .send({ signature: 'x'.repeat(2500) });
    expect(response.status).toBe(413);
    expect(response.body as unknown).toMatchObject({ result: { errorCode: 'PAYLOAD_TOO_LARGE' } });
    expect(response.headers['x-request-id']).toBeTruthy();
  });
});

describe('parseCorsOrigins', () => {
  it('splits a comma-separated list and trims each origin', () => {
    expect(parseCorsOrigins('http://localhost:5173, https://app.treklink.vn')).toEqual([
      'http://localhost:5173',
      'https://app.treklink.vn',
    ]);
  });

  it('drops empty entries', () => {
    expect(parseCorsOrigins('http://localhost:5173,, ')).toEqual(['http://localhost:5173']);
  });
});
