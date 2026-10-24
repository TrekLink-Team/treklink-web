import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';

// Account and role administration through the real HTTP pipeline (specs/auth/api-design 09 to 13,
// 15, 16 and 18, US-UC10): the global guards, the policies and the request validation. The database
// is an in-memory stub; the queries themselves run against Postgres in accounts.db-spec.ts.

const grant = (key: string, action: string, subject: string) => ({
  key,
  action,
  subject,
  conditions: null,
  fields: [],
  inverted: false,
  reason: null,
});

const PERMISSIONS: Record<string, unknown[]> = {
  ADMIN: [grant('account.manage', 'manage', 'Account'), grant('role.manage', 'manage', 'Role')],
  STAFF: [grant('account.triggerReset', 'triggerReset', 'Account')],
};

const account = (id: string, role: string) => ({
  id,
  email: `${id}@treklink.vn`,
  fullName: id,
  phoneNumber: null,
  accountType: 'TREKLINK',
  isActive: true,
  deletedAt: null,
  passwordHash: 'hash',
  lockedUntil: null,
  lastLoginAt: null,
  createdAt: new Date('2026-10-20T03:15:00.000Z'),
  roles: [{ role: { key: role } }],
});

const ACCOUNTS: Record<string, ReturnType<typeof account>> = {
  'admin-1': account('admin-1', 'ADMIN'),
  'staff-1': account('staff-1', 'STAFF'),
};

describe('account and role administration (e2e)', () => {
  let app: NestExpressApplication;
  let jwt: JwtService;

  const prisma = {
    user: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(ACCOUNTS[where.id] ?? null),
      findMany: () => Promise.resolve([ACCOUNTS['staff-1']]),
      count: () => Promise.resolve(1),
    },
    rolePermission: {
      findMany: ({ where }: { where: { role: { key: string } } }) =>
        Promise.resolve((PERMISSIONS[where.role.key] ?? []).map((permission) => ({ permission }))),
    },
    permission: {
      findMany: () =>
        Promise.resolve([
          {
            id: 'p-1',
            key: 'role.manage',
            action: 'manage',
            subject: 'Role',
            accountType: 'TREKLINK',
            conditions: null,
          },
        ]),
    },
  };

  const as = (userId: string | null) => (call: request.Test) =>
    userId
      ? jwt
          .signAsync({ sub: userId, roles: [], pv: 0 })
          .then((token) => call.set('Authorization', `Bearer ${token}`))
      : call;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    jwt = moduleRef.get(JwtService, { strict: false });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => request(app.getHttpServer());

  it('answers 401 without a token', async () => {
    for (const path of ['/api/accounts', '/api/roles', '/api/permissions']) {
      await server().get(path).expect(401);
    }
  });

  it.each([
    ['GET', '/api/accounts'],
    ['POST', '/api/accounts'],
    ['GET', '/api/roles'],
    ['GET', '/api/permissions'],
  ])(
    'answers 403 to TrekLink Staff on %s %s (account.manage, role.manage)',
    async (method, path) => {
      const call = method === 'GET' ? server().get(path) : server().post(path).send({});
      const response = await as('staff-1')(call);
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ result: { errorCode: 'FORBIDDEN' } });
    },
  );

  it('lists TrekLink accounts for the Admin as a page (api-design 09)', async () => {
    const response = await as('admin-1')(server().get('/api/accounts?isActive=true&q=staff'));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      message: 'OK',
      result: {
        items: [{ id: 'staff-1', roles: ['STAFF'], phoneNumber: null }],
        pageNumber: 1,
        totalCount: 1,
      },
    });
  });

  it('serves the permission catalog without raw conditions (api-design 18)', async () => {
    const response = await as('admin-1')(server().get('/api/permissions'));

    expect(response.status).toBe(200);
    expect((response.body as { result: unknown[] }).result).toEqual([
      {
        key: 'role.manage',
        action: 'manage',
        subject: 'Role',
        scope: 'any',
        accountType: 'TREKLINK',
        description: null,
        protected: true,
      },
    ]);
  });

  it.each([
    [
      'POST /api/accounts with a role outside STAFF and ADMIN',
      () =>
        server()
          .post('/api/accounts')
          .send({ email: 'a@treklink.vn', fullName: 'A', role: 'ORG_MANAGER' }),
    ],
    ['GET /api/accounts with isActive=yes', () => server().get('/api/accounts?isActive=yes')],
    [
      'PATCH /api/accounts/:id with an id that is not a UUID',
      () => server().patch('/api/accounts/staff-1').send({ fullName: 'B' }),
    ],
    [
      'POST /api/accounts/:id/deactivate without a reason',
      () => server().post('/api/accounts/3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f/deactivate').send({}),
    ],
    [
      'PUT /api/roles/:id/permissions without a list',
      () => server().put('/api/roles/3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f/permissions').send({}),
    ],
  ])('answers 400 VALIDATION_FAILED for %s', async (_label, call) => {
    const response = await as('admin-1')(call());
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ result: { errorCode: 'VALIDATION_FAILED' } });
  });
});
