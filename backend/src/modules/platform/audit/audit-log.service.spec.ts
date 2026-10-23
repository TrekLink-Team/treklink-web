import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ValidatedEnvironment } from '../config/environment-variables';
import { AuditLogQueryDto } from './audit-log-query.dto';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';

const config = {
  get: (key: string) => ({ DEFAULT_PAGE_SIZE: 20, MAX_PAGE_SIZE: 100 })[key],
} as unknown as ConfigService<ValidatedEnvironment, true>;
const ACTOR = '3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f';
const ORG = '5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f';

describe('AuditLogService', () => {
  let repository: {
    page: jest.Mock<Promise<[unknown[], number]>, [Record<string, unknown>, number, number]>;
  };
  let service: AuditLogService;
  const whereOf = () => repository.page.mock.calls[0][0];

  beforeEach(() => {
    repository = {
      page: jest
        .fn<Promise<[unknown[], number]>, [Record<string, unknown>, number, number]>()
        .mockResolvedValue([[], 0]),
    };
    service = new AuditLogService(repository as unknown as AuditLogRepository, config, {
      namesOf: () => Promise.resolve(new Map([[ACTOR, 'Staff A']])),
    });
  });

  it('applies each filter: actor, organization, subject, action prefix, half-open time range', async () => {
    await service.search({
      actorId: ACTOR,
      organizationId: ORG,
      subjectType: 'RentalContract',
      subjectId: 'c0ffee00',
      action: 'contract.',
      from: '2026-10-01T00:00:00Z',
      to: '2026-10-21T00:00:00Z',
    });
    expect(whereOf()).toEqual({
      actorId: ACTOR,
      organizationId: ORG,
      subjectType: 'RentalContract',
      subjectId: 'c0ffee00',
      action: { startsWith: 'contract.' },
      createdAt: { gte: new Date('2026-10-01T00:00:00Z'), lt: new Date('2026-10-21T00:00:00Z') },
    });
  });

  it('accepts an open-ended range and no filter at all', async () => {
    await service.search({ from: '2026-10-01T00:00:00Z' });
    expect(whereOf()).toEqual({ createdAt: { gte: new Date('2026-10-01T00:00:00Z') } });
    repository.page.mockClear();
    await service.search({});
    expect(whereOf()).toEqual({});
  });

  it('refuses from at or after to with 400', async () => {
    await expect(
      service.search({ from: '2026-10-21T00:00:00Z', to: '2026-10-21T00:00:00Z' }),
    ).rejects.toThrow('from must be earlier than to.');
    expect(repository.page).not.toHaveBeenCalled();
  });

  it('pages, and resolves the actor, null for a SYSTEM row', async () => {
    const row = { id: 'a1', actorRoles: [], action: 'x', subjectType: 'Y', createdAt: new Date() };
    repository.page.mockResolvedValue([
      [
        { ...row, actorId: ACTOR },
        { ...row, id: 'a2', actorId: null },
      ],
      45,
    ]);
    const result = await service.search({ pageNumber: 3, pageSize: 20 });
    expect(repository.page).toHaveBeenCalledWith({}, 40, 20);
    expect(result).toMatchObject({ pageNumber: 3, totalCount: 45, totalPages: 3 });
    expect(result.items.map((item) => item.actor)).toEqual([
      { id: ACTOR, fullName: 'Staff A' },
      null,
    ]);
    expect(result.items[0]).not.toHaveProperty('actorId');
  });
});

describe('AuditLogQueryDto', () => {
  const problems = (query: Record<string, unknown>) =>
    validateSync(plainToInstance(AuditLogQueryDto, query)).map((error) => error.property);

  it('accepts the documented filters and refuses a malformed id or time', () => {
    expect(problems({ actorId: ACTOR, from: '2026-10-01T00:00:00Z', action: 'contract.' })).toEqual(
      [],
    );
    expect(new Set(problems({ actorId: 'not-a-uuid', to: 'yesterday', pageNumber: '0' }))).toEqual(
      new Set(['pageNumber', 'actorId', 'to']),
    );
  });
});
