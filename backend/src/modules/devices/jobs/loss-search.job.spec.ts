import { LossSearchJob } from './loss-search.job';

// devices.lossSearch (task 2.7, REQ-EVT-15): each due case is confirmed through LossCaseService.
describe('LossSearchJob', () => {
  const at = new Date('2026-11-07T04:00:00Z');

  it('confirms every due case once, counting only those it moved', async () => {
    const cases = { dueForConfirmation: jest.fn().mockResolvedValue(['lc-1', 'lc-2', 'lc-3']) };
    const service = {
      confirmDue: jest
        .fn()
        .mockResolvedValueOnce(true)
        // lc-2 was confirmed by Staff between the read and the job's compare-and-set.
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
    };
    const job = new LossSearchJob(cases as never, service as never);

    await expect(job.run(at)).resolves.toEqual({ confirmed: 2 });
    expect(cases.dueForConfirmation).toHaveBeenCalledWith(at);
    expect(service.confirmDue.mock.calls).toEqual([
      ['lc-1', at],
      ['lc-2', at],
      ['lc-3', at],
    ]);
  });

  it('keeps going when one case fails', async () => {
    const cases = { dueForConfirmation: jest.fn().mockResolvedValue(['lc-1', 'lc-2']) };
    const service = {
      confirmDue: jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(true),
    };
    const job = new LossSearchJob(cases as never, service as never);
    await expect(job.run(at)).resolves.toEqual({ confirmed: 1 });
  });
});
