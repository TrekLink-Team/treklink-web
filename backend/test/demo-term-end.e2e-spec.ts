import { rolloverTermEnd } from '../prisma/demo-term-end';
import { latestRentalDailyCutoff } from '../src/modules/rentals/rental-daily-cutoff';

// demo:term-end (MF-05) must end the term where rentals.termRollover picks it up: the job takes only
// terms due by the latest daily cutoff, so a term ending a minute before "now" waited for the next
// batch and the script printed "0 to RETURN_DUE".
describe('demo:term-end rolloverTermEnd', () => {
  it('ends the term a minute before the batch of the same local day', () => {
    // 20:47 in UTC+7, batch hour 9 local: today's batch ran at 02:00 UTC.
    const now = new Date('2026-10-30T13:47:00.000Z');
    expect(rolloverTermEnd(now, 9).toISOString()).toBe('2026-10-30T01:59:00.000Z');
  });

  it("uses yesterday's batch before the batch hour", () => {
    // 08:00 in UTC+7, before the 09:00 batch.
    const now = new Date('2026-10-30T01:00:00.000Z');
    expect(rolloverTermEnd(now, 9).toISOString()).toBe('2026-10-29T01:59:00.000Z');
  });

  it('is always due for the job run at the same moment, and never in the future', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const now = new Date(Date.UTC(2026, 10, 1, hour, 30));
      const endsAt = rolloverTermEnd(now, 9);
      expect(endsAt.getTime()).toBeLessThan(latestRentalDailyCutoff(now, 9).getTime());
      expect(endsAt.getTime()).toBeLessThan(now.getTime());
    }
  });
});
