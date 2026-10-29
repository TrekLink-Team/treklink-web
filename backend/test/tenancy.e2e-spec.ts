import { Controller, Get, Module, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import {
  assertOwnOr404,
  AuthModule,
  type AuthUser,
  CheckPolicies,
  CurrentUser,
  JwtAuthGuard,
  PoliciesGuard,
  scopeWhere,
} from '../src/modules/auth';

// Tenant isolation through the real HTTP pipeline (auth task 4.2, AC-01, TC-19). The incidents
// module does not exist yet, so a probe controller stands in for GET /api/incidents/{id} and the
// incident list, guarded exactly as the module will be. The permission rows are the seeded
// `incident.read` (STAFF) and `incident.read.own` (ORG_OPERATOR) of the permission matrix. The
// membership comes through the real `organizations` provider (organizations 1.3) from the stubbed
// member row. The incidents module replaces the probe with its own routes when it lands. The
// acknowledge probe carries the seeded `incident.respond.own` of ORG_OPERATOR for AC-03.

const INCIDENTS = [
  { id: 'incident-a', organizationId: 'org-a' },
  { id: 'incident-b', organizationId: 'org-b' },
];

@Controller('tenancy-probe/incidents')
@UseGuards(JwtAuthGuard, PoliciesGuard)
class IncidentProbeController {
  @Get()
  @CheckPolicies((ability) => ability.can('read', 'Incident'))
  list(@CurrentUser() caller: AuthUser, @Query('organizationId') _requested?: string) {
    const where = scopeWhere(caller);
    return INCIDENTS.filter(
      (row) => !where.organizationId || row.organizationId === where.organizationId,
    );
  }

  @Get(':id')
  @CheckPolicies((ability) => ability.can('read', 'Incident'))
  get(@CurrentUser() caller: AuthUser, @Param('id') id: string) {
    const row = INCIDENTS.find((incident) => incident.id === id);
    if (row) assertOwnOr404(caller.ability, 'read', 'Incident', row, 'Incident not found.');
    return row;
  }

  @Post(':id/acknowledge')
  @CheckPolicies((ability) => ability.can('respond', 'Incident'))
  acknowledge(@Param('id') id: string) {
    return { id };
  }
}

// The live member rows, as `MembersRepository.findLiveMembership` selects them.
const MEMBER_ROWS: Record<string, unknown> = {
  'operator-a': {
    role: 'OPERATOR',
    organization: {
      id: 'org-a',
      code: 'ORG-0001',
      legalName: 'ACME Trek Co., Ltd.',
      status: 'ACTIVE',
    },
  },
};

@Module({ imports: [AuthModule], controllers: [IncidentProbeController] })
class IncidentProbeModule {}

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
  'staff-1': account('staff-1', 'TREKLINK', 'STAFF'),
  'operator-a': account('operator-a', 'ORGANIZATION', 'ORG_OPERATOR'),
  'admin-1': account('admin-1', 'TREKLINK', 'ADMIN'),
};

const OPERATOR_ROLE_ID = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';

const READ_OWN = {
  key: 'incident.read.own',
  action: 'read',
  subject: 'Incident',
  conditions: { organizationId: '${user.organizationId}' },
  fields: [],
  inverted: false,
  reason: null,
};

const RESPOND_OWN = {
  key: 'incident.respond.own',
  action: 'respond',
  subject: 'Incident',
  conditions: { organizationId: '${user.organizationId}' },
  fields: [],
  inverted: false,
  reason: null,
};

// The permission catalog rows `RolesService.replacePermissions` validates against.
const CATALOG = [READ_OWN, RESPOND_OWN].map((permission) => ({
  id: `p-${permission.key}`,
  key: permission.key,
  action: permission.action,
  subject: permission.subject,
  accountType: 'ORGANIZATION',
  conditions: permission.conditions,
}));

const PERMISSIONS: Record<string, unknown[]> = {
  ADMIN: [
    {
      key: 'role.manage',
      action: 'manage',
      subject: 'Role',
      conditions: null,
      fields: [],
      inverted: false,
      reason: null,
    },
  ],
  STAFF: [
    {
      key: 'incident.read',
      action: 'read',
      subject: 'Incident',
      conditions: null,
      fields: [],
      inverted: false,
      reason: null,
    },
  ],
  ORG_OPERATOR: [READ_OWN, RESPOND_OWN],
};

describe('tenant isolation (e2e)', () => {
  let app: NestExpressApplication;
  let jwt: JwtService;

  const prisma = {
    $transaction: (work: (tx: unknown) => Promise<unknown>): Promise<unknown> => work(prisma),
    role: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === OPERATOR_ROLE_ID
            ? {
                id: OPERATOR_ROLE_ID,
                key: 'ORG_OPERATOR',
                accountType: 'ORGANIZATION',
                isSystem: true,
                permissions: [],
              }
            : null,
        ),
    },
    permission: {
      findMany: ({ where }: { where: { key: { in: string[] } } }) =>
        Promise.resolve(CATALOG.filter((row) => where.key.in.includes(row.key))),
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
        Promise.resolve((PERMISSIONS[where.role.key] ?? []).map((permission) => ({ permission }))),
      // Only the operator role is ever replaced here.
      deleteMany: () => {
        PERMISSIONS.ORG_OPERATOR = [];
        return Promise.resolve({ count: 0 });
      },
      createMany: ({ data }: { data: { permissionId: string }[] }) => {
        PERMISSIONS.ORG_OPERATOR = data.map(({ permissionId }) =>
          [READ_OWN, RESPOND_OWN].find((row) => `p-${row.key}` === permissionId)!,
        );
        return Promise.resolve({ count: data.length });
      },
    },
  };

  const asCaller = (userId: string, path: string, organizationId?: string) =>
    jwt
      .signAsync({ sub: userId, roles: [], pv: 0, ...(organizationId ? { organizationId } : {}) })
      .then((token) =>
        request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`),
      );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, IncidentProbeModule],
    })
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

  it("answers 404 to an Org Operator for another organization's incident (AC-01)", async () => {
    const response = await asCaller('operator-a', '/api/tenancy-probe/incidents/incident-b');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      result: { errorCode: 'NOT_FOUND' },
      isSuccess: false,
      statusCode: 404,
      message: 'Incident not found.',
    });
  });

  it('answers 200 to TrekLink Staff for the same incident (AC-01)', async () => {
    const response = await asCaller('staff-1', '/api/tenancy-probe/incidents/incident-b');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      result: { id: 'incident-b', organizationId: 'org-b' },
      isSuccess: true,
    });
  });

  it("answers 200 to the Org Operator for its own organization's incident", async () => {
    const response = await asCaller('operator-a', '/api/tenancy-probe/incidents/incident-a');

    expect(response.status).toBe(200);
  });

  it('keeps a member to its organization whatever the token or query claims (FR-AUTH-11)', async () => {
    const response = await asCaller(
      'operator-a',
      '/api/tenancy-probe/incidents?organizationId=org-b',
      'org-b',
    );

    expect(response.status).toBe(200);
    expect((response.body as { result: unknown }).result).toEqual([
      { id: 'incident-a', organizationId: 'org-a' },
    ]);
  });

  it('lists every organization for TrekLink Staff (BR-19)', async () => {
    const response = await asCaller('staff-1', '/api/tenancy-probe/incidents');

    expect((response.body as { result: unknown[] }).result).toHaveLength(2);
  });

  it('answers 401 without a token', async () => {
    await request(app.getHttpServer()).get('/api/tenancy-probe/incidents/incident-a').expect(401);
  });

  it("refuses the operator's next acknowledge once the Admin removes incident.respond.own, without a restart (AC-03)", async () => {
    const token = (userId: string) => jwt.signAsync({ sub: userId, roles: [], pv: 0 });
    const acknowledge = async () =>
      request(app.getHttpServer())
        .post('/api/tenancy-probe/incidents/incident-a/acknowledge')
        .set('Authorization', `Bearer ${await token('operator-a')}`);

    expect((await acknowledge()).status).toBe(201);

    const replaced = await request(app.getHttpServer())
      .put(`/api/roles/${OPERATOR_ROLE_ID}/permissions`)
      .set('Authorization', `Bearer ${await token('admin-1')}`)
      .send({ permissionKeys: ['incident.read.own'] });
    expect(replaced.status).toBe(200);
    expect(replaced.body).toMatchObject({ result: { key: 'ORG_OPERATOR', permissionCount: 1 } });

    const refused = await acknowledge();
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ result: { errorCode: 'FORBIDDEN' } });
    // Reading is still allowed: only the removed permission is gone.
    expect((await asCaller('operator-a', '/api/tenancy-probe/incidents/incident-a')).status).toBe(
      200,
    );
  });
});
