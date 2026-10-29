import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { AccountsRepository } from './accounts.repository';
import { AuthEventsService } from './auth-events.service';
import { AuthEventListQueryDto } from './dto/auth.dto';

const config = {
  get: (key: string) => ({ DEFAULT_PAGE_SIZE: 20, MAX_PAGE_SIZE: 100 })[key],
} as unknown as ConfigService<ValidatedEnvironment, true>;
const USER = '3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f';
const OTHER = '7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d';
const ORG = '5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f';
const AT = new Date('2026-10-20T03:15:00.000Z');

const event = (id: string, userId: string | null) => ({
  id,
  userId,
  email: userId ? 'manager@acme-trek.vn' : 'nobody@acme-trek.vn',
  type: 'LOGIN_FAILED',
  ip: '203.0.113.7',
  createdAt: AT,
});

describe('AuthEventsService', () => {
  let page: jest.Mock;
  let context: { organizationsOf: jest.Mock; memberUserIds: jest.Mock; forUser: jest.Mock };
  let service: AuthEventsService;
  const whereOf = () => (page.mock.calls[0] as unknown[])[0];

  beforeEach(() => {
    page = jest.fn().mockResolvedValue([[], 0]);
    context = {
      forUser: jest.fn(),
      organizationsOf: jest
        .fn()
        .mockResolvedValue(new Map([[USER, { id: ORG, name: 'ACME Trek Co., Ltd.' }]])),
      memberUserIds: jest.fn().mockResolvedValue([USER, OTHER]),
    };
    service = new AuthEventsService(
      { pageAuthEvents: page } as unknown as AccountsRepository,
      config,
      context,
    );
  });

  it('applies the account, type and half-open time filters, newest first from the repository', async () => {
    await service.search({
      userId: USER,
      type: 'LOGIN_FAILED',
      from: '2026-10-01T00:00:00Z',
      to: '2026-10-21T00:00:00Z',
    });

    expect(whereOf()).toEqual({
      userId: USER,
      type: 'LOGIN_FAILED',
      createdAt: { gte: new Date('2026-10-01T00:00:00Z'), lt: new Date('2026-10-21T00:00:00Z') },
    });
    expect(page).toHaveBeenCalledWith(expect.anything(), 0, 20);
  });

  it("filters by organization through its members' accounts, never by an event column", async () => {
    await service.search({ organizationId: ORG });

    expect(context.memberUserIds).toHaveBeenCalledWith(ORG);
    expect(whereOf()).toEqual({ userId: { in: [USER, OTHER] } });
  });

  it('answers an empty page for an unknown organization or an account outside it (D-057 rule 4)', async () => {
    context.memberUserIds.mockResolvedValue([]);
    await expect(service.search({ organizationId: ORG })).resolves.toEqual({
      items: [],
      pageNumber: 1,
      pageSize: 20,
      totalCount: 0,
      totalPages: 0,
    });

    context.memberUserIds.mockResolvedValue([OTHER]);
    await expect(service.search({ organizationId: ORG, userId: USER })).resolves.toMatchObject({
      items: [],
      totalCount: 0,
    });
    expect(page).not.toHaveBeenCalled();
  });

  it('names the organization of each event, null for an attempt that matched no account', async () => {
    page.mockResolvedValue([[event('e-1', USER), event('e-2', null)], 2]);

    const result = await service.search({});

    expect(context.organizationsOf).toHaveBeenCalledWith([USER]);
    expect(result.items).toEqual([
      { ...event('e-1', USER), organization: { id: ORG, name: 'ACME Trek Co., Ltd.' } },
      { ...event('e-2', null), organization: null },
    ]);
    expect(result).toMatchObject({ totalCount: 2, totalPages: 1 });
  });

  it('refuses a range whose start is not before its end', async () => {
    await expect(
      service.search({ from: '2026-10-21T00:00:00Z', to: '2026-10-21T00:00:00Z' }),
    ).rejects.toMatchObject({ errorCode: 'VALIDATION_FAILED' });
  });

  it.each([
    [{ userId: 'not-a-uuid' }, 'userId'],
    [{ organizationId: 'org-1' }, 'organizationId'],
    [{ type: 'LOGIN' }, 'type'],
    [{ from: '2026-10-01T25:00:00Z' }, 'from'],
  ])('rejects a malformed query %j in the DTO', (raw, field) => {
    const errors = validateSync(plainToInstance(AuthEventListQueryDto, raw));
    expect(errors.map((error) => error.property)).toEqual([field]);
  });
});
