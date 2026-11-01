import { SyncOutcome } from '@prisma/client';
import { SyncQueryRepository } from './sync-query.repository';
import { SyncStatsService } from './sync-stats.service';

const now = new Date('2026-11-01T03:20:00.000Z');

describe('SyncStatsService.stats (monitoring api-design 06)', () => {
  const repository = {
    outcomesSince: jest.fn(),
    lastReceivedAt: jest.fn(),
    devicesBuffering: jest.fn(),
  };
  const service = new SyncStatsService(repository as unknown as SyncQueryRepository);

  beforeEach(() => {
    jest.clearAllMocks();
    repository.outcomesSince.mockResolvedValue(
      new Map([
        [SyncOutcome.ACCEPTED, 40],
        [SyncOutcome.DUPLICATE_REJECTED, 3],
        [SyncOutcome.MALFORMED_ENVELOPE, 2],
        [SyncOutcome.UNKNOWN_DEVICE, 1],
        [SyncOutcome.NORMALIZATION_FAILED, 9],
      ]),
    );
    repository.lastReceivedAt.mockResolvedValue(new Date('2026-11-01T03:19:00.000Z'));
    repository.devicesBuffering.mockResolvedValue(4);
  });

  it('counts the outcomes of the window and adds the buffering devices', async () => {
    await expect(service.stats(30, now)).resolves.toEqual({
      windowMinutes: 30,
      accepted: 40,
      duplicates: 3,
      malformed: 2,
      unknownDevice: 1,
      lastReceivedAt: new Date('2026-11-01T03:19:00.000Z'),
      devicesBuffering: 4,
    });
  });

  it('reads the audit from the start of the window', async () => {
    await service.stats(30, now);
    expect(repository.outcomesSince).toHaveBeenCalledWith(new Date('2026-11-01T02:50:00.000Z'));
  });

  it('answers zeros for an outcome the window has none of', async () => {
    repository.outcomesSince.mockResolvedValue(new Map());
    repository.lastReceivedAt.mockResolvedValue(null);
    repository.devicesBuffering.mockResolvedValue(0);
    await expect(service.stats(60, now)).resolves.toEqual({
      windowMinutes: 60,
      accepted: 0,
      duplicates: 0,
      malformed: 0,
      unknownDevice: 0,
      lastReceivedAt: null,
      devicesBuffering: 0,
    });
  });
});
