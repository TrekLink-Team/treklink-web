import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';

// Account and role administration and the authentication log through the real HTTP pipeline
// (specs/auth/api-design 09 to 13 and 15 to 18, US-UC10, UC-58): the global guards, the policies,
// the request validation and the domain refusals. The database is an in-memory stub; the queries
// themselves run against Postgres in accounts.db-spec.ts.

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
  ADMIN: [
    grant('account.manage', 'manage', 'Account'),
    grant('role.manage', 'manage', 'Role'),
    grant('authEvent.read', 'read', 'AuthEvent'),
  ],
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

// The routes with an id take a UUID, so the accounts and roles they act on have one.
const ADMIN_ID = '0b9a8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d';
const MISSING_ID = '3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f';
const MANAGER_ID = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';
const ORG_ID = '5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f';
const OTHER_ORG_ID = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';

const ACCOUNTS: Record<string, ReturnType<typeof account>> = {
  'admin-1': account('admin-1', 'ADMIN'),
  'staff-1': account('staff-1', 'STAFF'),
  [ADMIN_ID]: account(ADMIN_ID, 'ADMIN'),
};

const role = (id: string, key: string, accountType: string) => ({
  id,
  key,
  accountType,
  isSystem: true,
  permissions: [],
});

const ADMIN_ROLE_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const OPERATOR_ROLE_ID = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';
const ROLES: Record<string, ReturnType<typeof role>> = {
  [ADMIN_ROLE_ID]: role(ADMIN_ROLE_ID, 'ADMIN', 'TREKLINK'),
  [OPERATOR_ROLE_ID]: role(OPERATOR_ROLE_ID, 'ORG_OPERATOR', 'ORGANIZATION'),
};

const CATALOG = [
  {
    id: 'p-1',
    key: 'role.manage',
    action: 'manage',
    subject: 'Role',
    accountType: 'TREKLINK',
    conditions: null,
  },
];

const AUTH_EVENTS = [
  {
    id: 'e-1',
    userId: MANAGER_ID,
    email: 'manager@acme-trek.vn',
    type: 'LOGIN_FAILED',
    ip: '203.0.113.7',
    createdAt: new Date('2026-10-20T03:15:00.000Z'),
  },
  {
    id: 'e-2',
    userId: null,
    email: 'nobody@acme-trek.vn',
    type: 'LOGIN_FAILED',
    ip: '203.0.113.8',
    createdAt: new Date('2026-10-20T03:10:00.000Z'),
  },
];

describe('account and role administration (e2e)', () => {
  let app: NestExpressApplication;
  let jwt: JwtService;

  let authEventWhere: unknown;

  const prisma = {
    $transaction: (work: (tx: unknown) => Promise<unknown>): Promise<unknown> => work(prisma),
    $executeRaw: () => Promise.resolve(0),
    user: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(ACCOUNTS[where.id] ?? null),
      // By id (findTreklinkAccount) or by email (the CONFLICT_UNIQUE check of create).
      findFirst: ({ where }: { where: { id?: string; email?: { equals: string } } }) =>
        Promise.resolve(
          where.email
            ? (Object.values(ACCOUNTS).find((row) => row.email === where.email?.equals) ?? null)
            : (ACCOUNTS[where.id ?? ''] ?? null),
        ),
      findMany: () => Promise.resolve([ACCOUNTS['staff-1']]),
      // The page total, and the active Admins: one, so the last one cannot go.
      count: () => Promise.resolve(1),
    },
    role: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(ROLES[where.id] ?? null),
    },
    rolePermission: {
      findMany: ({ where }: { where: { role: { key: string } } }) =>
        Promise.resolve((PERMISSIONS[where.role.key] ?? []).map((permission) => ({ permission }))),
    },
    permission: {
      findMany: ({ where }: { where?: { key?: { in: string[] } } } = {}) =>
        Promise.resolve(
          CATALOG.filter((permission) => !where?.key || where.key.in.includes(permission.key)),
        ),
    },
    authEvent: {
      findMany: ({ where }: { where: unknown }) => {
        authEventWhere = where;
        return Promise.resolve(AUTH_EVENTS);
      },
      count: () => Promise.resolve(AUTH_EVENTS.length),
    },
    // Read by ACCOUNT_CONTEXT_PROVIDER, which `organizations` provides over its member rows.
    organizationMember: {
      findMany: ({ where }: { where: { userId?: { in: string[] }; organizationId?: string } }) => {
        if (where.organizationId) {
          return Promise.resolve(where.organizationId === ORG_ID ? [{ userId: MANAGER_ID }] : []);
        }
        return Promise.resolve(
          where.userId?.in.includes(MANAGER_ID)
            ? [
                {
                  userId: MANAGER_ID,
                  organization: { id: ORG_ID, legalName: 'ACME Trek Co., Ltd.' },
                },
              ]
            : [],
        );
      },
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
    for (const path of ['/api/accounts', '/api/roles', '/api/permissions', '/api/auth-events']) {
      await server().get(path).expect(401);
    }
  });

  it.each([
    ['GET', '/api/accounts'],
    ['POST', '/api/accounts'],
    ['GET', '/api/roles'],
    ['GET', '/api/permissions'],
    ['GET', '/api/auth-events'],
  ])(
    'answers 403 to TrekLink Staff on %s %s (account.manage, role.manage, authEvent.read)',
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
    [
      'GET /api/auth-events with an organizationId that is not a UUID',
      () => server().get('/api/auth-events?organizationId=org-1'),
    ],
    [
      'GET /api/auth-events with an unknown type',
      () => server().get('/api/auth-events?type=LOGIN'),
    ],
    [
      'GET /api/auth-events with from not before to',
      () => server().get('/api/auth-events?from=2026-10-21T00:00:00Z&to=2026-10-01T00:00:00Z'),
    ],
  ])('answers 400 VALIDATION_FAILED for %s', async (_label, call) => {
    const response = await as('admin-1')(call());
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ result: { errorCode: 'VALIDATION_FAILED' } });
  });

  it.each([
    [
      'POST /api/accounts with an email already registered (api-design 10)',
      'admin-1',
      () =>
        server()
          .post('/api/accounts')
          .send({ email: 'Staff-1@treklink.vn', fullName: 'S', role: 'STAFF' }),
      409,
      'CONFLICT_UNIQUE',
    ],
    [
      'PATCH /api/accounts/:id for an unknown account (api-design 11)',
      'admin-1',
      () => server().patch(`/api/accounts/${MISSING_ID}`).send({ fullName: 'B' }),
      404,
      'NOT_FOUND',
    ],
    [
      'PATCH /api/accounts/:id removing the caller its own Admin role (api-design 11)',
      ADMIN_ID,
      () => server().patch(`/api/accounts/${ADMIN_ID}`).send({ role: 'STAFF' }),
      409,
      'SELF_DEMOTION',
    ],
    [
      'PATCH /api/accounts/:id demoting the last active Admin (api-design 11)',
      'admin-1',
      () => server().patch(`/api/accounts/${ADMIN_ID}`).send({ role: 'STAFF' }),
      409,
      'LAST_ADMIN',
    ],
    [
      'POST /api/accounts/:id/deactivate for an unknown account (api-design 12)',
      'admin-1',
      () => server().post(`/api/accounts/${MISSING_ID}/deactivate`).send({ reason: 'Left' }),
      404,
      'NOT_FOUND',
    ],
    [
      'POST /api/accounts/:id/deactivate on the last active Admin (api-design 12)',
      'admin-1',
      () => server().post(`/api/accounts/${ADMIN_ID}/deactivate`).send({ reason: 'Left' }),
      409,
      'LAST_ADMIN',
    ],
    [
      'POST /api/accounts/:id/reactivate for an unknown account (api-design 13)',
      'admin-1',
      () => server().post(`/api/accounts/${MISSING_ID}/reactivate`),
      404,
      'NOT_FOUND',
    ],
    [
      'PUT /api/roles/:id/permissions for an unknown role (api-design 16)',
      'admin-1',
      () => server().put(`/api/roles/${MISSING_ID}/permissions`).send({ permissionKeys: [] }),
      404,
      'NOT_FOUND',
    ],
    [
      'PUT /api/roles/:id/permissions with a key outside the catalog (api-design 16)',
      'admin-1',
      () =>
        server()
          .put(`/api/roles/${OPERATOR_ROLE_ID}/permissions`)
          .send({ permissionKeys: ['nope.read'] }),
      400,
      'UNKNOWN_PERMISSION',
    ],
    [
      'PUT /api/roles/:id/permissions granting a TrekLink permission to an organization role (api-design 16)',
      'admin-1',
      () =>
        server()
          .put(`/api/roles/${OPERATOR_ROLE_ID}/permissions`)
          .send({ permissionKeys: ['role.manage'] }),
      400,
      'PERMISSION_SCOPE_MISMATCH',
    ],
    [
      'PUT /api/roles/:id/permissions taking role.manage from the Admin (api-design 16)',
      'admin-1',
      () => server().put(`/api/roles/${ADMIN_ROLE_ID}/permissions`).send({ permissionKeys: [] }),
      409,
      'ADMIN_LOCKOUT',
    ],
  ])('answers %s with its code', async (_label, caller, call, status, errorCode) => {
    const response = await as(caller)(call());
    expect(response.status).toBe(status);
    expect(response.body).toMatchObject({ isSuccess: false, result: { errorCode } });
  });

  it('pages the authentication log for the Admin with each account organization (api-design 17)', async () => {
    const response = await as('admin-1')(
      server().get('/api/auth-events?type=LOGIN_FAILED&from=2026-10-01T00:00:00Z'),
    );

    expect(response.status).toBe(200);
    expect(authEventWhere).toEqual({
      type: 'LOGIN_FAILED',
      createdAt: { gte: new Date('2026-10-01T00:00:00Z') },
    });
    expect(response.body).toMatchObject({
      message: 'OK',
      result: {
        items: [
          {
            id: 'e-1',
            userId: MANAGER_ID,
            organization: { id: ORG_ID, name: 'ACME Trek Co., Ltd.' },
            type: 'LOGIN_FAILED',
            createdAt: '2026-10-20T03:15:00.000Z',
          },
          { id: 'e-2', userId: null, email: 'nobody@acme-trek.vn', organization: null },
        ],
        pageNumber: 1,
        totalCount: 2,
      },
    });
  });

  it('filters the log by the members of an organization, and answers an unknown one with an empty page (api-design 17)', async () => {
    authEventWhere = undefined;
    const filtered = await as('admin-1')(server().get(`/api/auth-events?organizationId=${ORG_ID}`));
    expect(filtered.status).toBe(200);
    expect(authEventWhere).toEqual({ userId: { in: [MANAGER_ID] } });

    authEventWhere = undefined;
    const unknown = await as('admin-1')(
      server().get(`/api/auth-events?organizationId=${OTHER_ORG_ID}`),
    );
    expect(unknown.status).toBe(200);
    expect(unknown.body).toMatchObject({ result: { items: [], totalCount: 0 } });
    expect(authEventWhere).toBeUndefined();
  });
});
