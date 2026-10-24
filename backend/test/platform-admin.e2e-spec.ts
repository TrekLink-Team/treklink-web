import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';

// Parameters and audit log through the real HTTP pipeline and the global guards (platform task 4.2,
// api-design 02 to 05, D-061). Prisma is an in-memory stub of the calls these routes make; the seeded
// `parameter.manage` and `auditLog.read` rows belong to ADMIN only (permission matrix).

const account = (id: string, role: string) => ({
  id,
  email: `${id}@treklink.vn`,
  fullName: `Name of ${id}`,
  accountType: 'TREKLINK',
  isActive: true,
  deletedAt: null,
  passwordHash: 'hash',
  lockedUntil: null,
  lastLoginAt: null,
  roles: [{ role: { key: role } }],
});
const ACCOUNTS: Record<string, ReturnType<typeof account>> = {
  'admin-1': account('admin-1', 'ADMIN'),
  'staff-1': account('staff-1', 'STAFF'),
};
const rule = (key: string, action: string, subject: string) => ({
  permission: { key, action, subject, conditions: null, fields: [], inverted: false, reason: null },
});
const PERMISSIONS: Record<string, unknown[]> = {
  ADMIN: [
    rule('parameter.manage', 'manage', 'Parameter'),
    rule('auditLog.read', 'read', 'AuditLog'),
  ],
  STAFF: [rule('incident.read', 'read', 'Incident')],
};

const KEY = 'incidents.primaryAckTimeoutSeconds';
const UPDATED_AT = new Date('2026-10-20T03:15:00.000Z');

describe('parameters and audit log (e2e)', () => {
  let app: NestExpressApplication;
  let jwt: JwtService;
  let parameter: Record<string, unknown>;
  const history: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];

  const prisma = {
    $transaction: (work: (tx: unknown) => Promise<unknown>) => work(prisma),
    $queryRaw: () => Promise.resolve([]),
    user: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(ACCOUNTS[where.id] ?? null),
      findMany: ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          where.id.in
            .filter((id) => ACCOUNTS[id])
            .map((id) => ({ id, fullName: ACCOUNTS[id].fullName })),
        ),
    },
    rolePermission: {
      findMany: ({ where }: { where: { role: { key: string } } }) =>
        Promise.resolve(PERMISSIONS[where.role.key] ?? []),
    },
    businessParameter: {
      findMany: () => Promise.resolve([parameter]),
      count: () => Promise.resolve(1),
      findUnique: ({ where }: { where: { key: string } }) =>
        Promise.resolve(where.key === KEY ? { ...parameter } : null),
      update: ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(parameter, data, { updatedAt: new Date() });
        return Promise.resolve({ ...parameter });
      },
    },
    businessParameterHistory: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        history.unshift({ ...data, changedAt: new Date() });
        return Promise.resolve(data);
      },
      findMany: () => Promise.resolve(history.map(({ key: _key, ...row }) => row)),
      count: () => Promise.resolve(history.length),
    },
    auditLog: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        audits.unshift({ id: `audit-${audits.length + 1}`, createdAt: new Date(), ...data });
        return Promise.resolve(data);
      },
      findMany: () => Promise.resolve(audits),
      count: () => Promise.resolve(audits.length),
    },
  };

  const as = async (userId: string | null) => {
    const token = userId ? await jwt.signAsync({ sub: userId, roles: [], pv: 0 }) : null;
    const server = request(app.getHttpServer());
    const auth = <T extends request.Test>(test: T) =>
      token ? test.set('Authorization', `Bearer ${token}`) : test;
    return {
      get: (path: string) => auth(server.get(path)),
      patch: (path: string, body: object) => auth(server.patch(path).send(body)),
    };
  };
  const errorOf = (response: request.Response) => [
    response.status,
    (response.body as { result: { errorCode: string } }).result?.errorCode,
  ];

  beforeAll(async () => {
    parameter = {
      key: KEY,
      value: 120,
      valueType: 'DURATION_SECONDS',
      bounds: { min: 30, max: 900 },
      unit: 'seconds',
      ownerModule: 'incidents',
      description: 'How long the primary on-duty member has to acknowledge',
      version: 3,
      updatedAt: UPDATED_AT,
    };
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

  describe('GET /api/parameters (api-design 02)', () => {
    it('answers 401 without a token and 403 to TrekLink Staff', async () => {
      expect(errorOf(await (await as(null)).get('/api/parameters'))).toEqual([
        401,
        'UNAUTHENTICATED',
      ]);
      expect(errorOf(await (await as('staff-1')).get('/api/parameters'))).toEqual([
        403,
        'FORBIDDEN',
      ]);
    });

    it('lists the parameters to the Admin in the paged envelope', async () => {
      const response = await (await as('admin-1')).get('/api/parameters?ownerModule=incidents');
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        result: {
          items: [{ key: KEY, value: 120, version: 3 }],
          pageNumber: 1,
          pageSize: 20,
          totalCount: 1,
          totalPages: 1,
        },
        isSuccess: true,
        statusCode: 200,
        message: 'OK',
      });
    });

    it('answers 400 for a page size above MAX_PAGE_SIZE and a malformed module name', async () => {
      const admin = await as('admin-1');
      expect(errorOf(await admin.get('/api/parameters?pageSize=101'))).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
      expect(errorOf(await admin.get('/api/parameters?ownerModule=Incidents!'))).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
    });
  });

  describe('PATCH /api/parameters/:key (api-design 03)', () => {
    it('refuses a missing version, an unknown key, an out-of-range value and a stale version', async () => {
      const admin = await as('admin-1');
      expect(errorOf(await admin.patch(`/api/parameters/${KEY}`, { value: 90 }))).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
      expect(
        errorOf(await admin.patch('/api/parameters/nope.key', { value: 90, expectedVersion: 1 })),
      ).toEqual([404, 'NOT_FOUND']);
      const outOfRange = await admin.patch(`/api/parameters/${KEY}`, {
        value: 5,
        expectedVersion: 3,
      });
      expect(errorOf(outOfRange)).toEqual([400, 'PARAMETER_OUT_OF_RANGE']);
      expect((outOfRange.body as { message: string }).message).toBe(
        'value must be between 30 and 900.',
      );
      const stale = await admin.patch(`/api/parameters/${KEY}`, { value: 90, expectedVersion: 2 });
      expect(errorOf(stale)).toEqual([409, 'STALE_VERSION']);
      expect(parameter.value).toBe(120);
    });

    it('answers 403 to Staff and changes nothing', async () => {
      const response = await (
        await as('staff-1')
      ).patch(`/api/parameters/${KEY}`, { value: 90, expectedVersion: 3 });
      expect(errorOf(response)).toEqual([403, 'FORBIDDEN']);
      expect(parameter.value).toBe(120);
    });

    it('updates the value for the Admin, writes the history and the audit row (AC-06)', async () => {
      const response = await (
        await as('admin-1')
      ).patch(`/api/parameters/${KEY}`, {
        value: 90,
        expectedVersion: 3,
        reason: 'Faster escalation for the drill',
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        result: { key: KEY, value: 90, version: 4 },
        message: 'Parameter updated',
      });
      expect(history[0]).toMatchObject({
        previousValue: 120,
        newValue: 90,
        changedById: 'admin-1',
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(audits[0]).toMatchObject({
        action: 'parameter.update',
        subjectId: KEY,
        actorId: 'admin-1',
      });

      const list = await (await as('admin-1')).get('/api/parameters');
      expect((list.body as { result: { items: { value: number }[] } }).result.items[0].value).toBe(
        90,
      );
    });
  });

  describe('GET /api/parameters/:key/history (api-design 04)', () => {
    it('returns the history with the actor name, and 404 for an unknown key', async () => {
      const admin = await as('admin-1');
      const response = await admin.get(`/api/parameters/${KEY}/history`);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        result: {
          items: [
            {
              previousValue: 120,
              newValue: 90,
              changedBy: { id: 'admin-1', fullName: 'Name of admin-1' },
            },
          ],
          totalCount: 1,
        },
      });
      expect(errorOf(await admin.get('/api/parameters/nope.key/history'))).toEqual([
        404,
        'NOT_FOUND',
      ]);
    });
  });

  describe('GET /api/audit-logs (api-design 05)', () => {
    it('returns the log to the Admin with the actor, and 403 to Staff', async () => {
      const response = await (await as('admin-1')).get('/api/audit-logs?action=parameter.');
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        result: {
          items: [
            { action: 'parameter.update', actor: { id: 'admin-1', fullName: 'Name of admin-1' } },
          ],
        },
      });
      expect(errorOf(await (await as('staff-1')).get('/api/audit-logs'))).toEqual([
        403,
        'FORBIDDEN',
      ]);
    });

    it('answers 400 for a malformed actor id and a reversed time range', async () => {
      const admin = await as('admin-1');
      expect(errorOf(await admin.get('/api/audit-logs?actorId=nope'))).toEqual([
        400,
        'VALIDATION_FAILED',
      ]);
      expect(
        errorOf(
          await admin.get('/api/audit-logs?from=2026-10-21T00:00:00Z&to=2026-10-01T00:00:00Z'),
        ),
      ).toEqual([400, 'VALIDATION_FAILED']);
    });
  });

  describe('global guards (D-061)', () => {
    it('keeps public routes public and unknown routes 404', async () => {
      const anonymous = await as(null);
      expect((await anonymous.get('/api/health')).status).not.toBe(401);
      expect((await anonymous.get('/api/no-such-route')).status).toBe(404);
    });
  });
});
