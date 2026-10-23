import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../../common/errors';
import { ValidatedEnvironment } from '../config/environment-variables';
import { ParameterReadsService } from './parameter-reads.service';
import { ParameterRepository } from './parameter.repository';

const config = {
  get: (key: string) => ({ DEFAULT_PAGE_SIZE: 20, MAX_PAGE_SIZE: 100 })[key],
} as unknown as ConfigService<ValidatedEnvironment, true>;

describe('ParameterReadsService', () => {
  let repository: { page: jest.Mock; historyPage: jest.Mock; findByKey: jest.Mock };
  let directory: { namesOf: jest.Mock };
  let service: ParameterReadsService;

  beforeEach(() => {
    repository = {
      page: jest.fn().mockResolvedValue([[{ key: 'a.b' }], 41]),
      historyPage: jest.fn(),
      findByKey: jest.fn().mockResolvedValue({ key: 'incidents.primaryAckTimeoutSeconds' }),
    };
    directory = { namesOf: jest.fn().mockResolvedValue(new Map([['admin-1', 'TrekLink Admin']])) };
    service = new ParameterReadsService(
      repository as unknown as ParameterRepository,
      config,
      directory,
    );
  });

  it('pages the list with the default size and reports the totals (api-design 02)', async () => {
    await expect(service.list({})).resolves.toEqual({
      items: [{ key: 'a.b' }],
      pageNumber: 1,
      pageSize: 20,
      totalCount: 41,
      totalPages: 3,
    });
    expect(repository.page).toHaveBeenCalledWith({}, 0, 20);
  });

  it('filters by owning module and skips to the requested page', async () => {
    await service.list({ ownerModule: 'incidents', pageNumber: 3, pageSize: 10 });
    expect(repository.page).toHaveBeenCalledWith({ ownerModule: 'incidents' }, 20, 10);
  });

  it('accepts MAX_PAGE_SIZE and refuses one more', async () => {
    await service.list({ pageSize: 100 });
    await expect(service.list({ pageSize: 101 })).rejects.toThrow(
      'pageSize must not be greater than 100.',
    );
  });

  it('returns the history newest first with the actor name', async () => {
    const changedAt = new Date('2026-10-20T03:15:00Z');
    repository.historyPage.mockResolvedValue([
      [{ previousValue: 120, newValue: 90, changedById: 'admin-1', reason: 'drill', changedAt }],
      1,
    ]);
    await expect(service.history('incidents.primaryAckTimeoutSeconds', {})).resolves.toEqual({
      items: [
        {
          previousValue: 120,
          newValue: 90,
          changedBy: { id: 'admin-1', fullName: 'TrekLink Admin' },
          reason: 'drill',
          changedAt,
        },
      ],
      pageNumber: 1,
      pageSize: 20,
      totalCount: 1,
      totalPages: 1,
    });
    expect(directory.namesOf).toHaveBeenCalledWith(['admin-1']);
  });

  it('answers 404 Parameter not found for an unknown key', async () => {
    repository.findByKey.mockResolvedValue(null);
    const failure = service.history('nope.key', {});
    await expect(failure).rejects.toBeInstanceOf(DomainException);
    await expect(failure).rejects.toThrow('Parameter not found.');
    expect(repository.historyPage).not.toHaveBeenCalled();
  });

  it('shows a null name without a directory provider instead of failing', async () => {
    service = new ParameterReadsService(repository as unknown as ParameterRepository, config);
    repository.historyPage.mockResolvedValue([
      [{ previousValue: 1, newValue: 2, changedById: 'x', reason: null, changedAt: new Date() }],
      1,
    ]);
    const { items } = await service.history('incidents.primaryAckTimeoutSeconds', {});
    expect(items[0].changedBy).toEqual({ id: 'x', fullName: null });
  });
});
