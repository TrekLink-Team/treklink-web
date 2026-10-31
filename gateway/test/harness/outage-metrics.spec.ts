import { PriorityTier } from '../../src/config';
import { backlogAt, EventRecord, judge, percentiles, summarize } from './outage-metrics';

const { P0_SOS, P2_GPS, P3_TELEMETRY } = PriorityTier;

describe('outage harness metrics', () => {
  const cutAt = 100_000;
  const restoreAt = 130_000;
  const at = (key: string, tier: PriorityTier, generatedAt: number, receivedAt?: number, arrival?: number): EventRecord => ({
    key,
    tier,
    generatedAt,
    receivedAt,
    arrival,
  });

  it('takes nearest-rank percentiles and reports none for no values', () => {
    expect(percentiles([])).toEqual({ count: 0, p50: null, p95: null, max: null });
    const values = Array.from({ length: 100 }, (_, n) => n + 1);
    expect(percentiles(values)).toEqual({ count: 100, p50: 50, p95: 95, max: 100 });
  });

  it('counts as backlog what was generated before the restore and had not arrived by then', () => {
    const events = [
      at('early', P2_GPS, 90_000, 90_010, 0),
      at('inflight', P3_TELEMETRY, 99_990, 132_000, 2),
      at('outage', P0_SOS, 110_000, 131_000, 1),
      at('after', P2_GPS, 131_500, 131_520, 3),
    ];
    expect(backlogAt(events, restoreAt).map((event) => event.key)).toEqual(['inflight', 'outage']);
  });

  it('measures delivery of the events generated during the outage only (NFR-REL-02)', () => {
    const events = [
      at('before', P2_GPS, 90_000, 90_010, 0),
      at('a', P3_TELEMETRY, 101_000, 131_000, 1),
      at('b', P3_TELEMETRY, 102_000),
      at('after', P3_TELEMETRY, 140_000, 140_010, 2),
    ];
    const summary = summarize(events, { cutAt, restoreAt, backlogDrainedAt: 131_000 }, 0);
    expect(summary.outageGenerated).toBe(2);
    expect(summary.outageDelivered).toBe(1);
    expect(summary.deliveryRate).toBe(0.5);
  });

  it('takes latency from settled uplink-up events and counts a lost one as late (NFR-REL-01)', () => {
    const events = [
      at('settled', P2_GPS, 90_000, 90_040, 0),
      at('caught-by-cut', P2_GPS, 97_000, 131_000, 1), // inside the 5 s before the cut: backlog, not steady
      at('after-drain', P3_TELEMETRY, 135_000, 135_020, 2),
      at('lost', P3_TELEMETRY, 136_000),
    ];
    const summary = summarize(events, { cutAt, restoreAt, backlogDrainedAt: 131_000 }, 0);
    expect(summary.steadyLatency.count).toBe(3);
    expect(summary.steadyLatency.p50).toBe(40);
    expect(summary.steadyLatency.max).toBe(Number.POSITIVE_INFINITY);
  });

  it('scores a backlog P0 as first only when it arrived before every backlog P2 and P3 (NFR-REL-04)', () => {
    const events = [
      at('p0-a', P0_SOS, 105_000, 131_000, 0),
      at('p3-inflight', P3_TELEMETRY, 99_995, 131_001, 1),
      at('p0-b', P0_SOS, 110_000, 131_002, 2),
      at('p2', P2_GPS, 111_000, 131_003, 3),
    ];
    const summary = summarize(events, { cutAt, restoreAt, backlogDrainedAt: 131_003 }, 1);
    expect(summary.backlogP0).toBe(2);
    expect(summary.backlogP0BeforeLow).toBe(1);
    expect(summary.orderingRate).toBe(0.5);
    expect(summary.lowAheadOfP0).toBe(1);
    expect(summary.lowAheadOfP0InFlight).toBe(1);
    expect(summary.duplicates).toBe(1);
    expect(summary.drainMs).toBe(1003);
  });

  it('judges a condition on pooled figures and flags fewer than the required trials', () => {
    const good = summarize(
      [at('p0', P0_SOS, 105_000, 131_000, 0), at('p3', P3_TELEMETRY, 106_000, 131_001, 1), at('s', P2_GPS, 90_000, 90_010, 2)],
      { cutAt, restoreAt, backlogDrainedAt: 131_001 },
      0,
    );
    const verdict = judge([good, good, good], 20);
    expect(verdict).toMatchObject({
      trials: 3,
      deliveryRate: 1,
      orderingRate: 1,
      latencyMax: 10,
      nfrRel01: true,
      nfrRel02: true,
      nfrRel04: true,
      enoughTrials: false,
    });
  });
});
