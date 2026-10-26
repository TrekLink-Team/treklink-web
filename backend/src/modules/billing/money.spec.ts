import { Prisma } from '@prisma/client';
import { ceilVnd, dayPlanFeeVnd, holdingFeeVnd, termFeeVnd } from './money';

describe('money helpers (billing task 1.2, REQ-UBI-01)', () => {
  it('rounds up to the whole đồng and keeps a whole amount', () => {
    expect(ceilVnd('2250000')).toBe(2_250_000n);
    expect(ceilVnd('0.01')).toBe(1n);
    expect(ceilVnd(new Prisma.Decimal('1234.5'))).toBe(1235n);
    expect(ceilVnd(7n)).toBe(7n);
    expect(ceilVnd(0)).toBe(0n);
  });

  it('refuses a negative amount', () => {
    expect(() => ceilVnd('-1')).toThrow('An amount to round must not be negative.');
  });

  it('AC-01: 10 v3 devices at 450,000 VND give a 4,500,000 term with a 2,250,000 holding fee', () => {
    expect(termFeeVnd(450_000n, 10)).toBe(4_500_000n);
    expect(holdingFeeVnd(450_000n, 10, new Prisma.Decimal('0.5'))).toBe(2_250_000n);
  });

  it('rounds a holding fee of an odd amount up', () => {
    expect(holdingFeeVnd(450_001n, 1, '0.5')).toBe(225_001n);
    expect(holdingFeeVnd(100_000n, 1, '0.333')).toBe(33_300n);
  });

  it('AC-02: a 4-day plan of 8 devices at premium 1.5 costs 720,000 VND', () => {
    expect(dayPlanFeeVnd(450_000n, new Prisma.Decimal('1.5'), 4, 8)).toBe(720_000n);
  });

  it('keeps a whole day-plan fee exact when the per-day rate does not divide evenly', () => {
    // 400,000 ÷ 30 is not whole, but 400,000 × 1.5 × 4 × 8 ÷ 30 is exactly 640,000.
    expect(dayPlanFeeVnd(400_000n, '1.5', 4, 8)).toBe(640_000n);
    expect(dayPlanFeeVnd(400_000n, '1', 3, 1)).toBe(40_000n);
    expect(dayPlanFeeVnd(100_001n, '1', 1, 1)).toBe(3_334n);
  });
});
