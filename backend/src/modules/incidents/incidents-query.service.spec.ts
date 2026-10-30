import { createMongoAbility } from '@casl/ability';
import { ConfigService } from '@nestjs/config';
import { Incident } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { DevicesService } from '../devices';
import { OrganizationsService } from '../organizations';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { ContractsService } from '../rentals';
import { IncidentsQueryService } from './incidents-query.service';
import { IncidentsRepository } from './incidents.repository';

const MEMBER: Caller = { id: 'u-1', roles: ['ORG_OPERATOR'], organizationId: 'org-a' };
const STAFF: Caller = { id: 's-1', roles: ['STAFF'], organizationId: null };

// The seeded rules as the ability factory binds them: `incident.read` for TrekLink roles,
// `incident.read.own` with `${user.organizationId}` filled from the caller for members.
const readAll = createMongoAbility([{ action: 'read', subject: 'Incident' }]);
const readOwn = (caller: Caller) =>
  createMongoAbility([
    { action: 'read', subject: 'Incident', conditions: { organizationId: caller.organizationId } },
  ]);

// The alert log rules: `alertDelivery.read` for TrekLink roles, `alertDelivery.read.own` for an
// Org Manager only.
const alertsAll = createMongoAbility([{ action: 'read', subject: 'AlertDelivery' }]);
const alertsOwn = (caller: Caller) =>
  createMongoAbility([
    { action: 'read', subject: 'Incident', conditions: { organizationId: caller.organizationId } },
    {
      action: 'read',
      subject: 'AlertDelivery',
      conditions: { organizationId: caller.organizationId },
    },
  ]);
const MANAGER: Caller = { id: 'm-1', roles: ['ORG_MANAGER'], organizationId: 'org-a' };

const ROW = {
  id: 'inc-1',
  code: 'INC-2026-000001',
  deviceId: 'dev-1',
  contractId: 'c-1',
  organizationId: 'org-a',
  state: 'ACKNOWLEDGED',
  stateChangedAt: new Date('2026-10-29T03:16:00Z'),
  source: 'DEVICE_SOS',
  confidence: 'CONFIRMED',
  firstEventAt: new Date('2026-10-29T03:15:00Z'),
  lastEventAt: new Date('2026-10-29T03:15:30Z'),
  eventCount: 2,
  lastLatitude: 21.03,
  lastLongitude: 105.85,
  stale: false,
  ownerId: 'u-1',
  tierDeadlineAt: null,
  statusDueAt: new Date('2026-10-29T03:46:00Z'),
  reopenCount: 0,
  version: 2,
  outcomeNote: null,
} as unknown as Incident;

describe('IncidentsQueryService (incidents 5.1, api-design 01 and 02)', () => {
  let repository: {
    page: jest.Mock;
    findById: jest.Mock;
    statusUpdates: jest.Mock;
    authorityReports: jest.Mock;
    transitions: jest.Mock;
    alertDeliveries: jest.Mock;
  };
  let organizations: { memberNames: jest.Mock };
  let contracts: { holderLabels: jest.Mock };
  let service: IncidentsQueryService;

  beforeEach(() => {
    repository = {
      page: jest.fn().mockResolvedValue([[ROW], 1]),
      findById: jest.fn().mockResolvedValue(ROW),
      statusUpdates: jest.fn().mockResolvedValue([
        {
          id: 'su-1',
          note: 'Reached the holder',
          authorId: 'u-1',
          createdAt: ROW.lastEventAt,
          correctsId: null,
          correctedBy: null,
        },
      ]),
      authorityReports: jest.fn().mockResolvedValue([]),
      transitions: jest.fn().mockResolvedValue([
        {
          seq: 1,
          fromState: null,
          toState: 'DETECTED',
          actorId: null,
          reason: 'CREATED',
          note: null,
          createdAt: ROW.firstEventAt,
        },
        {
          seq: 2,
          fromState: 'NOTIFY_PRIMARY',
          toState: 'ACKNOWLEDGED',
          actorId: 'u-1',
          reason: 'ACKNOWLEDGED',
          createdAt: ROW.stateChangedAt,
        },
        {
          seq: 3,
          fromState: 'ACKNOWLEDGED',
          toState: 'RESPONDING',
          actorId: 'u-gone',
          reason: 'RESPONDING',
          note: 'Two rangers are walking up the north trail',
          createdAt: ROW.stateChangedAt,
        },
      ]),
      alertDeliveries: jest.fn().mockResolvedValue([
        {
          tier: 'PRIMARY',
          recipientId: 'u-1',
          channel: 'WEBSOCKET',
          status: 'SENT',
          attempts: 1,
          sentAt: ROW.firstEventAt,
          lastError: null,
        },
        {
          tier: 'PRIMARY',
          recipientId: null,
          channel: 'API_EVENT',
          status: 'PENDING',
          attempts: 0,
          sentAt: null,
          lastError: null,
        },
        {
          tier: 'MANAGER',
          recipientId: 'u-gone',
          channel: 'EMAIL',
          status: 'FAILED',
          attempts: 5,
          sentAt: null,
          lastError: 'SMTP 451',
        },
      ]),
    };
    organizations = { memberNames: jest.fn().mockResolvedValue(new Map([['u-1', 'Pham Van D']])) };
    contracts = {
      holderLabels: jest
        .fn()
        .mockResolvedValue(new Map([['c-1:dev-1', { name: 'Le Thi E', phone: '0912' }]])),
    };
    const config = { get: (key: string) => (key === 'MAX_PAGE_SIZE' ? 100 : 20) };
    service = new IncidentsQueryService(
      repository as unknown as IncidentsRepository,
      {
        assetTags: jest.fn().mockResolvedValue(new Map([['dev-1', 'TL-0042']])),
      } as unknown as DevicesService,
      contracts as unknown as ContractsService,
      organizations as unknown as OrganizationsService,
      config as unknown as ConfigService<ValidatedEnvironment, true>,
    );
  });

  it('scopes a member to the own organization and maps the api-design 01 row', async () => {
    const page = await service.list({ open: true, pageNumber: 1 }, MEMBER, readOwn(MEMBER));
    expect(repository.page).toHaveBeenCalledWith(
      { organizationId: 'org-a', state: { not: 'CLOSED' } },
      0,
      20,
    );
    expect(page).toMatchObject({ pageNumber: 1, pageSize: 20, totalCount: 1, totalPages: 1 });
    expect(page.items[0]).toMatchObject({
      code: 'INC-2026-000001',
      device: { id: 'dev-1', assetTag: 'TL-0042', holder: { name: 'Le Thi E', phone: '0912' } },
      lastPosition: { lat: 21.03, lon: 105.85 },
      owner: { id: 'u-1', fullName: 'Pham Van D' },
      version: 2,
    });
  });

  it('lets Staff read every organization with the state, device and from filters', async () => {
    const from = new Date('2026-10-01T00:00:00Z');
    await service.list(
      { state: ['UNROUTED', 'ESCALATED'], deviceId: 'dev-1', from, pageNumber: 2, pageSize: 5 },
      STAFF,
      readAll,
    );
    expect(repository.page).toHaveBeenCalledWith(
      {
        state: { in: ['UNROUTED', 'ESCALATED'] },
        deviceId: 'dev-1',
        createdAt: { gte: from },
      },
      5,
      5,
    );
  });

  it('answers nulls for an unrouted row without owner, position or label', async () => {
    repository.page.mockResolvedValue([
      [{ ...ROW, contractId: null, ownerId: null, lastLatitude: null, lastLongitude: null }],
      1,
    ]);
    const [view] = (await service.list({}, STAFF, readAll)).items;
    expect(view).toMatchObject({ owner: null, lastPosition: null, device: { holder: null } });
  });

  it('returns the detail with status updates and their authors (api-design 02)', async () => {
    const detail = await service.detail('inc-1', MEMBER, readOwn(MEMBER));
    expect(detail.statusUpdates).toEqual([
      {
        id: 'su-1',
        note: 'Reached the holder',
        author: { id: 'u-1', fullName: 'Pham Van D' },
        createdAt: ROW.lastEventAt,
        correctsId: null,
        correctedById: null,
      },
    ]);
    expect(detail.authorityReports).toEqual([]);
    expect(detail.outcomeNote).toBeNull();
  });

  it('returns the outcome the Operator reported once the incident is resolved (api-design 02)', async () => {
    repository.findById.mockResolvedValue({
      ...ROW,
      state: 'RESOLVED',
      outcomeNote: 'Holder walked down with the rangers',
    });
    const detail = await service.detail('inc-1', MEMBER, readOwn(MEMBER));
    expect(detail.outcomeNote).toBe('Holder walked down with the rangers');
  });

  it('links a correction and the update it corrects both ways (dry run defect 15)', async () => {
    repository.statusUpdates.mockResolvedValue([
      {
        id: 'su-2',
        note: 'At the second ridge',
        authorId: 'u-1',
        createdAt: ROW.lastEventAt,
        correctsId: 'su-1',
        correctedBy: null,
      },
      {
        id: 'su-1',
        note: 'At the ridge',
        authorId: 'u-1',
        createdAt: ROW.firstEventAt,
        correctsId: null,
        correctedBy: { id: 'su-2' },
      },
    ]);
    const detail = await service.detail('inc-1', MEMBER, readOwn(MEMBER));
    expect(
      detail.statusUpdates.map(({ id, correctsId, correctedById }) => ({
        id,
        correctsId,
        correctedById,
      })),
    ).toEqual([
      { id: 'su-2', correctsId: 'su-1', correctedById: null },
      { id: 'su-1', correctsId: null, correctedById: 'su-2' },
    ]);
  });

  it.each([
    ['a missing incident', null, MEMBER],
    ['another organization', { ...ROW, organizationId: 'org-b' }, MEMBER],
  ])('answers 404 for %s (auth AC-01)', async (_label, row, caller) => {
    repository.findById.mockResolvedValue(row);
    await expect(service.detail('inc-1', caller, readOwn(caller))).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
  });

  it('lets an unconditioned read rule (Staff, Admin) read any organization', async () => {
    const admin: Caller = { id: 'a-1', roles: ['ADMIN'], organizationId: null };
    await expect(service.detail('inc-1', admin, readAll)).resolves.toMatchObject({ id: 'inc-1' });
  });

  it('returns the trail in order with SYSTEM, the actor name, or the id of an unknown actor (api-design 12)', async () => {
    const trail = await service.transitions('inc-1', MEMBER, readOwn(MEMBER));
    expect(repository.transitions).toHaveBeenCalledWith('inc-1');
    expect(organizations.memberNames).toHaveBeenCalledWith(['u-1', 'u-gone']);
    expect(trail).toEqual([
      {
        seq: 1,
        fromState: null,
        toState: 'DETECTED',
        actor: 'SYSTEM',
        reason: 'CREATED',
        note: null,
        createdAt: ROW.firstEventAt,
      },
      expect.objectContaining({ seq: 2, actor: 'Pham Van D', note: null }),
      expect.objectContaining({
        seq: 3,
        actor: 'u-gone',
        note: 'Two rangers are walking up the north trail',
      }),
    ]);
  });

  it('returns the alert log to an Org Manager with names and a null API-event recipient (api-design 14)', async () => {
    const log = await service.alerts('inc-1', MANAGER, alertsOwn(MANAGER));
    expect(repository.alertDeliveries).toHaveBeenCalledWith('inc-1');
    expect(organizations.memberNames).toHaveBeenCalledWith(['u-1', 'u-gone']);
    expect(log).toEqual([
      {
        tier: 'PRIMARY',
        recipient: 'Pham Van D',
        channel: 'WEBSOCKET',
        status: 'SENT',
        attempts: 1,
        sentAt: ROW.firstEventAt,
        lastError: null,
      },
      expect.objectContaining({ channel: 'API_EVENT', recipient: null }),
      expect.objectContaining({ recipient: 'u-gone', status: 'FAILED', lastError: 'SMTP 451' }),
    ]);
  });

  it('lets Staff read the alert log of any organization', async () => {
    repository.findById.mockResolvedValue({ ...ROW, organizationId: 'org-b' });
    await expect(service.alerts('inc-1', STAFF, alertsAll)).resolves.toHaveLength(3);
  });

  it('refuses the alert log to an Org Operator before reading any row (api-design 14)', async () => {
    await expect(service.alerts('inc-1', MEMBER, readOwn(MEMBER))).rejects.toMatchObject({
      errorCode: ErrorCode.FORBIDDEN,
    });
    expect(repository.findById).not.toHaveBeenCalled();
    expect(repository.alertDeliveries).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing incident', null],
    ['another organization', { ...ROW, organizationId: 'org-b' }],
  ])('answers 404 on the trail and the alert log for %s', async (_label, row) => {
    repository.findById.mockResolvedValue(row);
    await expect(service.transitions('inc-1', MEMBER, readOwn(MEMBER))).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
    await expect(service.alerts('inc-1', MANAGER, alertsOwn(MANAGER))).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
    expect(repository.transitions).not.toHaveBeenCalled();
    expect(repository.alertDeliveries).not.toHaveBeenCalled();
  });

  it.each([
    ['an own rule and no organization', { ...MEMBER, organizationId: null }],
    ['an organization and no read rule', MEMBER],
  ])(
    'refuses an account with %s before reading any row (PR #114 review)',
    async (label, caller) => {
      const ability = label.endsWith('no read rule') ? createMongoAbility([]) : readOwn(caller);
      await expect(service.list({}, caller, ability)).rejects.toMatchObject({
        errorCode: ErrorCode.FORBIDDEN,
      });
      await expect(service.detail('inc-1', caller, ability)).rejects.toMatchObject({
        errorCode: ErrorCode.FORBIDDEN,
      });
      expect(repository.page).not.toHaveBeenCalled();
      expect(repository.findById).not.toHaveBeenCalled();
    },
  );
});
