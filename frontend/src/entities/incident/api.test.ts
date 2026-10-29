import { describe, expect, it } from 'vitest';
import type { IncidentState } from '../../shared/ui/status';
import { actionsFor, deadlineOf, type Incident } from './api';

const incident = (state: IncidentState, ownerId: string | null = null): Incident =>
  ({
    state,
    owner: ownerId ? { id: ownerId, fullName: 'Owner' } : null,
    tierDeadlineAt: null,
    statusDueAt: null,
  }) as Incident;

// The state-and-viewer table of screen 8.1.
describe('actionsFor', () => {
  it.each<IncidentState>(['NOTIFY_PRIMARY', 'NOTIFY_BACKUP', 'NOTIFY_MANAGER'])(
    'offers acknowledge first, then false alarm, while %s',
    (state) => {
      expect(actionsFor(incident(state), 'me')).toEqual(['acknowledge', 'falseAlarm']);
    },
  );

  it.each<IncidentState>(['ESCALATED', 'REPORTED'])('offers acknowledge only while %s', (state) => {
    expect(actionsFor(incident(state, 'other'), 'me')).toEqual(['acknowledge']);
  });

  it('gives the owner of an ACKNOWLEDGED incident responding first', () => {
    expect(actionsFor(incident('ACKNOWLEDGED', 'me'), 'me')).toEqual([
      'responding',
      'status',
      'resolve',
      'falseAlarm',
    ]);
  });

  it('gives the owner of a RESPONDING incident status first', () => {
    expect(actionsFor(incident('RESPONDING', 'me'), 'me')).toEqual([
      'status',
      'resolve',
      'falseAlarm',
    ]);
  });

  it.each<IncidentState>(['ACKNOWLEDGED', 'RESPONDING'])(
    'leaves another member only the false alarm while %s',
    (state) => {
      expect(actionsFor(incident(state, 'other'), 'me')).toEqual(['falseAlarm']);
    },
  );

  it.each<IncidentState>(['DETECTED', 'UNROUTED', 'RESOLVED', 'FALSE_ALARM', 'CLOSED'])(
    'is read-only while %s',
    (state) => {
      expect(actionsFor(incident(state), 'me')).toEqual([]);
    },
  );
});

describe('deadlineOf', () => {
  it('names the acknowledge deadline, then the status deadline, else none', () => {
    expect(
      deadlineOf({ ...incident('NOTIFY_PRIMARY'), tierDeadlineAt: '2026-10-29T03:17:00Z' }),
    ).toMatch(/^Acknowledge by /);
    expect(
      deadlineOf({ ...incident('ACKNOWLEDGED'), statusDueAt: '2026-10-29T03:47:00Z' }),
    ).toMatch(/^Next update by /);
    expect(deadlineOf(incident('RESOLVED'))).toBe('No pending deadline');
  });
});
