import { describe, expect, it } from 'vitest';
import {
  CLUSTER_REACH_PX,
  STACK_REACH_PX,
  clusterName,
  groupPoints,
  nearText,
  severityRank,
  type ClusterPoint,
} from './cluster';

const at = (
  id: string,
  x: number,
  y: number,
  state: ClusterPoint['state'] = 'fresh',
): ClusterPoint => ({
  id,
  x,
  y,
  state,
});

describe('groupPoints (leader ruling 2026-11-06)', () => {
  it('groups points closer than the reach and leaves the others alone', () => {
    const groups = groupPoints([at('a', 0, 0), at('b', 30, 0), at('c', 200, 0)], CLUSTER_REACH_PX);
    expect(groups.map((g) => g.ids)).toEqual([['a', 'b'], ['c']]);
  });

  it('keeps points exactly one reach apart in separate groups', () => {
    expect(groupPoints([at('a', 0, 0), at('b', 48, 0)], CLUSTER_REACH_PX)).toHaveLength(2);
    expect(groupPoints([at('a', 0, 0), at('b', 47.9, 0)], CLUSTER_REACH_PX)).toHaveLength(1);
  });

  it('places a group at the true centroid of its members', () => {
    const [group] = groupPoints([at('a', 0, 0), at('b', 30, 0), at('c', 15, 30)], CLUSTER_REACH_PX);
    expect(group.ids).toHaveLength(3);
    expect(group.x).toBeCloseTo(15, 9);
    expect(group.y).toBeCloseTo(10, 9);
  });

  it('stacks by the 24 px target reach where it would cluster at 48 px', () => {
    const points = [at('a', 0, 0), at('b', 30, 0)];
    expect(groupPoints(points, STACK_REACH_PX)).toHaveLength(2);
    expect(groupPoints(points, CLUSTER_REACH_PX)).toHaveLength(1);
  });

  it('orders members most severe first and colours the group by the most severe state', () => {
    const [group] = groupPoints(
      [
        at('a', 0, 0, 'fresh'),
        at('b', 1, 0, 'unheard'),
        at('c', 2, 0, 'sos'),
        at('d', 3, 0, 'stale'),
        at('e', 4, 0, 'attention'),
      ],
      CLUSTER_REACH_PX,
    );
    expect(group.ids).toEqual(['c', 'e', 'b', 'd', 'a']);
    expect(group.state).toBe('sos');
    expect(severityRank('sos')).toBeLessThan(severityRank('attention'));
    expect(severityRank('attention')).toBeLessThan(severityRank('unheard'));
    expect(severityRank('unheard')).toBeLessThan(severityRank('fresh'));
  });

  it('gives the same groups whatever the input order', () => {
    const points = [at('d', 100, 0), at('a', 0, 0), at('c', 70, 0), at('b', 35, 0)];
    const shuffled = [points[2], points[0], points[3], points[1]];
    expect(groupPoints(points, CLUSTER_REACH_PX)).toEqual(groupPoints(shuffled, CLUSTER_REACH_PX));
  });

  it('merges the closest pair first, so a chain does not collapse into one cluster', () => {
    // a-b are 10 px apart and merge at x 5; c, 45 px from b, sits 50 px from that centroid.
    const groups = groupPoints([at('a', 0, 0), at('b', 10, 0), at('c', 55, 0)], CLUSTER_REACH_PX);
    expect(groups.map((g) => g.ids)).toEqual([['a', 'b'], ['c']]);
  });

  it('returns nothing for no points', () => {
    expect(groupPoints([], CLUSTER_REACH_PX)).toEqual([]);
  });
});

describe('clusterName', () => {
  it('reads the count, each state that is not live by severity, then the place', () => {
    const states = [
      ...Array<'fresh'>(9).fill('fresh'),
      'stale' as const,
      'sos' as const,
      'stale' as const,
    ];
    expect(clusterName(states, nearText(11.56012, 108.540249))).toBe(
      '12 devices, 1 SOS, 2 offline, near 11.5601, 108.5402',
    );
  });

  it('names a cluster of live units by its count and place only', () => {
    expect(clusterName(['fresh', 'fresh'], '11.5000, 108.5000')).toBe(
      '2 devices, near 11.5000, 108.5000',
    );
  });

  it('puts SOS ahead of not heard', () => {
    expect(clusterName(['unheard', 'unheard', 'sos'], 'x')).toBe(
      '3 devices, 1 SOS, 2 not heard since handover, near x',
    );
  });
});
