import { describe, expect, it } from 'vitest';
import {
  filterErrors,
  filtersOf,
  fromLocalInput,
  hasFilters,
  pageOf,
  paramsOf,
  snapshotText,
  toLocalInput,
} from './model';

const ACTOR = '3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f';

describe('the filters and the URL (screen 7.4)', () => {
  it('reads the seven filters from the query and drops blanks', () => {
    const params = new URLSearchParams(
      `actorId=${ACTOR}&organizationId=o-1&subjectType=RentalContract&subjectId=c-1&action=contract.&from=2026-10-01T00:00:00.000Z&to=&page=2`,
    );
    expect(filtersOf(params)).toEqual({
      actorId: ACTOR,
      organizationId: 'o-1',
      subjectType: 'RentalContract',
      subjectId: 'c-1',
      action: 'contract.',
      from: '2026-10-01T00:00:00.000Z',
    });
  });

  it('writes only the filters that are set, never the page', () => {
    const params = paramsOf({ action: 'parameter.', subjectId: ' key ', actorId: '' });
    expect(params.toString()).toBe('subjectId=key&action=parameter.');
  });

  it('reads a page number, and falls back to the first page for anything else', () => {
    expect(pageOf(new URLSearchParams('page=3'))).toBe(3);
    for (const bad of ['page=0', 'page=-1', 'page=x', 'page=1.5', '']) {
      expect(pageOf(new URLSearchParams(bad))).toBe(1);
    }
  });

  it('knows whether any filter is set', () => {
    expect(hasFilters({})).toBe(false);
    expect(hasFilters({ action: 'x' })).toBe(true);
  });
});

describe('filterErrors', () => {
  it('accepts a UUID actor and an end after the start', () => {
    expect(
      filterErrors({ actorId: ACTOR, from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' }),
    ).toEqual({});
  });

  it('refuses an actor that is not a UUID', () => {
    expect(filterErrors({ actorId: 'staff-a' })).toEqual({ actorId: 'Actor id must be a UUID.' });
  });

  it('refuses an end that is not after the start, and accepts one open end', () => {
    const message = { to: 'Choose an end after the start.' };
    expect(filterErrors({ from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' })).toEqual(message);
    expect(filterErrors({ from: '2026-10-01T00:00:00Z', to: '2026-10-01T00:00:00Z' })).toEqual(message);
    expect(filterErrors({ from: '2026-10-01T00:00:00Z' })).toEqual({});
  });
});

describe('local time inputs', () => {
  it('round-trips an instant through a datetime-local value to the minute', () => {
    const iso = '2026-10-20T03:15:00.000Z';
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
  });

  it('gives an empty value for nothing or for text that is not a date', () => {
    expect(toLocalInput(undefined)).toBe('');
    expect(toLocalInput('soon')).toBe('');
    expect(fromLocalInput('')).toBeUndefined();
    expect(fromLocalInput('soon')).toBeUndefined();
  });
});

describe('snapshotText', () => {
  it('indents an object and shows a dash for no snapshot', () => {
    expect(snapshotText({ status: 'APPROVED' })).toBe('{\n  "status": "APPROVED"\n}');
    expect(snapshotText(null)).toBe('–');
    expect(snapshotText(undefined)).toBe('–');
  });
});
