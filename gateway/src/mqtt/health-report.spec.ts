import { buildHealthReport, gatewayVersion, HEALTH_SCHEMA, healthTopic } from './health-report';

describe('Field Station health report', () => {
  it('names the station in the topic under the root', () => {
    expect(healthTopic('treklink', 'fs-org-0001-1')).toBe('treklink/fs/fs-org-0001-1/health');
  });

  it('carries depth per tier, the oldest attempts, the last flush and the send time', () => {
    const queue = { depthByTier: () => [2, 0, 12, 12], oldestAttempts: () => 1 };
    expect(buildHealthReport(queue, '0.1.0', 1_761_800_000_000, 1_761_800_005_000)).toEqual({
      schema: HEALTH_SCHEMA,
      v: 1,
      version: '0.1.0',
      depth: [2, 0, 12, 12],
      oldest_attempts: 1,
      last_flush_at: 1_761_800_000_000,
      sent_at: 1_761_800_005_000,
    });
  });

  it('reads the version from the gateway package', () => {
    expect(gatewayVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
