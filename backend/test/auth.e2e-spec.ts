import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { hashToken } from '../src/modules/auth/token.service';

// POST /api/auth/login, /refresh, /logout and GET /api/auth/me against the real HTTP pipeline
// (specs/auth/api-design 01 to 04). The database is an in-memory stub of the calls `auth` makes,
// as in health.e2e-spec.ts; the reviewer checks the same flows against Docker Postgres.

interface IssuedSession {
  accessToken: string;
  refreshToken: string;
}

const sessionOf = (response: request.Response): IssuedSession =>
  (response.body as { result: IssuedSession }).result;

interface StoredToken {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
}

const PARAMETERS: Record<string, number> = {
  'auth.passwordMinLength': 8,
  'auth.loginMaxFailures': 5,
  'auth.loginFailureWindowMinutes': 15,
  'auth.lockoutMinutes': 15,
};

describe('auth sessions (e2e)', () => {
  let app: NestExpressApplication;
  let tokens: StoredToken[];
  let staff: Record<string, unknown>;
  const events: { type: string; userId: string | null }[] = [];

  const matches = (row: StoredToken, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key as keyof StoredToken] === value);

  const prisma = {
    $transaction: (work: (tx: unknown) => Promise<unknown>) => work(prisma),
    businessParameter: {
      findUnique: ({ where }: { where: { key: string } }) =>
        Promise.resolve({ key: where.key, value: PARAMETERS[where.key] }),
    },
    user: {
      findUnique: ({ where }: { where: { email?: string; id?: string } }) =>
        Promise.resolve(where.email === staff.email || where.id === staff.id ? { ...staff } : null),
      update: ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(staff, data);
        return Promise.resolve(staff);
      },
    },
    authEvent: {
      create: ({ data }: { data: { type: string; userId: string | null } }) => {
        events.push(data);
        return Promise.resolve(data);
      },
      count: () => Promise.resolve(events.filter((e) => e.type === 'LOGIN_FAILED').length),
    },
    rolePermission: { findMany: () => Promise.resolve([]) },
    refreshToken: {
      create: ({ data }: { data: Omit<StoredToken, 'id' | 'revokedAt' | 'replacedById'> }) => {
        const row = { ...data, id: `rt-${tokens.length + 1}`, revokedAt: null, replacedById: null };
        tokens.push(row);
        return Promise.resolve({ id: row.id });
      },
      findUnique: ({ where }: { where: { tokenHash: string } }) =>
        Promise.resolve(tokens.find((t) => t.tokenHash === where.tokenHash) ?? null),
      updateMany: ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<StoredToken>;
      }) => {
        const hits = tokens.filter((t) => matches(t, where));
        hits.forEach((t) => Object.assign(t, data));
        return Promise.resolve({ count: hits.length });
      },
    },
  };

  const login = (password = 'correct-pass') =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'Staff@TrekLink.vn', password });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    tokens = [];
    events.length = 0;
    staff = {
      id: 'user-1',
      email: 'staff@treklink.vn',
      fullName: 'Tran Thi B',
      accountType: 'TREKLINK',
      isActive: true,
      deletedAt: null,
      passwordHash: await bcrypt.hash('correct-pass', 4),
      lockedUntil: null,
      lastLoginAt: null,
      roles: [{ role: { key: 'STAFF' } }],
    };
  });

  it('signs in and returns both tokens and the account (api-design 01)', async () => {
    const response = await login().expect(200);

    expect(response.body).toEqual({
      result: {
        accessToken: expect.any(String) as string,
        accessTokenExpiresIn: 900,
        refreshToken: expect.stringMatching(/^rt_/) as string,
        refreshTokenExpiresIn: 1_209_600,
        user: {
          id: 'user-1',
          email: 'staff@treklink.vn',
          fullName: 'Tran Thi B',
          accountType: 'TREKLINK',
          roles: ['STAFF'],
          organization: null,
        },
      },
      isSuccess: true,
      statusCode: 200,
      message: 'Signed in',
    });
    expect(tokens[0].tokenHash).toBe(hashToken(sessionOf(response).refreshToken));
  });

  it('answers 400 VALIDATION_FAILED for a missing password', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'staff@treklink.vn' })
      .expect(400);
    expect(response.body).toMatchObject({
      result: { errorCode: 'VALIDATION_FAILED' },
      isSuccess: false,
    });
  });

  it('answers a wrong password and an unknown email with the same 401 body (MSG09)', async () => {
    const wrong = await login('wrong-pass').expect(401);
    const unknown = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'who@nowhere.vn', password: 'whatever-pass' })
      .expect(401);

    const expected = {
      result: { errorCode: 'INVALID_CREDENTIALS' },
      isSuccess: false,
      statusCode: 401,
      message: 'Incorrect email or password. Please try again.',
    };
    expect(wrong.body).toEqual(expected);
    expect(unknown.body).toEqual(expected);
  });

  it('answers 423 ACCOUNT_LOCKED while the account is locked', async () => {
    staff.lockedUntil = new Date(Date.now() + 10 * 60_000);
    const response = await login().expect(423);
    expect(response.body).toMatchObject({ result: { errorCode: 'ACCOUNT_LOCKED' } });
  });

  it('rotates the refresh token and revokes the family when a rotated one returns (api-design 02, AC-02)', async () => {
    const first = sessionOf(await login().expect(200)).refreshToken;

    const rotated = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: first })
      .expect(200);
    expect(rotated.body).toMatchObject({ isSuccess: true, message: 'Token refreshed' });
    expect(Object.keys(sessionOf(rotated)).sort()).toEqual([
      'accessToken',
      'accessTokenExpiresIn',
      'refreshToken',
      'refreshTokenExpiresIn',
    ]);
    const second = sessionOf(rotated).refreshToken;
    expect(second).not.toBe(first);

    const replay = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: first })
      .expect(401);
    expect(replay.body).toMatchObject({ result: { errorCode: 'REFRESH_REUSED' } });

    const afterReuse = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: second })
      .expect(401);
    expect(afterReuse.body).toMatchObject({ result: { errorCode: 'REFRESH_INVALID' } });
  });

  it('answers 401 REFRESH_INVALID for an unknown refresh token', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: 'rt_unknown' })
      .expect(401);
    expect(response.body).toMatchObject({ result: { errorCode: 'REFRESH_INVALID' } });
  });

  it('returns the caller from me, signs out, and refuses the revoked token (api-design 03, 04)', async () => {
    const { accessToken, refreshToken } = sessionOf(await login().expect(200));

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({ result: { id: 'user-1', roles: ['STAFF'] }, message: 'OK' });

    const out = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken })
      .expect(200);
    expect(out.body).toEqual({
      result: null,
      isSuccess: true,
      statusCode: 200,
      message: 'Signed out',
    });

    const after = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(401);
    expect(after.body).toMatchObject({ result: { errorCode: 'REFRESH_INVALID' } });
  });

  it('answers 401 UNAUTHENTICATED without a token, and once the account is deactivated (AC-04)', async () => {
    const noToken = await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    expect(noToken.body).toMatchObject({ result: { errorCode: 'UNAUTHENTICATED' } });

    const { accessToken } = sessionOf(await login().expect(200));
    staff.isActive = false;
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });
});
