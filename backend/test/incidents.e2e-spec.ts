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
import { IncidentsQueryService } from '../src/modules/incidents/incidents-query.service';
import { IncidentsService } from '../src/modules/incidents/incidents.service';

// Incidents api-design 01 to 07, 12 and 14 through the real HTTP pipeline (incidents 6.2, part): the JWT guard,
// the CASL policy of each route, DTO validation, the response message and the D-002 envelope. The
// services are stubbed; their behaviour is covered by the unit suites and by mf03.db-spec.ts.

const ID = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';
const DEVICE = '0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10';
const ROW = { id: ID, state: 'ACKNOWLEDGED' };
const VIEW = { id: ID, code: 'INC-2026-000045', state: 'ACKNOWLEDGED', version: 2 };
const TRAIL = [
  {
    seq: 1,
    fromState: null,
    toState: 'DETECTED',
    actor: 'SYSTEM',
    reason: 'CREATED',
    createdAt: '2026-10-20T03:15:00.000Z',
  },
];
const ALERT_LOG = [
  {
    tier: 'PRIMARY',
    recipient: 'Pham Van D',
    channel: 'WEBSOCKET',
    status: 'SENT',
    attempts: 1,
    sentAt: '2026-10-20T03:15:00.000Z',
    lastError: null,
  },
];

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
  'reader-1': account('reader-1', 'TREKLINK', 'READER'),
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

// The CASL ability the controller passes to the reads (PR #114 review).
const AN_ABILITY: unknown = expect.objectContaining({ can: expect.any(Function) as unknown });

// The seeded permission rows of the migration seed for these roles. An Org Manager holds every Org
// Operator permission plus `alertDelivery.read.own` (FR-AUTH-10, api-design 14).
const OPERATOR_PERMISSIONS = [
  permission('incident.read.own', 'read', true),
  permission('incident.respond.own', 'respond', true),
];
const PERMISSIONS: Record<string, unknown[]> = {
  ADMIN: [
    {
      ...permission('incident.respondUnrouted', 'respondUnrouted', false),
      conditions: { state: 'UNROUTED' },
    },
  ],
  READER: [permission('incident.read', 'read', false)],
  STAFF: [
    {
      ...permission('incident.respondUnrouted', 'respondUnrouted', false),
      conditions: { state: 'UNROUTED' },
    },
    permission('incident.read', 'read', false),
    permission('alertDelivery.read', 'read', false, 'AlertDelivery'),
  ],
  ORG_OPERATOR: OPERATOR_PERMISSIONS,
  ORG_MANAGER: [
    ...OPERATOR_PERMISSIONS,
    permission('alertDelivery.read.own', 'read', true, 'AlertDelivery'),
  ],
};

describe('incidents API (e2e, api-design 01 to 07, 12 and 14)', () => {
  let app: NestExpressApplication;
  let jwt: JwtService;
  const incidents = {
    acknowledge: jest.fn(),
    responding: jest.fn(),
    addStatus: jest.fn(),
    resolve: jest.fn(),
    falseAlarm: jest.fn(),
  };
  const queries = {
    list: jest.fn(),
    detail: jest.fn(),
    views: jest.fn(),
    transitions: jest.fn(),
    alerts: jest.fn(),
  };

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
      .overrideProvider(IncidentsService)
      .useValue(incidents)
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
    queries.list.mockResolvedValue({
      items: [VIEW],
      pageNumber: 1,
      pageSize: 20,
      totalCount: 1,
      totalPages: 1,
    });
    queries.detail.mockResolvedValue({ ...VIEW, statusUpdates: [], authorityReports: [] });
    queries.views.mockResolvedValue([VIEW]);
    queries.transitions.mockResolvedValue(TRAIL);
    queries.alerts.mockResolvedValue(ALERT_LOG);
    for (const action of ['acknowledge', 'responding', 'resolve', 'falseAlarm'] as const)
      incidents[action].mockResolvedValue(ROW);
    incidents.addStatus.mockResolvedValue({ id: 'su-1', note: 'ok' });
  });

  describe('GET /api/incidents (01)', () => {
    it('lists with the documented filters converted, in the paged envelope', async () => {
      const response = await get(
        'operator-a',
        `/api/incidents?state=UNROUTED,ESCALATED&open=true&deviceId=${DEVICE}&from=2026-10-01T00:00:00Z&pageNumber=2&pageSize=5`,
      );
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        result: { items: [VIEW], totalCount: 1 },
        isSuccess: true,
        statusCode: 200,
        message: 'OK',
      });
      expect(queries.list).toHaveBeenCalledWith(
        {
          state: ['UNROUTED', 'ESCALATED'],
          open: true,
          deviceId: DEVICE,
          from: new Date('2026-10-01T00:00:00Z'),
          pageNumber: 2,
          pageSize: 5,
        },
        { id: 'operator-a', roles: ['ORG_OPERATOR'], organizationId: 'org-a' },
        AN_ABILITY,
      );
    });

    it('reads open=false as false and lets TrekLink Staff list', async () => {
      expect((await get('staff-1', '/api/incidents?open=false')).status).toBe(200);
      expect(queries.list).toHaveBeenCalledWith(
        { open: false },
        { id: 'staff-1', roles: ['STAFF'], organizationId: null },
        AN_ABILITY,
      );
    });

    it.each([
      ['an unknown state', 'state=SLEEPING'],
      ['a device id that is not a UUID', 'deviceId=TL-0042'],
      ['an open flag that is not a boolean', 'open=yes'],
      ['a from that is not a date', 'from=yesterday'],
    ])('refuses %s with 400 VALIDATION_FAILED', async (_label, query) => {
      const response = await get('operator-a', `/api/incidents?${query}`);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ result: { errorCode: 'VALIDATION_FAILED' } });
      expect(queries.list).not.toHaveBeenCalled();
    });

    it('answers 401 without a token', async () => {
      await request(app.getHttpServer()).get('/api/incidents').expect(401);
    });
  });

  describe('GET /api/incidents/:id (02)', () => {
    it('returns the detail', async () => {
      const response = await get('operator-a', `/api/incidents/${ID}`);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ result: { id: ID, statusUpdates: [] } });
    });

    it('refuses an id that is not a UUID', async () => {
      await get('operator-a', '/api/incidents/INC-2026-000045').then((r) =>
        expect(r.status).toBe(400),
      );
    });

    it('passes a 404 from the service through the envelope (auth AC-01)', async () => {
      queries.detail.mockRejectedValue(
        new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Incident not found.'),
      );
      const response = await get('operator-a', `/api/incidents/${ID}`);
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        result: { errorCode: 'NOT_FOUND' },
        isSuccess: false,
        message: 'Incident not found.',
      });
    });
  });

  describe.each([
    ['acknowledge', 'acknowledge', { expectedVersion: 1 }, 200, 'Incident acknowledged'],
    ['responding', 'responding', { expectedVersion: 1, note: 'Team out' }, 200, 'Status recorded'],
    [
      'resolve',
      'resolve',
      { expectedVersion: 2, outcomeNote: 'Walked out' },
      200,
      'Incident resolved',
    ],
    [
      'false-alarm',
      'falseAlarm',
      { expectedVersion: 1, reason: 'Pressed by mistake' },
      200,
      'Marked as false alarm',
    ],
  ] as const)('POST /api/incidents/:id/%s', (path, method, body, status, message) => {
    it(`answers ${status} with the incident view and "${message}"`, async () => {
      const response = await post('operator-a', `/api/incidents/${ID}/${path}`, body);
      expect(response.status).toBe(status);
      expect(response.body).toEqual({ result: VIEW, isSuccess: true, statusCode: status, message });
      expect(incidents[method]).toHaveBeenCalledWith(ID, body, {
        id: 'operator-a',
        roles: ['ORG_OPERATOR'],
        organizationId: 'org-a',
      });
      expect(queries.views).toHaveBeenCalledWith([ROW]);
    });

    it('refuses a body without expectedVersion with 400', async () => {
      const { expectedVersion: _omitted, ...rest } = body;
      const response = await post('operator-a', `/api/incidents/${ID}/${path}`, rest);
      expect(response.status).toBe(400);
      expect(incidents[method]).not.toHaveBeenCalled();
    });

    it('limits Staff to the false-alarm permission', async () => {
      const response = await post('staff-1', `/api/incidents/${ID}/${path}`, body);
      if (path === 'false-alarm') {
        expect(response.status).toBe(200);
        expect(incidents.falseAlarm).toHaveBeenCalled();
      } else {
        expect(response.status).toBe(403);
        expect(incidents[method]).not.toHaveBeenCalled();
      }
    });
  });

  it('allows Admin API 07 and refuses a read-only account', async () => {
    const body = { expectedVersion: 1, reason: 'Confirmed safe' };
    expect((await post('admin-1', `/api/incidents/${ID}/false-alarm`, body)).status).toBe(200);
    incidents.falseAlarm.mockClear();
    expect((await post('reader-1', `/api/incidents/${ID}/false-alarm`, body)).status).toBe(403);
    expect(incidents.falseAlarm).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post(`/api/incidents/${ID}/false-alarm`)
      .send(body)
      .expect(401);
  });

  it.each([
    ['responding', { expectedVersion: 1, note: '' }],
    ['resolve', { expectedVersion: 1, outcomeNote: '' }],
    ['false-alarm', { expectedVersion: 1, reason: '' }],
    ['acknowledge', { expectedVersion: -1 }],
  ])('refuses an empty required field on %s with 400', async (path, body) => {
    const response = await post('operator-a', `/api/incidents/${ID}/${path}`, body);
    expect(response.status).toBe(400);
  });

  it('passes MSG27 for a lost acknowledgement through as 409 ALREADY_OWNED', async () => {
    incidents.acknowledge.mockRejectedValue(
      new DomainException(
        HttpStatus.CONFLICT,
        ErrorCode.ALREADY_OWNED,
        'Pham Van D took this incident at 10:15.',
      ),
    );
    const response = await post('operator-a', `/api/incidents/${ID}/acknowledge`, {
      expectedVersion: 1,
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      result: { errorCode: 'ALREADY_OWNED' },
      message: 'Pham Van D took this incident at 10:15.',
    });
  });

  describe('POST /api/incidents/:id/status-updates (05)', () => {
    it('answers 201 "Status recorded" with the saved update', async () => {
      const response = await post('operator-a', `/api/incidents/${ID}/status-updates`, {
        note: 'Reached the holder',
      });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        result: { id: 'su-1' },
        statusCode: 201,
        message: 'Status recorded',
      });
    });

    it('refuses an empty note with 400', async () => {
      const response = await post('operator-a', `/api/incidents/${ID}/status-updates`, {
        note: '',
      });
      expect(response.status).toBe(400);
      expect(incidents.addStatus).not.toHaveBeenCalled();
    });

    it('refuses TrekLink Staff with 403', async () => {
      const response = await post('staff-1', `/api/incidents/${ID}/status-updates`, {
        note: 'x',
      });
      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/incidents/:id/transitions (12)', () => {
    it('returns the trail in the envelope to a member', async () => {
      const response = await get('operator-a', `/api/incidents/${ID}/transitions`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        result: TRAIL,
        isSuccess: true,
        statusCode: 200,
        message: 'OK',
      });
      expect(queries.transitions).toHaveBeenCalledWith(
        ID,
        { id: 'operator-a', roles: ['ORG_OPERATOR'], organizationId: 'org-a' },
        AN_ABILITY,
      );
    });

    it('lets TrekLink Staff read it', async () => {
      expect((await get('staff-1', `/api/incidents/${ID}/transitions`)).status).toBe(200);
    });

    it('answers 404 NOT_FOUND for another organization', async () => {
      queries.transitions.mockRejectedValue(
        new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Incident not found.'),
      );
      const response = await get('operator-a', `/api/incidents/${ID}/transitions`);
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        result: { errorCode: 'NOT_FOUND' },
        message: 'Incident not found.',
      });
    });

    it('refuses an id that is not a UUID with 400', async () => {
      expect((await get('operator-a', '/api/incidents/INC-1/transitions')).status).toBe(400);
      expect(queries.transitions).not.toHaveBeenCalled();
    });

    it('answers 401 without a token', async () => {
      await request(app.getHttpServer()).get(`/api/incidents/${ID}/transitions`).expect(401);
    });
  });

  describe('GET /api/incidents/:id/alerts (14)', () => {
    it('returns the alert log to an Org Manager', async () => {
      const response = await get('manager-a', `/api/incidents/${ID}/alerts`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        result: ALERT_LOG,
        isSuccess: true,
        statusCode: 200,
        message: 'OK',
      });
      expect(queries.alerts).toHaveBeenCalledWith(
        ID,
        { id: 'manager-a', roles: ['ORG_MANAGER'], organizationId: 'org-a' },
        AN_ABILITY,
      );
    });

    it('lets TrekLink Staff read it', async () => {
      expect((await get('staff-1', `/api/incidents/${ID}/alerts`)).status).toBe(200);
    });

    it('refuses an Org Operator with 403 FORBIDDEN before the service runs', async () => {
      const response = await get('operator-a', `/api/incidents/${ID}/alerts`);
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ result: { errorCode: 'FORBIDDEN' } });
      expect(queries.alerts).not.toHaveBeenCalled();
    });

    it('answers 401 without a token', async () => {
      await request(app.getHttpServer()).get(`/api/incidents/${ID}/alerts`).expect(401);
    });
  });
});
