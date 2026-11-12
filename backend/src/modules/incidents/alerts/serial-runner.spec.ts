import { SerialRunner } from './alert-dispatcher.job';

// Issue #471: a run requested while the previous run is finishing must still start a pass. Before
// the fix, a request in the microtasks between the last pass settling and the runner clearing its
// promise was answered with the finished run, so a committed alert waited for the 2 s cron.
const microtasks = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i++) await Promise.resolve();
};

// Runs `task` exactly `ticks` microtasks from now: each `then` on the chain adds one.
const afterTicks = (ticks: number, task: () => void): Promise<void> => {
  let chain = Promise.resolve();
  for (let i = 1; i < ticks; i++) chain = chain.then(() => undefined);
  return chain.then(task);
};

describe('SerialRunner', () => {
  it.each(Array.from({ length: 16 }, (_, ticks) => ticks))(
    'starts another pass for a request made %i microtasks after the running pass settles',
    async (ticks) => {
      let passes = 0;
      let release!: () => void;
      const runner = new SerialRunner(() => {
        passes += 1;
        if (passes > 1) return Promise.resolve(1);
        return new Promise<number>((resolve) => (release = () => resolve(1)));
      });
      const first = runner.run();
      let second: Promise<number> | undefined;
      release();
      if (ticks === 0) second = runner.run();
      else
        await afterTicks(ticks, () => {
          second = runner.run();
        });
      await Promise.all([first, second]);
      await microtasks(16);
      expect(passes).toBe(2);
    },
  );

  it('runs one pass at a time and folds requests made during a pass into one more pass', async () => {
    let active = 0;
    let peak = 0;
    let passes = 0;
    const runner = new SerialRunner(async () => {
      passes += 1;
      active += 1;
      peak = Math.max(peak, active);
      await microtasks(3);
      active -= 1;
      return 1;
    });
    const results = await Promise.all([runner.run(), runner.run(), runner.run()]);
    expect(peak).toBe(1);
    expect(passes).toBe(2);
    expect(results).toEqual([2, 2, 2]);
  });

  it('accepts a new run after a pass rejects', async () => {
    let passes = 0;
    const runner = new SerialRunner(() => {
      passes += 1;
      return passes === 1 ? Promise.reject(new Error('claim failed')) : Promise.resolve(3);
    });
    await expect(runner.run()).rejects.toThrow('claim failed');
    await expect(runner.run()).resolves.toBe(3);
    expect(passes).toBe(2);
  });
});
