import { describe, expect, it } from 'vitest';
import type { HealthStation } from './api';
import { componentNote, depthText, plural, sortStations } from './model';

const station = (overrides: Partial<HealthStation> = {}): HealthStation => ({
  id: 'fs-1',
  name: 'Beta',
  organization: { id: 'org-1', name: 'ACME' },
  lastSyncAt: '2026-11-01T03:00:00.000Z',
  stale: false,
  queueDepth: { p0: 0, p1: 0, p2: 0, p3: 0 },
  oldestRetryCount: 0,
  version: '1.2.0',
  outdated: false,
  ...overrides,
});

describe('the system health model (screen 9.3)', () => {
  it('puts stale rows first, then outdated, then the rest by name', () => {
    const sorted = sortStations([
      station({ id: 'a', name: 'Alpha' }),
      station({ id: 'b', name: 'Bravo', outdated: true }),
      station({ id: 'c', name: 'Charlie', stale: true }),
      station({ id: 'd', name: 'Delta', stale: true, outdated: true }),
      station({ id: 'e', name: 'Echo' }),
    ]);
    expect(sorted.map((row) => row.id)).toEqual(['d', 'c', 'b', 'a', 'e']);
  });

  it('does not change the list it is given', () => {
    const list = [station({ name: 'Zulu' }), station({ id: 'x', name: 'Alpha', stale: true })];
    sortStations(list);
    expect(list.map((row) => row.name)).toEqual(['Zulu', 'Alpha']);
  });

  it('explains an MQTT broker with no probe and nothing else', () => {
    expect(componentNote('mqtt', 'unknown')).toBe('No probe is registered');
    expect(componentNote('mqtt', 'up')).toBeNull();
    expect(componentNote('database', 'unknown')).toBeNull();
  });

  it('names the depth per priority', () => {
    expect(depthText({ p0: 0, p1: 0, p2: 14, p3: 230 })).toBe('p0: 0, p1: 0, p2: 14, p3: 230');
  });

  it('counts in the singular and the plural', () => {
    expect(plural(1, 'alert')).toBe('1 alert');
    expect(plural(2, 'alert')).toBe('2 alerts');
    expect(plural(0, 'Field Station')).toBe('0 Field Stations');
  });
});
