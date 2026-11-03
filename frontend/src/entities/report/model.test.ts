import { describe, expect, it } from 'vitest';
import type { IncidentTimesRow } from './api';
import {
  addDays,
  csvName,
  dayOf,
  defaultIncidentRow,
  durationText,
  incidentRowName,
  isDay,
  isReportKind,
  lastDaysPeriod,
  monthPeriod,
  periodError,
  REPORT_MAX_DAYS,
  revenueTotals,
} from './model';

const MSG35 = `Choose an end after the start, at most ${REPORT_MAX_DAYS} days later.`;

describe('the report model (screen 9.4)', () => {
  it('knows the five kinds and nothing else', () => {
    expect(isReportKind('incident-times')).toBe(true);
    expect(isReportKind('payroll')).toBe(false);
    expect(isReportKind(null)).toBe(false);
  });

  it('reads a real calendar day only', () => {
    expect(isDay('2026-10-31')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('31/10/2026')).toBe(false);
    expect(isDay(null)).toBe(false);
  });

  it('adds days across a month and a year end', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('nope', 1)).toBe('nope');
  });

  it('gives the current calendar month with an exclusive end, and the month before', () => {
    const now = new Date(2026, 10, 15);
    expect(monthPeriod(now)).toEqual({ from: '2026-11-01', to: '2026-12-01' });
    expect(monthPeriod(now, -1)).toEqual({ from: '2026-10-01', to: '2026-11-01' });
    expect(monthPeriod(new Date(2027, 0, 5), -1)).toEqual({ from: '2026-12-01', to: '2027-01-01' });
  });

  it('gives the last 30 days including today', () => {
    expect(lastDaysPeriod(new Date(2026, 10, 30), 30)).toEqual({
      from: '2026-11-01',
      to: '2026-12-01',
    });
    expect(dayOf(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('accepts a period of one day up to the limit and refuses the rest with MSG35', () => {
    expect(periodError('2026-10-01', '2026-10-01')).toBeNull();
    expect(periodError('2026-10-01', '2026-10-31')).toBeNull();
    expect(periodError('2025-11-02', '2026-11-02')).toBeNull();
    expect(periodError('2025-11-01', '2026-11-02')).toBe(MSG35);
    expect(periodError('2026-10-31', '2026-10-01')).toBe(MSG35);
    expect(periodError('', '2026-10-01')).toBe(MSG35);
    expect(periodError('2026-10-01', '')).toBe(MSG35);
  });

  it('names the file after the kind and the period', () => {
    expect(csvName('revenue', '2026-10-01', '2026-11-01')).toBe(
      'treklink-revenue-2026-10-01-2026-11-01.csv',
    );
  });

  it('shows seconds under a minute and minutes after, and a dash for none', () => {
    expect(durationText(42)).toBe('42 s');
    expect(durationText(59)).toBe('59 s');
    expect(durationText(840)).toBe('14 min');
    expect(durationText(0)).toBe('0 s');
    expect(durationText(null)).toBe('–');
  });

  it('totals the revenue columns', () => {
    expect(
      revenueTotals([
        { variant: 'a', invoicedVnd: 100, paidVnd: 60, outstandingVnd: 40 },
        { variant: null, invoicedVnd: 50, paidVnd: 50, outstandingVnd: 0 },
      ]),
    ).toEqual({ invoicedVnd: 150, paidVnd: 110, outstandingVnd: 40 });
    expect(revenueTotals([])).toEqual({ invoicedVnd: 0, paidVnd: 0, outstandingVnd: 0 });
  });

  describe('the incident row the tiles open on', () => {
    const row = (organization: string | null, incidents: number): IncidentTimesRow => ({
      organization,
      incidents,
      ackMedianSec: 1,
      ackP95Sec: 1,
      resolveMedianSec: 1,
      resolveP95Sec: 1,
    });

    it('prefers the row over every incident', () => {
      const all = row(null, 5);
      expect(defaultIncidentRow([row('A', 3), all, row('B', 2)])).toBe(all);
    });

    it('falls back to the organization with the most incidents, and to nothing for no rows', () => {
      const big = row('B', 9);
      expect(defaultIncidentRow([row('A', 3), big])).toBe(big);
      expect(defaultIncidentRow([])).toBeUndefined();
    });

    it('names the all-incidents row', () => {
      expect(incidentRowName(row(null, 1))).toBe('All organizations');
      expect(incidentRowName(row('ACME', 1))).toBe('ACME');
    });
  });
});
