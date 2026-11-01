import { SCHEDULED_JOB_KEY } from '../platform/scheduler/scheduled-job.decorator';
import { ContractDecisionsService } from './contract-decisions.service';
import { ContractsRepository } from './contracts.repository';
import { RequestHoldExpiryJob } from './request-hold-expiry.job';

const AT = new Date('2026-11-02T03:00:00.000Z');

describe('RequestHoldExpiryJob (rentals.requestHoldExpiry, REQ-EVT-17)', () => {
  let contracts: { expiredHolds: jest.Mock };
  let decisions: { expireHold: jest.Mock };
  let job: RequestHoldExpiryJob;

  beforeEach(() => {
    contracts = {
      expiredHolds: jest.fn().mockResolvedValue([
        { id: 'c-1', code: 'RC-2026-0004' },
        { id: 'c-2', code: 'RC-2026-0005' },
        { id: 'c-3', code: 'RC-2026-0006' },
      ]),
    };
    decisions = { expireHold: jest.fn().mockResolvedValue(true) };
    job = new RequestHoldExpiryJob(
      contracts as unknown as ContractsRepository,
      decisions as unknown as ContractDecisionsService,
    );
  });

  it('is scheduled every ten minutes under its own name', () => {
    const run = Object.getOwnPropertyDescriptor(RequestHoldExpiryJob.prototype, 'run')
      ?.value as object;
    expect(Reflect.getMetadata(SCHEDULED_JOB_KEY, run)).toEqual({
      name: 'rentals.requestHoldExpiry',
      cron: '0 */10 * * * *',
    });
  });

  it('hands each expired hold to expireHold at the run time and counts the cancellations', async () => {
    decisions.expireHold.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(job.run(AT)).resolves.toBe(2);
    expect(contracts.expiredHolds).toHaveBeenCalledWith(AT);
    expect(decisions.expireHold.mock.calls).toEqual([
      ['c-1', AT],
      ['c-2', AT],
      ['c-3', AT],
    ]);
  });

  it('keeps going after one contract fails; it is retried on the next run', async () => {
    decisions.expireHold.mockRejectedValueOnce(new Error('deadlock'));
    await expect(job.run(AT)).resolves.toBe(2);
    expect(decisions.expireHold).toHaveBeenCalledTimes(3);
  });
});
