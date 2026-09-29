import { readFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';

// GET /api/health against the real HTTP pipeline (specs/platform/api-design/01-get-health.md).
// The database is a stub, per 07-clarification-answers.md §7 question 5: a rejected probe stands in
// for a stopped container. The reviewer checks AC-08 against a real Docker Postgres.
describe('GET /api/health (e2e)', () => {
  const backendVersion = (
    JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version: string }
  ).version;
  const prisma = { $queryRaw: jest.fn() };
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => prisma.$queryRaw.mockReset());

  it('returns 200 and the health report in the D-002 envelope without a token', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const response = await request(app.getHttpServer()).get('/api/health').expect(200);

    expect(response.body).toEqual({
      result: {
        status: 'ok',
        uptimeSeconds: expect.any(Number) as number,
        components: { database: 'up', mqtt: 'unknown' },
        version: backendVersion,
      },
      isSuccess: true,
      statusCode: 200,
      message: 'Healthy',
    });
  });

  it('returns 503 SERVICE_UNAVAILABLE while the database is unreachable, then 200 once it is back (AC-08, stubbed)', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:5432'));

    const down = await request(app.getHttpServer()).get('/api/health').expect(503);
    expect(down.body).toEqual({
      result: { errorCode: 'SERVICE_UNAVAILABLE' },
      isSuccess: false,
      statusCode: 503,
      message: 'Database unreachable.',
    });

    prisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const up = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(up.body).toMatchObject({ isSuccess: true, result: { status: 'ok' } });
  });

  it('answers an unknown route with the 404 NOT_FOUND envelope', async () => {
    const response = await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);

    expect(response.body).toMatchObject({
      result: { errorCode: 'NOT_FOUND' },
      isSuccess: false,
      statusCode: 404,
    });
  });
});
