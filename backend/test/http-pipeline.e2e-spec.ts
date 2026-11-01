import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';

// The global HTTP wiring of configureApp (specs/platform/design.md §4.1) against the real Express
// pipeline. The database is a stub; no route here reaches it.
describe('HTTP pipeline (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('CORS', () => {
    it('allows a configured origin with credentials', async () => {
      const response = await request(app.getHttpServer())
        .options('/api/health')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('does not allow an origin outside CORS_ORIGINS', async () => {
      const response = await request(app.getHttpServer())
        .options('/api/auth/login')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('lets any origin read the health route without credentials (D-088)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/health?probe=landing')
        .set('Origin', 'https://treklink-team.github.io');

      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('keeps the credentialed rule for a listed origin on the health route', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/health')
        .set('Origin', 'http://localhost:5173');

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('request id (REQ-UBI-08)', () => {
    it('echoes a caller-supplied X-Request-Id', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/does-not-exist')
        .set('X-Request-Id', 'demo-req-0001')
        .expect(404);

      expect(response.headers['x-request-id']).toBe('demo-req-0001');
    });

    it('generates a UUID when the header is absent', async () => {
      const response = await request(app.getHttpServer()).get('/api/does-not-exist');

      expect(response.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('replaces an id that could inject text into a log line', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/does-not-exist')
        .set('X-Request-Id', 'abc def [ERROR] forged');

      expect(response.headers['x-request-id']).not.toBe('abc def [ERROR] forged');
    });
  });

  describe('body limit (REQ-ERR-07)', () => {
    it('answers a 2 MB body with 413 PAYLOAD_TOO_LARGE in the envelope', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/health')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ blob: 'x'.repeat(2 * 1024 * 1024) }))
        .expect(413);

      expect(response.headers['x-request-id']).toBeDefined();
      expect(response.body).toEqual({
        result: { errorCode: 'PAYLOAD_TOO_LARGE' },
        isSuccess: false,
        statusCode: 413,
        message: 'Request body exceeds the 1048576-byte limit.',
      });
    });

    it('answers malformed JSON with 400 VALIDATION_FAILED', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/health')
        .set('Content-Type', 'application/json')
        .send('{"value": ')
        .expect(400);

      expect(response.body).toMatchObject({
        result: { errorCode: 'VALIDATION_FAILED' },
        isSuccess: false,
        statusCode: 400,
      });
    });
  });
});
