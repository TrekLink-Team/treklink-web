import { DockSweepJob } from './dock-sweep.job';

describe('DockSweepJob (devices.dockSweep)', () => {
  it('reports how many sessions expired and survives a failing sweep', async () => {
    const sessions = {
      expireStale: jest.fn().mockResolvedValueOnce(2).mockRejectedValueOnce(new Error('down')),
    };
    const job = new DockSweepJob(sessions as never);
    const at = new Date('2026-11-04T03:00:00Z');

    await expect(job.run(at)).resolves.toEqual({ expired: 2 });
    await expect(job.run(at)).resolves.toEqual({ expired: 0 });
    expect(sessions.expireStale).toHaveBeenCalledWith(at);
  });
});
