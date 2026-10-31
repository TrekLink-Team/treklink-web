import { runHarness } from './outage';

// A smoke run of the outage harness itself (gateway-sync task 5.3), short enough for CI: one trial of a
// 2 s outage against the in-process broker, to keep the harness working; the measurements are its job.
describe('outage harness', () => {
  it('cuts and restores the uplink and reports every NFR figure for the condition', async () => {
    const lines: string[] = [];
    const report = await runHarness({
      outagesS: [2],
      trials: 1,
      warmupS: 6,
      tailS: 1,
      intervalMs: 200,
      nodes: 2,
      sosEvery: 2,
      reconnectMs: 200,
      drainTimeoutS: 15,
      maxRows: 100_000,
      minTrials: 20,
      log: (line) => lines.push(line),
    });
    const [condition] = report.conditions;
    const [trial] = condition.trials;
    expect(trial.outageGenerated).toBeGreaterThan(0);
    expect(trial.outageDelivered).toBe(trial.outageGenerated);
    expect(trial.backlogP0).toBeGreaterThan(0);
    expect(trial.steadyLatency.count).toBeGreaterThan(0);
    expect(trial.drainMs).not.toBeNull();
    expect(condition.verdict.nfrRel02).toBe(true);
    expect(condition.verdict.enoughTrials).toBe(false);
    expect(condition.shed).toEqual([0, 0, 0, 0]);
    expect(lines.some((line) => line.startsWith('| 2.0 s | 1 (under 20, indicative)'))).toBe(true);
  }, 60_000);
});
