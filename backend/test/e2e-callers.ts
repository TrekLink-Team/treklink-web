import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';

// Callers for the rentals and billing e2e suites (rentals 6.2, billing 5.2): four accounts through
// the real HTTP pipeline, the global guards and the ValidationPipe, with Prisma stubbed. The permission
// rows are the seeded ones of these roles (prisma/migrations/20261004120100_seed). Each suite adds the
// stubbed tables its routes read; a route that reaches an unstubbed table fails loudly.

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
  'admin-1': account('admin-1', 'TREKLINK', 'ADMIN'),
  'manager-a': account('manager-a', 'ORGANIZATION', 'ORG_MANAGER'),
  'operator-a': account('operator-a', 'ORGANIZATION', 'ORG_OPERATOR'),
};

const ORG_A = { id: 'org-a', code: 'ORG-0001', legalName: 'ACME Trek Co., Ltd.', status: 'ACTIVE' };

const MEMBERS: Record<string, unknown> = {
  'manager-a': { role: 'MANAGER', organization: ORG_A },
  'operator-a': { role: 'OPERATOR', organization: ORG_A },
};

const OWN = { organizationId: '${user.organizationId}' };

const rule = (key: string, action: string, subject: string, conditions: object | null = null) => ({
  key,
  action,
  subject,
  conditions,
  fields: [],
  inverted: false,
  reason: null,
});

const PERMISSIONS: Record<string, unknown[]> = {
  STAFF: [
    rule('contract.read', 'read', 'RentalContract'),
    rule('contract.operate', 'operate', 'RentalContract'),
    rule('invoice.read', 'read', 'Invoice'),
    rule('payment.read', 'read', 'Payment'),
    rule('payment.recordCounter', 'recordCounter', 'Invoice'),
    rule('plan.quote', 'quote', 'Plan'),
    rule('damageCharge.read', 'read', 'DamageCharge'),
    rule('device.operate', 'operate', 'Device'),
    // organizations (api-design 01 to 32)
    rule('organization.read', 'read', 'Organization'),
    rule('organization.verify', 'verify', 'Organization'),
    rule('organization.rotateKey', 'rotateKey', 'Organization'),
    rule('member.read', 'read', 'Member'),
    rule('apiKey.read', 'read', 'ApiKey'),
    rule('fieldStation.read', 'read', 'FieldStation'),
    rule('fieldStation.revoke', 'revoke', 'FieldStation'),
    rule('complianceCase.manage', 'manage', 'ComplianceCase'),
    // gateway-sync (api-design 03, 04 and 07)
    rule('fieldEvent.read', 'read', 'FieldEvent'),
  ],
  // The Admin rows the price and damage-rate routes need (billing api-design 03 to 07).
  ADMIN: [
    rule('priceSchedule.manage', 'manage', 'PriceSchedule'),
    rule('damageRate.read', 'read', 'DamageRate'),
    rule('damageRate.manage', 'manage', 'DamageRate'),
    // organizations (api-design 01 to 32)
    rule('organization.read', 'read', 'Organization'),
    rule('organization.update', 'update', 'Organization'),
    rule('organization.verify', 'verify', 'Organization'),
    rule('organization.decide', 'decide', 'Organization'),
    rule('organization.suspend', 'suspend', 'Organization'),
    rule('organization.rotateKey', 'rotateKey', 'Organization'),
    rule('member.read', 'read', 'Member'),
    rule('apiKey.read', 'read', 'ApiKey'),
    rule('fieldStation.read', 'read', 'FieldStation'),
    rule('fieldStation.revoke', 'revoke', 'FieldStation'),
    rule('complianceCase.manage', 'manage', 'ComplianceCase'),
    // gateway-sync (api-design 03, 04 and 07)
    rule('fieldEvent.read', 'read', 'FieldEvent'),
  ],
  ORG_MANAGER: [
    rule('contract.read.own', 'read', 'RentalContract', OWN),
    rule('contract.request.own', 'request', 'RentalContract', OWN),
    rule('contract.cancel.own', 'cancel', 'RentalContract', OWN),
    rule('contract.notice.own', 'notice', 'RentalContract', OWN),
    rule('contract.label.own', 'label', 'RentalContract', OWN),
    rule('invoice.read.own', 'read', 'Invoice', OWN),
    rule('payment.read.own', 'read', 'Payment', OWN),
    rule('payment.payOnline.own', 'payOnline', 'Invoice', OWN),
    rule('plan.quote.org', 'quote', 'Plan'),
    // organizations (api-design 01 to 32)
    rule('organization.read.own', 'read', 'Organization', { id: '${user.organizationId}' }),
    rule('organization.update.own', 'update', 'Organization', { id: '${user.organizationId}' }),
    rule('organization.history.read.own', 'readHistory', 'Organization', {
      id: '${user.organizationId}',
    }),
    rule('member.read.own', 'read', 'Member', OWN),
    rule('member.manage.own', 'manage', 'Member', OWN),
    rule('apiKey.manage.own', 'manage', 'ApiKey', OWN),
    rule('fieldStation.read.own', 'read', 'FieldStation', OWN),
    rule('fieldStation.manage.own', 'manage', 'FieldStation', OWN),
    rule('roster.read.own', 'read', 'RosterShift', OWN),
    rule('roster.manage.own', 'manage', 'RosterShift', OWN),
  ],
  ORG_OPERATOR: [
    rule('contract.read.own', 'read', 'RentalContract', OWN),
    rule('contract.label.own', 'label', 'RentalContract', OWN),
    // organizations (api-design 01 to 32)
    rule('organization.read.own', 'read', 'Organization', { id: '${user.organizationId}' }),
    rule('member.read.own', 'read', 'Member', OWN),
    rule('fieldStation.read.own', 'read', 'FieldStation', OWN),
    rule('roster.read.own', 'read', 'RosterShift', OWN),
  ],
};

export type Caller = 'staff-1' | 'admin-1' | 'manager-a' | 'operator-a';

export interface E2eApp {
  app: NestExpressApplication;
  send(
    caller: Caller | null,
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    body?: object,
  ): Promise<request.Response>;
}

// Boots AppModule with Prisma replaced by the account tables above plus `tables`.
export const bootE2e = async (tables: Record<string, unknown>): Promise<E2eApp> => {
  const prisma = {
    ...tables,
    user: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(ACCOUNTS[where.id] ?? null),
    },
    organizationMember: {
      findFirst: ({ where }: { where: { userId: string } }) =>
        Promise.resolve(MEMBERS[where.userId] ?? null),
    },
    rolePermission: {
      findMany: ({ where }: { where: { role: { key: string } } }) =>
        Promise.resolve((PERMISSIONS[where.role.key] ?? []).map((permission) => ({ permission }))),
    },
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  const jwt = moduleRef.get(JwtService, { strict: false });

  return {
    app,
    async send(caller, method, path, body) {
      let call = request(app.getHttpServer())[method](path);
      if (caller) {
        const token = await jwt.signAsync({ sub: caller, roles: [], pv: 0 });
        call = call.set('Authorization', `Bearer ${token}`);
      }
      return body ? call.send(body) : call;
    },
  };
};

export const envelope = (response: request.Response) =>
  response.body as { result: { errorCode?: string } | null; isSuccess: boolean; message: string };
