import { DeviceStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { StockTakeService, classify } from './stock-take.service';
import { CountedDevice, StockTakesRepository } from './stock-takes.repository';

const AT = new Date('2026-11-05T10:00:00.000Z');
const hoursAgo = (hours: number) => new Date(AT.getTime() - hours * 3600 * 1000);
const STAFF = { id: 'staff-1', roles: ['STAFF'], organizationId: null };

const unit = (
  assetTag: string,
  status: DeviceStatus,
  lastSeenAt: Date | null = null,
): CountedDevice => ({ id: `id-${assetTag}`, assetTag, status, lastSeenAt });

describe('classify (REQ-EVT-30)', () => {
  it('lists a rented unit last heard 30 hours ago as unconfirmed with a 24 hour window (AC-04)', () => {
    const result = classify(
      [
        unit('TL-0040', DeviceStatus.RENTED, hoursAgo(30)),
        unit('TL-0041', DeviceStatus.RENTED, hoursAgo(2)),
      ],
      [],
      hoursAgo(24),
    );
    expect(result.rentedSeen).toBe(1);
    expect(result.unconfirmed).toEqual([
      {
        id: 'id-TL-0040',
        assetTag: 'TL-0040',
        status: DeviceStatus.RENTED,
        lastSeenAt: hoursAgo(30).toISOString(),
      },
    ]);
  });

  it('confirms scanned units whatever their status, and lists unknown tags (AC-23)', () => {
    const result = classify(
      [
        unit('TL-0001', DeviceStatus.AVAILABLE),
        unit('TL-0002', DeviceStatus.MAINTENANCE),
        unit('TL-0003', DeviceStatus.RENTED),
        unit('TL-0004', DeviceStatus.AVAILABLE),
      ],
      ['TL-0001', 'TL-0002', 'TL-0003', 'TL-9999'],
      hoursAgo(24),
    );
    expect(result).toEqual({
      scannedCount: 4,
      inStockConfirmed: 3,
      rentedSeen: 0,
      unconfirmed: [
        { id: 'id-TL-0004', assetTag: 'TL-0004', status: DeviceStatus.AVAILABLE, lastSeenAt: null },
      ],
      unknownTags: ['TL-9999'],
    });
  });

  it('matches a stored tag of any case against the upper-cased scan', () => {
    const result = classify([unit('tl-0007', DeviceStatus.AVAILABLE)], ['TL-0007'], hoursAgo(24));
    expect(result.inStockConfirmed).toBe(1);
    expect(result.unknownTags).toEqual([]);
  });
});

describe('StockTakeService', () => {
  let repo: { countedDevices: jest.Mock; insert: jest.Mock; page: jest.Mock };
  let events: { transaction: jest.Mock; emitAfterCommit: jest.Mock };
  let parameters: { get: jest.Mock };
  let directory: { namesOf: jest.Mock };
  let service: StockTakeService;

  beforeEach(() => {
    repo = {
      countedDevices: jest
        .fn()
        .mockResolvedValue([
          unit('TL-0001', DeviceStatus.AVAILABLE),
          unit('TL-0031', DeviceStatus.AVAILABLE),
        ]),
      insert: jest.fn().mockResolvedValue({ id: 'st-1', createdAt: AT }),
      page: jest.fn(),
    };
    events = {
      transaction: jest.fn((work: (tx: object) => unknown) => work({})),
      emitAfterCommit: jest.fn(),
    };
    parameters = { get: jest.fn().mockResolvedValue(24) };
    directory = { namesOf: jest.fn().mockResolvedValue(new Map([['staff-1', 'Tran Thi B']])) };
    const config = { get: (key: string) => (key === 'MAX_PAGE_SIZE' ? 100 : 20) };
    service = new StockTakeService(
      repo as unknown as StockTakesRepository,
      parameters as unknown as ParameterService,
      events as unknown as TransactionalEvents,
      config as unknown as ConfigService<never, true>,
      directory,
    );
  });

  it('reads the window from devices.stockTakeSeenHours, stores the run and audits it after commit', async () => {
    const run = await service.run({ scannedTags: ['TL-0001', 'TL-0001', 'TL-9999'] }, STAFF, AT);
    expect(parameters.get).toHaveBeenCalledWith('devices.stockTakeSeenHours', {});
    expect(run).toMatchObject({
      id: 'st-1',
      scannedCount: 2,
      inStockConfirmed: 1,
      unknownTags: ['TL-9999'],
      unconfirmed: [expect.objectContaining({ assetTag: 'TL-0031' })],
    });
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        scannedTags: ['TL-0001', 'TL-9999'],
        takenById: 'staff-1',
        createdAt: AT,
      }),
      {},
    );
    expect(events.emitAfterCommit).toHaveBeenCalledWith(
      AUDIT_RECORD,
      expect.objectContaining({
        action: 'stockTake.run',
        subjectType: 'StockTake',
        subjectId: 'st-1',
        after: expect.objectContaining({ unconfirmedCount: 1, unknownCount: 1 }) as unknown,
      }),
    );
  });

  it('lists runs with the taker name from the account directory and the counts', async () => {
    repo.page.mockResolvedValue([
      [
        {
          id: 'st-1',
          scannedTags: ['TL-0001', 'TL-9999'],
          result: {
            scannedCount: 2,
            unconfirmed: [{ assetTag: 'TL-0031' }],
            unknownTags: ['TL-9999'],
          },
          takenById: 'staff-1',
          createdAt: AT,
        },
      ],
      1,
    ]);
    await expect(service.list({})).resolves.toEqual({
      items: [
        {
          id: 'st-1',
          takenBy: 'Tran Thi B',
          createdAt: AT,
          scannedCount: 2,
          unconfirmedCount: 1,
          unknownCount: 1,
        },
      ],
      pageNumber: 1,
      pageSize: 20,
      totalCount: 1,
      totalPages: 1,
    });
    expect(repo.page).toHaveBeenCalledWith(0, 20);
  });
});
