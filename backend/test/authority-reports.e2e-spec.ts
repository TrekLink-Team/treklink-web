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
import { IncidentsQueryService } from '../src/modules/incidents/incidents-query.service';

// Incidents api-design 08, 09 and 11 through the real HTTP pipeline (incidents 6.2, part): the JWT
// guard, `authorityReport.manage` on each route, DTO validation, the response message and the D-002
// envelope. The service is stubbed; its behaviour is covered by authority-reports.service.spec.ts and
// against Postgres by authority-reports.db-spec.ts (AC-04).

const ID = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';
const REPORT = '0b6c9f2e-4d1a-4c3b-9e8f-7a6b5c4d3e2f';
const ROW = { id: ID, state: 'REPORTED' };
const VIEW = { id: ID, code: 'INC-2026-000045', state: 'REPORTED', version: 6 };
const BODY = {
  agency: 'Lam Dong provincial rescue (114)',
  reference: 'LD-114-2026-1020-07',
  reportedAt: '2026-10-20T03:25:00Z',
  note: 'Last position and audit log shared by phone and email.',
  expectedVersion: 5,
};
const LISTED = {
  id: REPORT,
  incidentId: ID,
  contractId: null,
  agency: BODY.agency,
  reference: BODY.reference,
  reportedAt: '2026-10-20T03:25:00.000Z',
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

describe('authority reports API (e2e, incidents api-design 08, 09 and 11)', () => {
  let app: NestExpressApplication;
  let jwt: JwtService;
  const reports = { reportIncident: jest.fn(), closeCase: jest.fn(), list: jest.fn() };
  const queries = { views: jest.fn() };

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

  const token = (userId: string) => jwt.signAsync({ sub: userId, roles: [], pv: 0 });
  const get = async (userId: string, path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${await token(userId)}`);
  const post = async (userId: string, path: string, body: object) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${await token(userId)}`)
      .send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(AuthorityReportsService)
      .useValue(reports)
      .overrideProvider(IncidentsQueryService)
      .useValue(queries)
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
    reports.reportIncident.mockResolvedValue(ROW);
    reports.closeCase.mockResolvedValue({
      id: REPORT,
      caseClosedAt: '2026-10-21T08:00:00.000Z',
      incidentState: 'CLOSED',
    });
    reports.list.mockResolvedValue({
      items: [LISTED],
      pageNumber: 1,
      pageSize: 20,
      totalCount: 1,
      totalPages: 1,
    });
    queries.views.mockResolvedValue([VIEW]);
  });

  const refused = (status: HttpStatus, code: ErrorCode, message: string) =>
    new DomainException(status, code, message);

  describe('POST /api/incidents/:id/authority-reports (08)', () => {
    const path = `/api/incidents/${ID}/authority-reports`;

    it.each(['staff-1', 'admin-1'])(
      'records the report for %s and answers 201 with the incident view',
      async (who) => {
        const response = await post(who, path, BODY);
        expect(response.status).toBe(201);
        expect(response.body).toEqual({
          result: VIEW,
          isSuccess: true,
          statusCode: 201,
          message: 'Report recorded',
        });
        expect(reports.reportIncident).toHaveBeenCalledWith(
          ID,
          { ...BODY, reportedAt: new Date(BODY.reportedAt) },
          {
            id: who,
            roles: [who === 'staff-1' ? 'STAFF' : 'ADMIN'],
            organizationId: null,
          },
        );
        expect(queries.views).toHaveBeenCalledWith([ROW]);
      },
    );

    it.each(['operator-a', 'manager-a'])(
      'refuses the organization member %s with 403',
      async (who) => {
        const response = await post(who, path, BODY);
        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({
          result: { errorCode: 'FORBIDDEN' },
          isSuccess: false,
        });
        expect(reports.reportIncident).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['no agency', { agency: undefined }],
      ['an empty reference', { reference: '' }],
      ['a reportedAt that is not a date', { reportedAt: 'yesterday' }],
      ['no expectedVersion', { expectedVersion: undefined }],
      ['a negative expectedVersion', { expectedVersion: -1 }],
      ['an agency over 200 characters', { agency: 'a'.repeat(201) }],
      ['a note over 2000 characters', { note: 'n'.repeat(2001) }],
    ])('refuses %s with 400 VALIDATION_FAILED', async (_label, patch) => {
      const response = await post('staff-1', path, { ...BODY, ...patch });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ result: { errorCode: 'VALIDATION_FAILED' } });
      expect(reports.reportIncident).not.toHaveBeenCalled();
    });

    it('refuses an id that is not a UUID with 400', async () => {
      const response = await post('staff-1', '/api/incidents/INC-1/authority-reports', BODY);
      expect(response.status).toBe(400);
      expect(reports.reportIncident).not.toHaveBeenCalled();
    });

    it.each([
      [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Incident not found.'],
      [
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
        'This cannot be done while it is ACKNOWLEDGED.',
      ],
      [
        HttpStatus.CONFLICT,
        ErrorCode.STALE_VERSION,
        'This was changed by someone else. Reload and try again.',
      ],
    ])('answers %s %s from the service in the envelope', async (status, code, message) => {
      reports.reportIncident.mockRejectedValue(refused(status, code, message));
      const response = await post('staff-1', path, BODY);
      expect(response.status).toBe(status);
      expect(response.body).toEqual({
        result: { errorCode: code },
        isSuccess: false,
        statusCode: status,
        message,
      });
    });

    it('answers 401 without a token', async () => {
      await request(app.getHttpServer()).post(path).send(BODY).expect(401);
    });
  });

  describe('POST /api/authority-reports/:reportId/close-case (09)', () => {
    const path = `/api/authority-reports/${REPORT}/close-case`;
    const CLOSE = {
      closedAt: '2026-10-21T08:00:00Z',
      note: 'Holder found safe by the rescue team.',
    };

    it('closes the case and answers 200', async () => {
      const response = await post('staff-1', path, CLOSE);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        result: { id: REPORT, caseClosedAt: '2026-10-21T08:00:00.000Z', incidentState: 'CLOSED' },
        isSuccess: true,
        statusCode: 200,
        message: 'Case closed',
      });
      expect(reports.closeCase).toHaveBeenCalledWith(
        REPORT,
        { ...CLOSE, closedAt: new Date(CLOSE.closedAt) },
        { id: 'staff-1', roles: ['STAFF'], organizationId: null },
      );
    });

    it.each(['operator-a', 'manager-a'])('refuses %s with 403', async (who) => {
      expect((await post(who, path, CLOSE)).status).toBe(403);
      expect(reports.closeCase).not.toHaveBeenCalled();
    });

    it.each([
      ['no closedAt', { note: 'x' }, path],
      ['a closedAt that is not a date', { closedAt: 'soon' }, path],
      ['a report id that is not a UUID', CLOSE, '/api/authority-reports/ar-1/close-case'],
    ])('refuses %s with 400', async (_label, body, url) => {
      const response = await post('staff-1', url, body);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ result: { errorCode: 'VALIDATION_FAILED' } });
      expect(reports.closeCase).not.toHaveBeenCalled();
    });

    it.each([
      [HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Authority report not found.'],
      [
        HttpStatus.CONFLICT,
        ErrorCode.CASE_ALREADY_CLOSED,
        'This cannot be done while it is CLOSED.',
      ],
    ])('answers %s %s from the service in the envelope', async (status, code, message) => {
      reports.closeCase.mockRejectedValue(refused(status, code, message));
      const response = await post('admin-1', path, CLOSE);
      expect(response.body).toEqual({
        result: { errorCode: code },
        isSuccess: false,
        statusCode: status,
        message,
      });
    });

    it('answers 401 without a token', async () => {
      await request(app.getHttpServer()).post(path).send(CLOSE).expect(401);
    });
  });

  describe('GET /api/authority-reports (11)', () => {
    it('lists for Staff with the open flag and paging converted', async () => {
      const response = await get(
        'staff-1',
        '/api/authority-reports?open=true&pageNumber=2&pageSize=5',
      );
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        result: { items: [LISTED], totalCount: 1 },
        isSuccess: true,
        statusCode: 200,
        message: 'OK',
      });
      expect(reports.list).toHaveBeenCalledWith({ open: true, pageNumber: 2, pageSize: 5 });
    });

    it('lets an Admin list without filters', async () => {
      expect((await get('admin-1', '/api/authority-reports')).status).toBe(200);
      expect(reports.list).toHaveBeenCalledWith({});
    });

    it.each(['operator-a', 'manager-a'])('refuses %s with 403', async (who) => {
      expect((await get(who, '/api/authority-reports')).status).toBe(403);
      expect(reports.list).not.toHaveBeenCalled();
    });

    it.each([
      ['an open flag that is not a boolean', 'open=yes'],
      ['a page size of zero', 'pageSize=0'],
    ])('refuses %s with 400', async (_label, query) => {
      const response = await get('staff-1', `/api/authority-reports?${query}`);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ result: { errorCode: 'VALIDATION_FAILED' } });
      expect(reports.list).not.toHaveBeenCalled();
    });

    it('answers 401 without a token', async () => {
      await request(app.getHttpServer()).get('/api/authority-reports').expect(401);
    });
  });
});
