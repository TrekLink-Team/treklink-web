import { distanceKm, isImplausibleMove, isValidPosition, toBounds } from './position-rules';

const vietnam = toBounds({ minLat: 8.0, maxLat: 23.5, minLon: 102.0, maxLon: 110.0 });
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 23, 3, 0, seconds));

describe('position rules', () => {
  it('accepts a position inside the box and refuses one outside it or outside WGS-84', () => {
    expect(isValidPosition({ latitude: 11.5544, longitude: 108.5381 }, vietnam)).toBe(true);
    expect(isValidPosition({ latitude: 35.6895, longitude: 139.6917 }, vietnam)).toBe(false);
    expect(isValidPosition({ latitude: 91, longitude: 108 }, { ...vietnam, maxLat: 95 })).toBe(
      false,
    );
    expect(isValidPosition({ latitude: NaN, longitude: 108 }, vietnam)).toBe(false);
  });

  it('refuses a bounds parameter of the wrong shape', () => {
    expect(() => toBounds({ minLat: 1 })).toThrow('monitoring.positionBounds');
  });

  it('measures great-circle distance', () => {
    // One degree of latitude is about 111.2 km.
    expect(
      distanceKm({ latitude: 11, longitude: 108 }, { latitude: 12, longitude: 108 }),
    ).toBeCloseTo(111.2, 0);
  });

  it('flags a move faster than the maximum speed, and passes a walk or a non-later reading', () => {
    const start = { latitude: 11.5544, longitude: 108.5381, at: at(0) };
    expect(
      isImplausibleMove(start, { latitude: 11.5546, longitude: 108.5382, at: at(30) }, 30),
    ).toBe(false);
    expect(
      isImplausibleMove(start, { latitude: 11.6544, longitude: 108.5381, at: at(30) }, 30),
    ).toBe(true);
    expect(isImplausibleMove(start, { latitude: 12.5, longitude: 108.5, at: at(0) }, 30)).toBe(
      false,
    );
  });
});
