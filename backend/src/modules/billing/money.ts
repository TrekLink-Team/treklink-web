import { Prisma } from '@prisma/client';

// Money in integer VND (billing task 1.2, REQ-UBI-01, BR-29). Amounts are `bigint` and never stored
// as a floating number; ratios and premiums are `Prisma.Decimal`, as the contract snapshot holds them.

type DecimalInput = Prisma.Decimal | string | number | bigint;

const decimal = (value: DecimalInput): Prisma.Decimal =>
  new Prisma.Decimal(typeof value === 'bigint' ? value.toString() : value);

const DAYS_PER_MONTH = 30;

// Rounds a non-negative amount up to the whole đồng: every line is rounded up on its own.
export const ceilVnd = (amount: DecimalInput): bigint => {
  const value = decimal(amount);
  if (value.isNegative()) throw new RangeError('An amount to round must not be negative.');
  return BigInt(value.ceil().toFixed(0));
};

// The full fee of one monthly term: the monthly unit price times the quantity (FR-BILL-01, BR-06).
export const termFeeVnd = (monthlyUnitPriceVnd: bigint, quantity: number): bigint =>
  monthlyUnitPriceVnd * BigInt(quantity);

// The holding fee due at the term start: ⌈ratio × P × q⌉ (billing design §2).
export const holdingFeeVnd = (
  monthlyUnitPriceVnd: bigint,
  quantity: number,
  holdingFeeRatio: DecimalInput,
): bigint =>
  ceilVnd(decimal(termFeeVnd(monthlyUnitPriceVnd, quantity)).mul(decimal(holdingFeeRatio)));

// The day-plan fee: ⌈P ÷ 30 × premium × days × q⌉ (FR-BILL-02, BR-07). The division runs last, so a
// whole result stays exact and rounding never lifts it by one đồng.
export const dayPlanFeeVnd = (
  monthlyUnitPriceVnd: bigint,
  dayPremium: DecimalInput,
  days: number,
  quantity: number,
): bigint =>
  ceilVnd(
    decimal(monthlyUnitPriceVnd)
      .mul(decimal(dayPremium))
      .mul(days)
      .mul(quantity)
      .div(DAYS_PER_MONTH),
  );

// A monthly service credit: ⌈P × outageDays ÷ termDays⌉, at most P, the unit's share of one term
// (design §9.2, D-092 rule 5). The division runs last, as in the day-plan fee.
export const monthlyCreditVnd = (
  monthlyUnitPriceVnd: bigint,
  outageDays: number,
  termDays: number,
): bigint => {
  const credit = ceilVnd(decimal(monthlyUnitPriceVnd).mul(outageDays).div(termDays));
  return credit < monthlyUnitPriceVnd ? credit : monthlyUnitPriceVnd;
};

// A day-plan service credit: ⌈P ÷ 30 × premium × outageDays⌉, at most the unit's day-plan fee.
export const dayPlanCreditVnd = (
  monthlyUnitPriceVnd: bigint,
  dayPremium: DecimalInput,
  outageDays: number,
  dayPlanDays: number,
): bigint => {
  const credit = dayPlanFeeVnd(monthlyUnitPriceVnd, dayPremium, outageDays, 1);
  const fee = dayPlanFeeVnd(monthlyUnitPriceVnd, dayPremium, dayPlanDays, 1);
  return credit < fee ? credit : fee;
};
