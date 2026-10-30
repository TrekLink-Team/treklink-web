import { ParameterService } from '../platform/parameters/parameter.service';
import { REPLAY_BATCH_SIZE, ReplayService } from './replay.service';
import { StreamEntry, StreamRepository } from './stream.repository';

const NOW = new Date('2026-10-30T03:00:00.000Z');

describe('ReplayService', () => {
  let repository: { oldestSeqSince: jest.Mock; maxSeq: jest.Mock; after: jest.Mock };
  let retentionHours: number;
  let service: ReplayService;

  beforeEach(() => {
    repository = {
      oldestSeqSince: jest.fn(),
      maxSeq: jest.fn().mockResolvedValue(0),
      after: jest.fn().mockResolvedValue([]),
    };
    retentionHours = 72;
    const parameters = { get: jest.fn(() => Promise.resolve(retentionHours)) };
    service = new ReplayService(
      repository as unknown as StreamRepository,
      parameters as unknown as ParameterService,
    );
  });

  describe('isExpired', () => {
    it('asks for the oldest entry inside the retention window', async () => {
      repository.oldestSeqSince.mockResolvedValue(100);
      await service.isExpired(100, NOW);
      expect(repository.oldestSeqSince).toHaveBeenCalledWith(new Date('2026-10-27T03:00:00.000Z'));
    });

    it('follows an Admin change of the retention', async () => {
      retentionHours = 1;
      repository.oldestSeqSince.mockResolvedValue(100);
      await service.isExpired(100, NOW);
      expect(repository.oldestSeqSince).toHaveBeenCalledWith(new Date('2026-10-30T02:00:00.000Z'));
    });

    it('is not expired when the cursor sits just before the oldest retained entry', async () => {
      repository.oldestSeqSince.mockResolvedValue(100);
      await expect(service.isExpired(99, NOW)).resolves.toBe(false);
    });

    it('is not expired when the cursor is inside the window', async () => {
      repository.oldestSeqSince.mockResolvedValue(100);
      await expect(service.isExpired(150, NOW)).resolves.toBe(false);
    });

    it('is expired when entries after the cursor have left the window', async () => {
      repository.oldestSeqSince.mockResolvedValue(100);
      await expect(service.isExpired(98, NOW)).resolves.toBe(true);
    });

    it('is expired for a cursor behind the newest entry when nothing recent remains', async () => {
      repository.oldestSeqSince.mockResolvedValue(null);
      repository.maxSeq.mockResolvedValue(500);
      await expect(service.isExpired(499, NOW)).resolves.toBe(true);
    });

    it('is not expired for a cursor at the newest entry of a quiet stream', async () => {
      repository.oldestSeqSince.mockResolvedValue(null);
      repository.maxSeq.mockResolvedValue(500);
      await expect(service.isExpired(500, NOW)).resolves.toBe(false);
    });

    it('is not expired for an empty stream', async () => {
      repository.oldestSeqSince.mockResolvedValue(null);
      await expect(service.isExpired(0, NOW)).resolves.toBe(false);
    });
  });

  describe('batchAfter', () => {
    const entry = (seq: number): StreamEntry => ({
      seq,
      organizationId: 'org-a',
      type: 'device.position',
      deviceId: 'd-1',
      payload: {},
      createdAt: '2026-10-30T02:00:00.000Z',
    });

    it('reads a batch for the scope and returns the wire form without the organization', async () => {
      repository.after.mockResolvedValue([entry(11), entry(12)]);
      const batch = await service.batchAfter('org-a', 10);
      expect(repository.after).toHaveBeenCalledWith('org-a', 10, REPLAY_BATCH_SIZE);
      expect(batch.map((e) => e.seq)).toEqual([11, 12]);
      expect(batch[0]).not.toHaveProperty('organizationId');
    });

    it('reads the fleet every entry', async () => {
      await service.batchAfter(null, 10);
      expect(repository.after).toHaveBeenCalledWith(null, 10, REPLAY_BATCH_SIZE);
    });

    it('reads at most the given limit (GET /api/telemetry/stream)', async () => {
      await service.batchAfter('org-a', 10, 201);
      expect(repository.after).toHaveBeenCalledWith('org-a', 10, 201);
    });
  });
});
