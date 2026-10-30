import { HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { DomainException, ErrorCode } from '../src/common/errors';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AlertDispatcherJob } from '../src/modules/incidents/alerts/alert-dispatcher.job';
import { AuthorityReportsService } from '../src/modules/incidents/authority-reports.service';

// Incidents api-design 10 through the real HTTP pipeline (incidents 6.2, part): the JWT guard,
// `authorityReport.manage`, DTO validation, the response message and the D-002 envelope. The fixtures
// copy authority-reports.e2e-spec.ts (TK-148). The service is stubbed; its behaviour is covered by
// authority-reports.contract.spec.ts.

const CONTRACT = 'c0ffee00-1234-4abc-9def-001122334455';
const BODY = {
  contractId: CONTRACT,
  agency: 'District 1 police',
  reference: 'PC-Q1-2026-338',
  reportedAt: '2026-11-30T02:00:00Z',
};
const CREATED = {
  id: '0b6c9f2e-4d1a-4c3b-9e8f-7a6b5c4d3e2f',
  incidentId: null,
  contractId: CONTRACT,
  agency: BODY.agency,
  reference: BODY.reference,
  reportedAt: '2026-11-30T02:00:00.000Z',
  caseClosedAt: null,
};

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
  'operator-a': account('operator-a', 'ORGANIZATION', 'ORG_OPERATOR'),
  'manager-a': account('manager-a', 'ORGANIZATION', 'ORG_MANAGER'),
};

const MEMBER_ROWS: Record<string, unknown> = {
  'operator-a': {
    role: 'OPERATOR',
    organization: { id: 'org-a', code: 'ORG-0001', legalName: 'ACME', status: 'ACTIVE' },
  },
  'manager-a': {
    role: 'MANAGER',
    organization: { id: 'org-a', code: 'ORG-0001', legalName: 'ACME', status: 'ACTIVE' },
  },
};

const permission = (key: string, action: string, own: boolean, subject = 'Incident') => ({
  key,
  action,
  subject,
  conditions: own ? { organizationId: '${user.organizationId}' } : null,
  fields: [],
  inverted: false,
  reason: null,
});

// The seeded rows of these roles (20261004120100_seed): only Staff and Admin hold
// `authorityReport.manage`; an Org Manager's extra permission is the alert log.
const TREKLINK = [
  permission('incident.read', 'read', false),
  permission('authorityReport.manage', 'manage', false, 'AuthorityReport'),
];
const OPERATOR_PERMISSIONS = [
  permission('incident.read.own', 'read', true),
  permission('incident.respond.own', 'respond', true),
];
const PERMISSIONS: Record<string, unknown[]> = {
  STAFF: TREKLINK,
  ADMIN: TREKLINK,
  ORG_OPERATOR: OPERATOR_PERMISSIONS,
  ORG_MANAGER: [
    ...OPERATOR_PERMISSIONS,
    permission('alertDelivery.read.own', 'read', true, 'AlertDelivery'),
  ],
};

describe('authority reports API (e2e, incidents api-design 10)', () => {
  let app: NestExpressApplication;
  let jwt: JwtService;
  const reports = { reportContract: jest.fn() };

  const prisma = {
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
        Promise.resolve((PERMISSIONS[where.role.key] ?? []).map((row) => ({ permission: row }))),
    },
  };

  const post = async (userId: string | null, body: object) => {
    const call = request(app.getHttpServer()).post('/api/authority-reports');
    if (userId)
      call.set('Authorization', `Bearer ${await jwt.signAsync({ sub: userId, roles: [], pv: 0 })}`);
    return call.send(body);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(AuthorityReportsService)
      .useValue(reports)
      .overrideProvider(AlertDispatcherJob)
      .useValue({})
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    jwt = moduleRef.get(JwtService, { strict: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    reports.reportContract.mockResolvedValue(CREATED);
  });

  it.each(['staff-1', 'admin-1'])('records the report for %s and answers 201', async (who) => {
    const response = await post(who, BODY);
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      result: CREATED,
      isSuccess: true,
      statusCode: 201,
      message: 'Report recorded',
    });
    expect(reports.reportContract).toHaveBeenCalledWith(
      { ...BODY, reportedAt: new Date(BODY.reportedAt) },
      { id: who, roles: [who === 'staff-1' ? 'STAFF' : 'ADMIN'], organizationId: null },
    );
  });

  it('answers 401 without a token', async () => {
    const response = await post(null, BODY);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ result: { errorCode: 'UNAUTHENTICATED' } });
  });

  it.each(['operator-a', 'manager-a'])('answers 403 for %s', async (who) => {
    const response = await post(who, BODY);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ result: { errorCode: 'FORBIDDEN' } });
    expect(reports.reportContract).not.toHaveBeenCalled();
  });

  it.each([
    ['contractId', { ...BODY, contractId: 'not-a-uuid' }],
    ['agency', { ...BODY, agency: '' }],
    ['reference', { ...BODY, reference: undefined }],
    ['reportedAt', { ...BODY, reportedAt: 'soon' }],
  ])('answers 400 for a bad %s', async (_field, body) => {
    const response = await post('staff-1', body);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ result: { errorCode: 'VALIDATION_FAILED' } });
    expect(reports.reportContract).not.toHaveBeenCalled();
  });

  it.each([
    [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Contract not found.'],
    [
      HttpStatus.CONFLICT,
      ErrorCode.CONTRACT_NOT_DEFAULTED,
      'This cannot be done while it is OVERDUE.',
    ],
  ])('passes %s %s through in the envelope', async (status, code, message) => {
    reports.reportContract.mockRejectedValue(new DomainException(status, code, message));
    const response = await post('staff-1', BODY);
    expect(response.status).toBe(status);
    expect(response.body).toEqual({
      result: { errorCode: code },
      isSuccess: false,
      statusCode: status,
      message,
    });
  });
});
