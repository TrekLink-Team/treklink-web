import { describe, expect, it } from 'vitest';
import { MIN_TARGET_PX, spreadOffsets, type SpreadPoint } from './spread';

// Where each target is drawn: Leaflet rounds the reading to a whole pixel, then the offset applies.
const placed = (points: SpreadPoint[]) => {
  const offsets = spreadOffsets(points);
  return points.map((p) => {
    const [dx, dy] = offsets.get(p.id) ?? [0, 0];
    return { id: p.id, x: Math.round(p.x) + dx, y: Math.round(p.y) + dy };
  });
};

const closest = (points: { x: number; y: number }[]) => {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i += 1)
    for (let j = i + 1; j < points.length; j += 1)
      min = Math.min(min, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
  return min;
};

describe('spreadOffsets (WCAG 2.2, 2.5.8)', () => {
  it('leaves markers alone that are already 24 px apart', () => {
    expect(
      spreadOffsets([
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 24, y: 0 },
        { id: 'c', x: 0, y: 30 },
      ]).size,
    ).toBe(0);
  });

  it('spreads two markers 4 px apart to 24 px along the line through them', () => {
    const [a, b] = placed([
      { id: 'a', x: 100, y: 50 },
      { id: 'b', x: 104, y: 50 },
    ]);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(MIN_TARGET_PX);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThanOrEqual(MIN_TARGET_PX + 2);
    expect(a.y).toBe(50);
    expect(b.y).toBe(50);
    expect(a.x).toBeLessThan(b.x);
    // The pair stays centred on its readings, to the pixel.
    expect(Math.abs((a.x + b.x) / 2 - 102)).toBeLessThanOrEqual(1);
  });

  it('spreads markers on one spot around it, in id order', () => {
    const points = ['c', 'a', 'b', 'd', 'e'].map((id) => ({ id, x: 10, y: 10 }));
    const result = placed(points);
    expect(closest(result)).toBeGreaterThanOrEqual(MIN_TARGET_PX - 1e-6);
    const a = result.find((p) => p.id === 'a')!;
    expect(a.x).toBe(10);
    expect(a.y).toBeLessThan(10);
  });

  it('merges a spread group with a neighbour it would land on', () => {
    const result = placed([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 2, y: 0 },
      { id: 'c', x: 30, y: 0 },
    ]);
    expect(closest(result)).toBeGreaterThanOrEqual(MIN_TARGET_PX - 1e-6);
  });

  it('keeps every drawn target 24 px apart once readings and offsets are rounded (review of #360)', () => {
    for (let count = 2; count <= 10; count += 1)
      for (const [fx, fy] of [
        [0.49, 0.51],
        [0.5, 0.5],
        [0.13, 0.87],
      ]) {
        const points = Array.from({ length: count }, (_, i) => ({
          id: `p${i}`,
          x: 200 + fx + (i % 3) * 1.7,
          y: 300 + fy + i * 0.9,
        }));
        const offsets = spreadOffsets(points);
        for (const [dx, dy] of offsets.values()) {
          expect(Number.isInteger(dx)).toBe(true);
          expect(Number.isInteger(dy)).toBe(true);
        }
        expect(closest(placed(points)), `${count} at +${fx},+${fy}`).toBeGreaterThanOrEqual(
          MIN_TARGET_PX,
        );
      }
  });
});
