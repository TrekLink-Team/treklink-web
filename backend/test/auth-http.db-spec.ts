import './db-app-env';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AccountType, MemberRole, OrganizationStatus } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { JobRunnerService } from '../src/modules/platform/scheduler/job-runner.service';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

interface Envelope<T> {
  result: T;
  isSuccess: boolean;
  statusCode: number;
  message: string;
}

interface RoleView {
  id: string;
  key: string;
  permissionKeys: string[];
}

// auth task 6.2 through the HTTP pipeline against Postgres: the success rows of api-design 10 to 13,
// 15 and 16, which the stubbed e2e suites cannot reach, and AC-03 on the real incidents route. The
// whole application runs, with the scheduler replaced so no job fires; the seeded roles and
// permissions are the real ones. AC-03 changes ORG_OPERATOR's permissions and puts them back.
describe('auth over HTTP against Postgres (api-design 10 to 13, 15, 16; AC-03)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const runId = randomUUID().slice(0, 8);
  let adminToken: string;
  let operatorToken: string;

  const userWithRole = async (key: string, accountType: AccountType) => {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    return prisma.user.create({
      data: {
        email: `auth-http-${runId}-${key.toLowerCase()}@example.invalid`,
        fullName: `Auth HTTP ${key}`,
        accountType,
        // A session needs an activated account; the token is signed here, so no password is checked.
        passwordHash: 'not-a-real-hash',
        roles: { create: { roleId: role.id } },
      },
    });
  };

  const tokenOf = (userId: string) => jwt.signAsync({ sub: userId, roles: [], pv: 0 });

  const call = (
    token: string,
    method: 'get' | 'post' | 'patch' | 'put',
    path: string,
    body?: object,
  ) => {
    const pending = request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${token}`);
    return body ? pending.send(body) : pending;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(JobRunnerService)
      .useValue({ onApplicationBootstrap: () => undefined })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService, { strict: false });

    const admin = await userWithRole('ADMIN', AccountType.TREKLINK);
    adminToken = await tokenOf(admin.id);

    const organization = await prisma.organization.create({
      data: {
        code: `AH-${runId}`,
        legalName: 'Auth HTTP organization',
        taxCode: `auth-http-${runId}`,
        address: 'Test address',
        contactEmail: `auth-http-${runId}@example.invalid`,
        contactPhone: '0900000000',
        status: OrganizationStatus.ACTIVE,
      },
    });
    const operator = await userWithRole('ORG_OPERATOR', AccountType.ORGANIZATION);
    await prisma.organizationMember.create({
      data: { userId: operator.id, organizationId: organization.id, role: MemberRole.OPERATOR },
    });
    operatorToken = await tokenOf(operator.id);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates, edits, deactivates and reactivates a TrekLink account (api-design 10 to 13)', async () => {
    const created = await call(adminToken, 'post', '/api/accounts', {
      email: `auth-http-${runId}-staff@example.invalid`,
      fullName: 'Le Van C',
      role: 'STAFF',
    });
    expect(created.status).toBe(201);
    const account = (created.body as Envelope<{ id: string; roles: string[]; isActive: boolean }>)
      .result;
    expect(account).toMatchObject({ roles: ['STAFF'], isActive: true });

    const edited = await call(adminToken, 'patch', `/api/accounts/${account.id}`, {
      fullName: 'Le Van C2',
      role: 'ADMIN',
    });
    expect(edited.status).toBe(200);
    expect((edited.body as Envelope<object>).result).toMatchObject({
      fullName: 'Le Van C2',
      roles: ['ADMIN'],
    });

    const deactivated = await call(adminToken, 'post', `/api/accounts/${account.id}/deactivate`, {
      reason: 'Left the company',
    });
    expect(deactivated.status).toBe(200);
    expect((deactivated.body as Envelope<object>).result).toMatchObject({ isActive: false });

    const reactivated = await call(adminToken, 'post', `/api/accounts/${account.id}/reactivate`);
    expect(reactivated.status).toBe(200);
    expect((reactivated.body as Envelope<object>).result).toMatchObject({ isActive: true });
  });

  it("lists the roles, and refuses the operator's next acknowledge once the Admin removes incident.respond.own, without a restart (api-design 15, 16; AC-03)", async () => {
    const listed = await call(adminToken, 'get', '/api/roles');
    expect(listed.status).toBe(200);
    const operatorRole = (listed.body as Envelope<RoleView[]>).result.find(
      (role) => role.key === 'ORG_OPERATOR',
    );
    expect(operatorRole?.permissionKeys).toContain('incident.respond.own');
    const original = operatorRole!.permissionKeys;
    const acknowledge = () =>
      call(operatorToken, 'post', `/api/incidents/${randomUUID()}/acknowledge`, {
        expectedVersion: 0,
      });

    // Allowed by the policy, the call reaches the service, which finds no such incident.
    expect((await acknowledge()).status).toBe(404);

    try {
      const replaced = await call(adminToken, 'put', `/api/roles/${operatorRole!.id}/permissions`, {
        permissionKeys: original.filter((key) => key !== 'incident.respond.own'),
      });
      expect(replaced.status).toBe(200);

      const refused = await acknowledge();
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({
        isSuccess: false,
        statusCode: 403,
        result: { errorCode: 'FORBIDDEN' },
      });
    } finally {
      const restored = await call(adminToken, 'put', `/api/roles/${operatorRole!.id}/permissions`, {
        permissionKeys: original,
      });
      expect(restored.status).toBe(200);
    }
    expect((await acknowledge()).status).toBe(404);
  });
});
