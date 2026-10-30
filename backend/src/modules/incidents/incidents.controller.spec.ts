import { createMongoAbility } from '@casl/ability';
import { Reflector } from '@nestjs/core';
import { Incident } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import {
  Caller,
  CHECK_POLICIES_KEY,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { AuthorityReportsService } from './authority-reports.service';
import { IncidentsQueryService } from './incidents-query.service';
import {
  AcknowledgeDto,
  AuthorityReportDto,
  IncidentListQueryDto,
  IncidentsController,
} from './incidents.controller';
import { IncidentsService } from './incidents.service';

const CALLER: Caller = { id: 'u-1', roles: ['ORG_OPERATOR'], organizationId: 'org-a' };
const ROW = { id: 'inc-1' } as Incident;
const VIEW = { id: 'inc-1', code: 'INC-2026-000001' };

describe('IncidentsController (incidents 6.1, api-design 01 to 08)', () => {
  let incidents: Record<string, jest.Mock>;
  let queries: Record<'list' | 'detail' | 'views' | 'transitions' | 'alerts', jest.Mock>;
  let authority: { reportIncident: jest.Mock };
  let controller: IncidentsController;

  beforeEach(() => {
    incidents = {
      acknowledge: jest.fn().mockResolvedValue(ROW),
      responding: jest.fn().mockResolvedValue(ROW),
      addStatus: jest.fn().mockResolvedValue({ id: 'su-1' }),
      resolve: jest.fn().mockResolvedValue(ROW),
      falseAlarm: jest.fn().mockResolvedValue(ROW),
    };
    queries = {
      list: jest.fn().mockResolvedValue({ items: [] }),
      detail: jest.fn().mockResolvedValue(VIEW),
      views: jest.fn().mockResolvedValue([VIEW]),
      transitions: jest.fn().mockResolvedValue([{ seq: 1 }]),
      alerts: jest.fn().mockResolvedValue([{ tier: 'PRIMARY' }]),
    };
    authority = { reportIncident: jest.fn().mockResolvedValue(ROW) };
    controller = new IncidentsController(
      incidents as unknown as IncidentsService,
      queries as unknown as IncidentsQueryService,
      authority as unknown as AuthorityReportsService,
    );
  });

  it('passes the list and detail reads through with the caller and its ability', async () => {
    const ability = { can: () => true };
    await controller.list({ open: true }, CALLER, ability);
    expect(queries.list).toHaveBeenCalledWith({ open: true }, CALLER, ability);
    await expect(controller.detail('inc-1', CALLER, ability)).resolves.toBe(VIEW);
    expect(queries.detail).toHaveBeenCalledWith('inc-1', CALLER, ability);
  });

  it('passes the trail and alert log reads through (api-design 12 and 14)', async () => {
    const ability = { can: () => true };
    await expect(controller.transitions('inc-1', CALLER, ability)).resolves.toEqual([{ seq: 1 }]);
    expect(queries.transitions).toHaveBeenCalledWith('inc-1', CALLER, ability);
    await expect(controller.alerts('inc-1', CALLER, ability)).resolves.toEqual([
      { tier: 'PRIMARY' },
    ]);
    expect(queries.alerts).toHaveBeenCalledWith('inc-1', CALLER, ability);
  });

  it.each([
    ['acknowledge', { expectedVersion: 1 }],
    ['responding', { expectedVersion: 1, note: 'team out' }],
    ['resolve', { expectedVersion: 2, outcomeNote: 'walked out' }],
    ['falseAlarm', { expectedVersion: 1, reason: 'pressed by mistake' }],
  ] as const)('%s returns the incident view of the updated row', async (method, body) => {
    const action = controller[method].bind(controller) as (
      id: string,
      dto: typeof body,
      caller: Caller,
    ) => Promise<unknown>;
    await expect(action('inc-1', body, CALLER)).resolves.toBe(VIEW);
    expect(incidents[method]).toHaveBeenCalledWith('inc-1', body, CALLER);
    expect(queries.views).toHaveBeenCalledWith([ROW]);
  });

  it.each([
    ['list', 'read', 'Incident'],
    ['detail', 'read', 'Incident'],
    ['transitions', 'read', 'Incident'],
    ['alerts', 'read', 'AlertDelivery'],
    ['acknowledge', 'respond', 'Incident'],
    ['responding', 'respond', 'Incident'],
    ['statusUpdate', 'respond', 'Incident'],
    ['resolve', 'respond', 'Incident'],
    ['falseAlarm', 'respond', 'Incident'],
    ['reportToAuthority', 'manage', 'AuthorityReport'],
  ] as const)('%s needs %s %s', (method, action, subject) => {
    // The route handler as Nest reads its metadata, taken without binding it.
    const handler = Object.getOwnPropertyDescriptor(IncidentsController.prototype, method)
      ?.value as (...args: never[]) => unknown;
    const [policy] = new Reflector().get<PolicyHandler[]>(CHECK_POLICIES_KEY, handler);
    expect(policy(createMongoAbility([{ action, subject }]))).toBe(true);
    expect(policy(createMongoAbility([{ action: 'read', subject: 'Device' }]))).toBe(false);
  });

  it('splits the state list and reads the open flag of the list query (api-design 01)', () => {
    expect(
      plainToInstance(IncidentListQueryDto, { state: 'UNROUTED,ESCALATED', open: 'true' }),
    ).toMatchObject({ state: ['UNROUTED', 'ESCALATED'], open: true });
    expect(
      plainToInstance(IncidentListQueryDto, { open: 'false', from: '2026-10-01T00:00:00Z' }),
    ).toMatchObject({ open: false, from: new Date('2026-10-01T00:00:00Z') });
    expect(plainToInstance(AcknowledgeDto, { expectedVersion: '3' })).toMatchObject({
      expectedVersion: 3,
    });
    expect(
      plainToInstance(IncidentListQueryDto, { state: ['ESCALATED'], open: 'yes' }),
    ).toMatchObject({ state: ['ESCALATED'], open: 'yes' });
  });

  it('records an authority report and returns the incident view (api-design 08)', async () => {
    const body = {
      agency: 'Lam Dong provincial rescue (114)',
      reference: 'LD-114',
      reportedAt: new Date('2026-10-20T03:25:00Z'),
      expectedVersion: 5,
    };
    await expect(controller.reportToAuthority('inc-1', body, CALLER)).resolves.toBe(VIEW);
    expect(authority.reportIncident).toHaveBeenCalledWith('inc-1', body, CALLER);
    expect(queries.views).toHaveBeenCalledWith([ROW]);
    expect(
      plainToInstance(AuthorityReportDto, {
        reportedAt: '2026-10-20T03:25:00Z',
        expectedVersion: '5',
      }),
    ).toMatchObject({ reportedAt: new Date('2026-10-20T03:25:00Z'), expectedVersion: 5 });
  });

  it('returns the saved status update as is (api-design 05)', async () => {
    await expect(controller.statusUpdate('inc-1', { note: 'ok' }, CALLER)).resolves.toEqual({
      id: 'su-1',
    });
  });
});
