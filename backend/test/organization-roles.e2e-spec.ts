import { Controller, Module, Post, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AuthModule, CheckPolicies, JwtAuthGuard, PoliciesGuard } from '../src/modules/auth';

// The roles of the caller's own organization through the real HTTP pipeline (auth api-design 19 and 20,
// D-095, AC-07, AC-08, AC-10). Prisma is stubbed with the state of one organization: the policy rows
// are kept in memory, so a save changes what the next request reads, as in Postgres. The two-
// organization and concurrency cases run against Postgres in organization-role-policy.db-spec.ts. A
// probe route stands in for acknowledging an incident, guarded as the incidents module guards it.

@Controller('organization-roles-probe')
@UseGuards(JwtAuthGuard, PoliciesGuard)
class AcknowledgeProbeController {
  @Post('acknowledge')
  @CheckPolicies((ability) => ability.can('respond', 'Incident'))
  acknowledge() {
    return { acknowledged: true };
  }
}

@Module({ imports: [AuthModule], controllers: [AcknowledgeProbeController] })
class AcknowledgeProbeModule {}

const account = (id: string, accountType: string, role: string) => ({
  id,
  email: `${id}@treklink.vn`,
  fullName: id,
  accountType,
  isActive: true,
  deletedAt: null,
  passwordHash: 'hash',
  lockedUntil: null,
  lastLoginAt: null,
  roles: [{ role: { key: role } }],
});

const ACCOUNTS: Record<string, ReturnType<typeof account>> = {
  'manager-a': account('manager-a', 'ORGANIZATION', 'ORG_MANAGER'),
  'operator-a': account('operator-a', 'ORGANIZATION', 'ORG_OPERATOR'),
  'staff-1': account('staff-1', 'TREKLINK', 'STAFF'),
  'admin-1': account('admin-1', 'TREKLINK', 'ADMIN'),
};

const ORG_A = { id: 'org-a', code: 'ORG-0001', legalName: 'ACME Trek Co., Ltd.', status: 'ACTIVE' };
const MEMBER_ROWS: Record<string, unknown> = {
  'manager-a': { role: 'MANAGER', organization: ORG_A },
  'operator-a': { role: 'OPERATOR', organization: ORG_A },
};

const OWN = { organizationId: '${user.organizationId}' };
const rule = (key: string, action: string, subject: string, conditions: object | null = OWN) => ({
  key,
  action,
  subject,
  conditions,
  fields: [],
  inverted: false,
  reason: null,
});

const READ_OWN = rule('incident.read.own', 'read', 'Incident');
const RESPOND_OWN = rule('incident.respond.own', 'respond', 'Incident');
const MEMBER_OWN = rule('member.manage.own', 'manage', 'Member');
const ROLE_OWN = rule('organizationRole.manage.own', 'manage', 'OrganizationRole');

// The seeded rows: ORG_MANAGER holds every row of ORG_OPERATOR (FR-AUTH-10).
const BASELINE: Record<string, unknown[]> = {
  ORG_OPERATOR: [READ_OWN, RESPOND_OWN],
  ORG_MANAGER: [READ_OWN, RESPOND_OWN, MEMBER_OWN, ROLE_OWN],
  ADMIN: [],
  STAFF: [],
};

const CATALOG = [
  ...[READ_OWN, RESPOND_OWN, MEMBER_OWN, ROLE_OWN].map((row) => ({
    id: `p-${row.key}`,
    key: row.key,
    action: row.action,
    subject: row.subject,
    accountType: 'ORGANIZATION',
    conditions: row.conditions,
  })),
  {
    id: 'p-invoice.read',
    key: 'invoice.read',
    action: 'read',
    subject: 'Invoice',
    accountType: 'TREKLINK',
    conditions: null,
  },
];

describe('organization roles (e2e, auth api-design 19 and 20)', () => {
  let app: NestExpressApplication;
  let jwt: JwtService;

  // organizationId:roleKey -> the stored version and rows of the policy
  const policies = new Map<string, { version: number; rows: { key: string; effect: string }[] }>();
  const policyOf = (organizationId: string, roleKey: string) => {
    const key = `${organizationId}:${roleKey}`;
    if (!policies.has(key)) policies.set(key, { version: 0, rows: [] });
    return policies.get(key)!;
  };
  const roleKeyOf = (roleId: string) => roleId.replace('role-', '');

  const prisma = {
    $transaction: (work: (tx: unknown) => Promise<unknown>): Promise<unknown> => work(prisma),
    $executeRaw: (_sql: unknown, organizationId: string, roleId: string) => {
      policyOf(organizationId, roleKeyOf(roleId));
      return Promise.resolve(1);
    },
    $queryRaw: (_sql: unknown, organizationId: string, roleId: string) =>
      Promise.resolve([{ version: policyOf(organizationId, roleKeyOf(roleId)).version }]),
    role: {
      findUnique: ({ where }: { where: { key: string } }) =>
        Promise.resolve({ id: `role-${where.key}`, key: where.key }),
    },
    permission: {
      findMany: ({ where }: { where: { key: { in: string[] } } }) =>
        Promise.resolve(CATALOG.filter((row) => where.key.in.includes(row.key))),
    },
    organizationRolePolicy: {
      findFirst: ({
        where,
      }: {
        where: { organizationId: string; role: { key: string } };
      }): Promise<unknown> => {
        const stored = policyOf(where.organizationId, where.role.key);
        return Promise.resolve(
          stored.version === 0
            ? null
            : {
                version: stored.version,
                updatedAt: new Date(),
                permissions: stored.rows.map((row) => ({
                  effect: row.effect,
                  permission: { key: row.key },
                })),
              },
        );
      },
      update: ({
        where,
        data,
      }: {
        where: { organizationId_roleId: { organizationId: string; roleId: string } };
        data: { version: { increment: number } };
      }) => {
        const { organizationId, roleId } = where.organizationId_roleId;
        const stored = policyOf(organizationId, roleKeyOf(roleId));
        stored.version += data.version.increment;
        return Promise.resolve({ version: stored.version });
      },
    },
    organizationRolePermission: {
      deleteMany: ({ where }: { where: { organizationId: string; roleId: string } }) => {
        policyOf(where.organizationId, roleKeyOf(where.roleId)).rows = [];
        return Promise.resolve({ count: 0 });
      },
      createMany: ({
        data,
      }: {
        data: { organizationId: string; roleId: string; permissionId: string; effect: string }[];
      }) => {
        for (const row of data) {
          policyOf(row.organizationId, roleKeyOf(row.roleId)).rows.push({
            key: row.permissionId.replace('p-', ''),
            effect: row.effect,
          });
        }
        return Promise.resolve({ count: data.length });
      },
    },
    auditLog: { create: ({ data }: { data: unknown }) => Promise.resolve(data) },
    user: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(ACCOUNTS[where.id] ?? null),
    },
    organizationMember: {
      findFirst: ({ where }: { where: { userId: string } }) =>
        Promise.resolve(MEMBER_ROWS[where.userId] ?? null),
    },
    rolePermission: {
      findMany: ({ where }: { where: { role: { key: string } } }) =>
        Promise.resolve((BASELINE[where.role.key] ?? []).map((permission) => ({ permission }))),
    },
  };

  const token = (userId: string) => jwt.signAsync({ sub: userId, roles: [], pv: 0 });
  const get = async (userId: string | null, path: string) => {
    const call = request(app.getHttpServer()).get(path);
    return userId ? call.set('Authorization', `Bearer ${await token(userId)}`) : call;
  };
  const put = async (userId: string | null, path: string, body: object) => {
    const call = request(app.getHttpServer()).put(path);
    return (userId ? call.set('Authorization', `Bearer ${await token(userId)}`) : call).send(body);
  };
  const acknowledge = async (userId: string) =>
    request(app.getHttpServer())
      .post('/api/organization-roles-probe/acknowledge')
      .set('Authorization', `Bearer ${await token(userId)}`);
  const OPERATOR = '/api/organization/roles/ORG_OPERATOR/permissions';
  const MANAGER = '/api/organization/roles/ORG_MANAGER/permissions';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, AcknowledgeProbeModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    jwt = moduleRef.get(JwtService, { strict: false });
  });

  beforeEach(() => policies.clear());

  afterAll(async () => {
    await app.close();
  });

  describe('authentication and permission (401, 403)', () => {
    it('answers 401 without a token', async () => {
      expect((await get(null, '/api/organization/roles')).status).toBe(401);
      expect((await put(null, OPERATOR, { permissionKeys: [], expectedVersion: 0 })).status).toBe(
        401,
      );
    });

    it.each(['operator-a', 'staff-1', 'admin-1'])('answers 403 to %s', async (caller) => {
      const read = await get(caller, '/api/organization/roles');
      expect(read.status).toBe(403);
      expect(read.body).toMatchObject({ result: { errorCode: 'FORBIDDEN' } });
      expect((await put(caller, OPERATOR, { permissionKeys: [], expectedVersion: 0 })).status).toBe(
        403,
      );
    });
  });

  describe('GET /api/organization/roles', () => {
    it('answers both roles with baseline, effective keys and version 0, and the ceiling', async () => {
      const response = await get('manager-a', '/api/organization/roles');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ isSuccess: true, statusCode: 200, message: 'OK' });
      const { roles, catalog } = (
        response.body as {
          result: {
            roles: { key: string; version: number; effectiveKeys: string[] }[];
            catalog: { key: string; protected: boolean }[];
          };
        }
      ).result;
      expect(roles.map((role) => [role.key, role.version])).toEqual([
        ['ORG_MANAGER', 0],
        ['ORG_OPERATOR', 0],
      ]);
      expect(roles[1].effectiveKeys).toEqual(['incident.read.own', 'incident.respond.own']);
      expect(catalog.map((row) => row.key)).toEqual([
        'incident.read.own',
        'incident.respond.own',
        'member.manage.own',
        'organizationRole.manage.own',
      ]);
      expect(catalog.find((row) => row.key === 'organizationRole.manage.own')?.protected).toBe(
        true,
      );
    });
  });

  describe('PUT /api/organization/roles/:roleKey/permissions: validation rows', () => {
    it.each([
      ['a missing expectedVersion', { permissionKeys: [] }],
      ['a negative expectedVersion', { permissionKeys: [], expectedVersion: -1 }],
      ['permissionKeys that is not a list', { permissionKeys: 'x', expectedVersion: 0 }],
      ['a key that is not a string', { permissionKeys: [1], expectedVersion: 0 }],
    ])('answers 400 VALIDATION_FAILED for %s', async (_name, body) => {
      const response = await put('manager-a', OPERATOR, body);

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ result: { errorCode: 'VALIDATION_FAILED' } });
    });

    it.each(['STAFF', 'ADMIN', 'ORG_UNKNOWN'])('answers 404 for the role %s', async (roleKey) => {
      const response = await put('manager-a', `/api/organization/roles/${roleKey}/permissions`, {
        permissionKeys: [],
        expectedVersion: 0,
      });

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ result: { errorCode: 'NOT_FOUND' } });
    });

    it('answers 400 UNKNOWN_PERMISSION for a key that is not in the catalog', async () => {
      const response = await put('manager-a', OPERATOR, {
        permissionKeys: ['nothing.here'],
        expectedVersion: 0,
      });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ result: { errorCode: 'UNKNOWN_PERMISSION' } });
    });

    it('answers 400 PERMISSION_OUT_OF_CEILING for a TrekLink key', async () => {
      const response = await put('manager-a', OPERATOR, {
        permissionKeys: ['invoice.read'],
        expectedVersion: 0,
      });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        result: { errorCode: 'PERMISSION_OUT_OF_CEILING' },
        message: 'invoice.read cannot be granted to this role.',
      });
    });

    it('answers 400 PERMISSION_OUT_OF_CEILING when the Operator is given the protected key (OQ-06)', async () => {
      const response = await put('manager-a', OPERATOR, {
        permissionKeys: ['incident.read.own', 'organizationRole.manage.own'],
        expectedVersion: 0,
      });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ result: { errorCode: 'PERMISSION_OUT_OF_CEILING' } });
    });

    it('answers 409 MANAGER_LOCKOUT for a Manager set without the protected key (AC-08)', async () => {
      const response = await put('manager-a', MANAGER, {
        permissionKeys: ['member.manage.own'],
        expectedVersion: 0,
      });

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        result: { errorCode: 'MANAGER_LOCKOUT' },
        message: 'Managers must keep the right to manage roles.',
      });
    });

    it('answers 409 STALE_VERSION for a version that is not the stored one', async () => {
      const response = await put('manager-a', OPERATOR, {
        permissionKeys: ['incident.read.own'],
        expectedVersion: 4,
      });

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ result: { errorCode: 'STALE_VERSION' } });
    });
  });

  it('applies a revoke from the next request, leaves the Manager untouched and counts the version (AC-07, AC-10)', async () => {
    expect((await acknowledge('operator-a')).status).toBe(201);

    const saved = await put('manager-a', OPERATOR, {
      permissionKeys: ['incident.read.own'],
      expectedVersion: 0,
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      result: { key: 'ORG_OPERATOR', version: 1, effectiveKeys: ['incident.read.own'] },
      message: 'Permissions updated',
    });

    // AC-07: the Operator is refused on the next request, with no new sign-in.
    const refused = await acknowledge('operator-a');
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ result: { errorCode: 'FORBIDDEN' } });
    // AC-10: the Manager who unticked the box still holds the permission.
    expect((await acknowledge('manager-a')).status).toBe(201);

    const read = await get('manager-a', '/api/organization/roles');
    const roles = (
      read.body as {
        result: { roles: { key: string; version: number; effectiveKeys: string[] }[] };
      }
    ).result.roles;
    expect(roles[1]).toMatchObject({
      key: 'ORG_OPERATOR',
      version: 1,
      effectiveKeys: ['incident.read.own'],
    });
    expect(roles[0].effectiveKeys).toContain('incident.respond.own');

    // The version read with the role is the one the next save must send.
    const stale = await put('manager-a', OPERATOR, {
      permissionKeys: ['incident.read.own', 'incident.respond.own'],
      expectedVersion: 0,
    });
    expect(stale.status).toBe(409);
    const restored = await put('manager-a', OPERATOR, {
      permissionKeys: ['incident.read.own', 'incident.respond.own'],
      expectedVersion: 1,
    });
    expect(restored.body).toMatchObject({ result: { version: 2 } });
    expect((await acknowledge('operator-a')).status).toBe(201);
  });

  it('lets the Manager narrow its own set and keeps the Operator baseline and the protected key', async () => {
    const saved = await put('manager-a', MANAGER, {
      permissionKeys: ['organizationRole.manage.own'],
      expectedVersion: 0,
    });

    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      result: {
        key: 'ORG_MANAGER',
        effectiveKeys: ['incident.read.own', 'incident.respond.own', 'organizationRole.manage.own'],
      },
    });
  });
});
