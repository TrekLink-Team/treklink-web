const DAY_MS = 24 * 60 * 60 * 1000;
const BUSINESS_ZONE_OFFSET_MS = 7 * 60 * 60 * 1000;

// Tomorrow in UTC+7, as the midnight-UTC value of a date column: inside any lead time of a day or more.
// Shared with `prisma/demo-term-end.ts --service-due` (D-088).
export const tomorrowBusinessDay = (now: Date): Date => {
  const local = new Date(now.getTime() + BUSINESS_ZONE_OFFSET_MS);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + DAY_MS,
  );
};
