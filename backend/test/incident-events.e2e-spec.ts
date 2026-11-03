import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { JobRunnerService } from '../src/modules/platform/scheduler/job-runner.service';

const ID = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';
const EVIDENCE = [
  { eventId: 'event-1', kind: 'SOS', observedAt: null, latitude: null, longitude: null },
];
const ROLES: Record<string, string> = {
  staff: 'STAFF',
  admin: 'ADMIN',
  operator: 'ORG_OPERATOR',
  manager: 'ORG_MANAGER',
  other: 'ORG_OPERATOR',
  denied: 'NONE',
};

describe('API 13 through real policy, query service and global event port', () => {
  let app: NestExpressApplication;
  let jwt: JwtService;
  const incident = { findUnique: jest.fn() };
  const fieldEvent = { findMany: jest.fn() };
  const get = async (user: string, id = ID, query = '') =>
    request(app.getHttpServer())
      .get(`/api/incidents/${id}/events${query}`)
      .set('Authorization', `Bearer ${await jwt.signAsync({ sub: user, roles: [], pv: 0 })}`);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        incident,
        fieldEvent,
        user: {
          findUnique: ({ where }: { where: { id: string } }) =>
            Promise.resolve({
              id: where.id,
              email: `${where.id}@example.invalid`,
              fullName: where.id,
              accountType: ['staff', 'admin', 'denied'].includes(where.id)
                ? 'TREKLINK'
                : 'ORGANIZATION',
              isActive: true,
              deletedAt: null,
              lockedUntil: null,
              passwordHash: 'hash',
              roles: [{ role: { key: ROLES[where.id] } }],
            }),
        },
        organizationMember: {
          findFirst: ({ where }: { where: { userId: string } }) =>
            Promise.resolve({
              role: where.userId === 'manager' ? 'MANAGER' : 'OPERATOR',
              organization: {
                id: where.userId === 'other' ? 'org-b' : 'org-a',
                code: 'ORG',
                legalName: 'Test',
                status: 'ACTIVE',
              },
            }),
        },
        organizationRolePolicy: { findFirst: () => Promise.resolve(null) },
        rolePermission: {
          findMany: ({ where }: { where: { role: { key: string } } }) =>
            Promise.resolve(
              where.role.key === 'NONE'
                ? []
                : [
                    {
                      permission: {
                        key: 'incident.read',
                        action: 'read',
                        subject: 'Incident',
                        fields: [],
                        inverted: false,
                        reason: null,
                        conditions: where.role.key.startsWith('ORG_')
                          ? { organizationId: '${user.organizationId}' }
                          : null,
                      },
                    },
                  ],
            ),
        },
      })
      .overrideProvider(JobRunnerService)
      .useValue({ onApplicationBootstrap() {} })
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    jwt = module.get(JwtService);
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    jest.clearAllMocks();
    incident.findUnique.mockResolvedValue({ id: ID, organizationId: 'org-a' });
    fieldEvent.findMany.mockResolvedValue(EVIDENCE);
  });
  it.each(['operator', 'manager', 'staff', 'admin'])(
    'returns the array envelope for %s',
    async (role) => {
      const response = await get(role);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        result: EVIDENCE,
        isSuccess: true,
        statusCode: 200,
        message: 'OK',
      });
      expect(fieldEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where:
            role.startsWith('operator') || role === 'manager'
              ? { incidentId: ID, organizationId: 'org-a', attribution: 'ATTRIBUTED' }
              : { incidentId: ID },
        }),
      );
    },
  );
  it('answers 401 without a JWT', async () => {
    expect((await request(app.getHttpServer()).get(`/api/incidents/${ID}/events`)).status).toBe(
      401,
    );
    expect(fieldEvent.findMany).not.toHaveBeenCalled();
  });
  it('answers 403 without policy permission', async () => {
    expect((await get('denied')).status).toBe(403);
    expect(fieldEvent.findMany).not.toHaveBeenCalled();
  });
  it('hides another organization incident as 404', async () => {
    expect((await get('other')).status).toBe(404);
    expect(fieldEvent.findMany).not.toHaveBeenCalled();
  });
  it('answers 404 for an absent incident', async () => {
    incident.findUnique.mockResolvedValue(null);
    expect((await get('staff')).status).toBe(404);
    expect(fieldEvent.findMany).not.toHaveBeenCalled();
  });
  it('validates the UUID before querying', async () => {
    expect((await get('staff', 'invalid')).status).toBe(400);
    expect(fieldEvent.findMany).not.toHaveBeenCalled();
  });
  it('returns an empty array without pagination or a caller-selected window', async () => {
    fieldEvent.findMany.mockResolvedValue([]);
    const response = await get('operator', ID, '?pageSize=1&from=2099-01-01');
    expect(response.status).toBe(200);
    expect(response.body as unknown).toMatchObject({ result: [] });
    expect(fieldEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { incidentId: ID, organizationId: 'org-a', attribution: 'ATTRIBUTED' },
      }),
    );
  });
});
