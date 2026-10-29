import { Incident } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { IncidentsQueryService } from './incidents-query.service';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';

const CALLER: Caller = { id: 'u-1', roles: ['ORG_OPERATOR'], organizationId: 'org-a' };
const ROW = { id: 'inc-1' } as Incident;
const VIEW = { id: 'inc-1', code: 'INC-2026-000001' };

describe('IncidentsController (incidents 6.1, api-design 01 to 07)', () => {
  let incidents: Record<string, jest.Mock>;
  let queries: { list: jest.Mock; detail: jest.Mock; views: jest.Mock };
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
    };
    controller = new IncidentsController(
      incidents as unknown as IncidentsService,
      queries as unknown as IncidentsQueryService,
    );
  });

  it('passes the list and detail reads through with the caller and its ability', async () => {
    const ability = { can: () => true };
    await controller.list({ open: true }, CALLER, ability);
    expect(queries.list).toHaveBeenCalledWith({ open: true }, CALLER, ability);
    await expect(controller.detail('inc-1', CALLER, ability)).resolves.toBe(VIEW);
    expect(queries.detail).toHaveBeenCalledWith('inc-1', CALLER, ability);
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

  it('returns the saved status update as is (api-design 05)', async () => {
    await expect(controller.statusUpdate('inc-1', { note: 'ok' }, CALLER)).resolves.toEqual({
      id: 'su-1',
    });
  });
});
