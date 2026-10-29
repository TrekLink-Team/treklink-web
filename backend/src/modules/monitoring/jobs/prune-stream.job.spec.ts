import { ParameterService } from '../../platform/parameters/parameter.service';
import { StreamRepository } from '../stream.repository';
import { PRUNE_BATCH_SIZE, PruneStreamJob } from './prune-stream.job';

const NOW = new Date('2026-10-30T03:10:00.000Z');

describe('PruneStreamJob', () => {
  let repository: { pruneBefore: jest.Mock };
  let retentionHours: number;
  let job: PruneStreamJob;

  beforeEach(() => {
    repository = { pruneBefore: jest.fn().mockResolvedValue(0) };
    retentionHours = 72;
    const parameters = { get: jest.fn(() => Promise.resolve(retentionHours)) };
    job = new PruneStreamJob(
      repository as unknown as StreamRepository,
      parameters as unknown as ParameterService,
    );
  });

  it('deletes entries older than the retention window', async () => {
    await job.run(NOW);
    expect(repository.pruneBefore).toHaveBeenCalledWith(
      new Date('2026-10-27T03:10:00.000Z'),
      PRUNE_BATCH_SIZE,
    );
  });

  it('follows an Admin change of the retention', async () => {
    retentionHours = 24;
    await job.run(NOW);
    expect(repository.pruneBefore).toHaveBeenCalledWith(
      new Date('2026-10-29T03:10:00.000Z'),
      PRUNE_BATCH_SIZE,
    );
  });

  it('does nothing more when the first batch is short, and a re-run finds nothing', async () => {
    repository.pruneBefore.mockResolvedValueOnce(120);
    await expect(job.run(NOW)).resolves.toBe(120);
    expect(repository.pruneBefore).toHaveBeenCalledTimes(1);
    await expect(job.run(NOW)).resolves.toBe(0);
  });

  it('keeps deleting in batches until one comes back short, and totals them', async () => {
    repository.pruneBefore
      .mockResolvedValueOnce(PRUNE_BATCH_SIZE)
      .mockResolvedValueOnce(PRUNE_BATCH_SIZE)
      .mockResolvedValueOnce(37);
    await expect(job.run(NOW)).resolves.toBe(2 * PRUNE_BATCH_SIZE + 37);
    expect(repository.pruneBefore).toHaveBeenCalledTimes(3);
  });

  it('stops at an exactly full last batch only after one more empty read', async () => {
    repository.pruneBefore.mockResolvedValueOnce(PRUNE_BATCH_SIZE).mockResolvedValueOnce(0);
    await expect(job.run(NOW)).resolves.toBe(PRUNE_BATCH_SIZE);
    expect(repository.pruneBefore).toHaveBeenCalledTimes(2);
  });

  it('lets a failed delete reach the job runner, which logs it and keeps the scheduler going', async () => {
    repository.pruneBefore.mockRejectedValue(new Error('db down'));
    await expect(job.run(NOW)).rejects.toThrow('db down');
  });

  it('registers on the hourly cron under its name', () => {
    const run = Object.getOwnPropertyDescriptor(PruneStreamJob.prototype, 'run')?.value as object;
    const options = Reflect.getMetadata('treklink:scheduledJob', run) as {
      name: string;
      cron: string;
    };
    expect(options).toEqual({ name: 'monitoring.pruneStream', cron: '0 10 * * * *' });
  });
});
