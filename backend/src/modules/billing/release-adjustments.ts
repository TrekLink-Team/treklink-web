import { InvoiceLineType } from '@prisma/client';

export const RELEASE_ADJUSTMENT_PREFIX = 'Release of one unit: ';

type InvoiceAmount = {
  invoiceId?: string;
  type: InvoiceLineType;
  description: string;
  amountVnd: bigint;
  dueAt: Date;
};

// A release adjustment has the same due date as the fee it lowers. Term start and term end have
// separate fees, and a day-plan invoice has one fee. Keep the original amounts on the ledger.
export const netUnitReleaseAdjustments = <T extends InvoiceAmount>(lines: readonly T[]): T[] => {
  const keyOf = (line: InvoiceAmount) => `${line.invoiceId ?? ''}:${line.dueAt.getTime()}`;
  const isReleaseAdjustment = (line: InvoiceAmount) =>
    line.type === InvoiceLineType.ADJUSTMENT &&
    line.description.startsWith(RELEASE_ADJUSTMENT_PREFIX);
  const isFee = (line: InvoiceAmount) =>
    line.type === InvoiceLineType.HOLDING_FEE ||
    line.type === InvoiceLineType.TERM_BALANCE ||
    line.type === InvoiceLineType.DAY_PLAN_FEE;
  const feeKeys = new Set(lines.filter(isFee).map(keyOf));
  const adjustments = new Map<string, bigint>();
  for (const line of lines) {
    if (!isReleaseAdjustment(line)) continue;
    const key = keyOf(line);
    if (feeKeys.has(key)) adjustments.set(key, (adjustments.get(key) ?? 0n) + line.amountVnd);
  }
  return lines.map((line) => {
    const adjustment = adjustments.get(keyOf(line));
    if (adjustment === undefined) return line;
    if (isReleaseAdjustment(line)) return { ...line, amountVnd: 0n };
    return isFee(line) ? { ...line, amountVnd: line.amountVnd + adjustment } : line;
  });
};
