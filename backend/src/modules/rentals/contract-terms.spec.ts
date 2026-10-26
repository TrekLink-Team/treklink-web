import { PlanType } from '@prisma/client';
import { addMonths, firstTerm, termStartOf } from './contract-terms';

describe('contract terms (rentals design §3)', () => {
  it('starts a term at 09:00 UTC+7 on the requested start date', () => {
    expect(termStartOf(new Date('2026-11-01T00:00:00.000Z')).toISOString()).toBe(
      '2026-11-01T02:00:00.000Z',
    );
  });

  it('adds calendar months and keeps the last day of a shorter month', () => {
    expect(addMonths(new Date('2026-10-25T02:00:00.000Z'), 1).toISOString()).toBe(
      '2026-11-25T02:00:00.000Z',
    );
    expect(addMonths(new Date('2027-01-31T02:00:00.000Z'), 1).toISOString()).toBe(
      '2027-02-28T02:00:00.000Z',
    );
    expect(addMonths(new Date('2026-12-15T02:00:00.000Z'), 1).toISOString()).toBe(
      '2027-01-15T02:00:00.000Z',
    );
  });

  it('gives a monthly plan one calendar month and a day plan its length', () => {
    const day = new Date('2026-11-01T00:00:00.000Z');
    expect(
      firstTerm({ planType: PlanType.MONTHLY, dayPlanDays: null, requestedStartDate: day }),
    ).toEqual({
      startsAt: new Date('2026-11-01T02:00:00.000Z'),
      endsAt: new Date('2026-12-01T02:00:00.000Z'),
    });
    expect(
      firstTerm({ planType: PlanType.DAY, dayPlanDays: 4, requestedStartDate: day }).endsAt,
    ).toEqual(new Date('2026-11-05T02:00:00.000Z'));
  });
});
