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
} as unknown as Incident;

describe('IncidentsQueryService (incidents 5.1, api-design 01 and 02)', () => {
  let repository: {
    page: jest.Mock;
    findById: jest.Mock;
    statusUpdates: jest.Mock;
    authorityReports: jest.Mock;
  };
  let organizations: { memberNames: jest.Mock };
  let contracts: { holderLabels: jest.Mock };
  let service: IncidentsQueryService;

  beforeEach(() => {
    repository = {
      page: jest.fn().mockResolvedValue([[ROW], 1]),
      findById: jest.fn().mockResolvedValue(ROW),
      statusUpdates: jest
        .fn()
        .mockResolvedValue([
          { id: 'su-1', note: 'Reached the holder', authorId: 'u-1', createdAt: ROW.lastEventAt },
        ]),
      authorityReports: jest.fn().mockResolvedValue([]),
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
    const page = await service.list({ open: true, pageNumber: 1 }, MEMBER);
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
    const [view] = (await service.list({}, STAFF)).items;
    expect(view).toMatchObject({ owner: null, lastPosition: null, device: { holder: null } });
  });

  it('returns the detail with status updates and their authors (api-design 02)', async () => {
    const detail = await service.detail('inc-1', MEMBER);
    expect(detail.statusUpdates).toEqual([
      {
        id: 'su-1',
        note: 'Reached the holder',
        author: { id: 'u-1', fullName: 'Pham Van D' },
        createdAt: ROW.lastEventAt,
      },
    ]);
    expect(detail.authorityReports).toEqual([]);
  });

  it.each([
    ['a missing incident', null, MEMBER],
    ['another organization', { ...ROW, organizationId: 'org-b' }, MEMBER],
  ])('answers 404 for %s (auth AC-01)', async (_label, row, caller) => {
    repository.findById.mockResolvedValue(row);
    await expect(service.detail('inc-1', caller)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
  });
});
