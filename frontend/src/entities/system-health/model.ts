import type { ComponentState, HealthStation, QueueDepth } from './api';

// Stale and outdated rows first, then by name (screen 9.3).
export const sortStations = (stations: HealthStation[]): HealthStation[] =>
  [...stations].sort((a, b) => {
    const problem = (station: HealthStation) =>
      (station.stale ? 2 : 0) + (station.outdated ? 1 : 0);
    return problem(b) - problem(a) || a.name.localeCompare(b.name);
  });

export const COMPONENT_LABEL: Record<ComponentState, string> = {
  up: 'UP',
  down: 'DOWN',
  unknown: 'UNKNOWN',
};

// A probe-less broker is never shown as up (the health contract).
export const componentNote = (name: 'database' | 'mqtt', state: ComponentState): string | null =>
  name === 'mqtt' && state === 'unknown' ? 'No probe is registered' : null;

export const depthText = (depth: QueueDepth): string =>
  `p0: ${depth.p0}, p1: ${depth.p1}, p2: ${depth.p2}, p3: ${depth.p3}`;

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;
