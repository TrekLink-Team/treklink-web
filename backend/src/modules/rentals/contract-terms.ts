import { PlanType } from '@prisma/client';
import { CODE_ZONE_OFFSET_MS } from './contracts.repository';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
// Terms start at 09:00 in Vietnam (UTC+7) on the requested start date (design §3).
const TERM_START_HOUR_LOCAL = 9;

// 09:00 UTC+7 on a calendar date that Prisma reads from a @db.Date column as UTC midnight.
export const termStartOf = (day: Date): Date =>
  new Date(day.getTime() + TERM_START_HOUR_LOCAL * HOUR_MS - CODE_ZONE_OFFSET_MS);

// The same time `months` calendar months later; a day the target month lacks becomes its last day,
// so 31 January plus one month is 28 or 29 February.
export const addMonths = (at: Date, months: number): Date => {
  const target = new Date(at.getTime());
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
};

// Term 1 of a contract: one calendar month for a monthly plan, the plan length for a day plan.
export const firstTerm = (contract: {
  planType: PlanType;
  dayPlanDays: number | null;
  requestedStartDate: Date;
}): { startsAt: Date; endsAt: Date } => {
  const startsAt = termStartOf(contract.requestedStartDate);
  const endsAt =
    contract.planType === PlanType.DAY
      ? new Date(startsAt.getTime() + (contract.dayPlanDays ?? 0) * DAY_MS)
      : addMonths(startsAt, 1);
  return { startsAt, endsAt };
};
