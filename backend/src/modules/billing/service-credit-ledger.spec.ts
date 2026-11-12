import { InvoiceLineType, Prisma, ServiceCreditCause, ServiceCreditStatus } from '@prisma/client';
import { DevicesService } from '../devices';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { InvoiceRow, InvoicesRepository, NewInvoiceLine } from './invoices.repository';
import { ServiceCreditLedger } from './service-credit-ledger';
import { ServiceCreditRow, ServiceCreditsRepository } from './service-credits.repository';

const TX = {} as Prisma.TransactionClient;
const AT = new Date('2026-11-01T00:00:00.000Z');

const approved = (overrides: Partial<ServiceCreditRow>): ServiceCreditRow =>
  ({
    id: 'sc-1',
    contractId: 'c-1',
    organizationId: 'org-1',
    deviceId: 'dev-1',
    cause: ServiceCreditCause.BATTERY_FAULT,
    decidedVnd: 45_000n,
    appliedVnd: 0n,
    status: ServiceCreditStatus.APPROVED,
    decidedById: 'admin-1',
    ...overrides,
  }) as ServiceCreditRow;

const build = (waiting: ServiceCreditRow[]) => {
  const credits = {
    approvedWithRemainder: jest.fn().mockResolvedValue(waiting),
    update: jest.fn((id: string, data: Record<string, unknown>) =>
      Promise.resolve({ ...waiting.find((c) => c.id === id), ...data }),
    ),
  };
  const invoices = {
    // appendLines adds the line amounts to the total, as the repository does
    appendLines: jest.fn((invoice: InvoiceRow, lines: NewInvoiceLine[]) =>
      Promise.resolve({
        ...invoice,
        totalVnd: lines.reduce((sum, line) => sum + line.amountVnd, invoice.totalVnd),
      }),
    ),
  };
  const devices = { assetTags: jest.fn().mockResolvedValue(new Map([['dev-1', 'TL-0001']])) };
  const events = { emitAfterCommit: jest.fn() };
  const ledger = new ServiceCreditLedger(
    credits as unknown as ServiceCreditsRepository,
    invoices as unknown as InvoicesRepository,
    devices as unknown as DevicesService,
    events as unknown as TransactionalEvents,
  );
  return { ledger, credits, invoices, events };
};

const invoice = (totalVnd: bigint, paidVnd = 0n) =>
  ({ id: 'inv-2', totalVnd, paidVnd }) as unknown as InvoiceRow;

describe('ServiceCreditLedger.land (design §9.3, REQ-EVT-14)', () => {
  it('AC-06: lands the whole credit as one negative line and marks it APPLIED', async () => {
    const { ledger, credits, invoices, events } = build([approved({})]);
    const after = await ledger.land('c-1', invoice(450_000n), TX, AT);

    expect(invoices.appendLines).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inv-2' }),
      [
        expect.objectContaining({
          type: InvoiceLineType.SERVICE_CREDIT,
          description: 'Service credit for TL-0001: BATTERY_FAULT',
          amountVnd: -45_000n,
          unitVnd: -45_000n,
          serviceCreditId: 'sc-1',
          createdById: 'admin-1',
        }),
      ],
      TX,
    );
    expect(after.totalVnd).toBe(405_000n);
    expect(credits.update).toHaveBeenCalledWith(
      'sc-1',
      { appliedVnd: 45_000n, status: ServiceCreditStatus.APPLIED },
      TX,
    );
    expect(events.emitAfterCommit).toHaveBeenCalledWith(
      AUDIT_RECORD,
      expect.objectContaining({ action: 'serviceCredit.applied', actorId: null }),
    );
  });

  it('lands only what brings the unpaid amount to zero and keeps the rest APPROVED', async () => {
    const { ledger, credits, invoices } = build([approved({ decidedVnd: 100_000n })]);
    const after = await ledger.land('c-1', invoice(80_000n, 20_000n), TX, AT);

    expect(invoices.appendLines).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({ amountVnd: -60_000n })],
      TX,
    );
    expect(after.totalVnd - after.paidVnd).toBe(0n);
    expect(credits.update).toHaveBeenCalledWith(
      'sc-1',
      { appliedVnd: 60_000n, status: ServiceCreditStatus.APPROVED },
      TX,
    );
  });

  it('returns the invoice unchanged and reads no asset tag when no credit waits', async () => {
    const { ledger, invoices, events } = build([]);
    const given = invoice(45_000n);
    await expect(ledger.land('c-1', given, TX, AT)).resolves.toBe(given);
    expect(invoices.appendLines).not.toHaveBeenCalled();
    expect(events.emitAfterCommit).not.toHaveBeenCalled();
  });

  it('skips a credit with nothing left to land and lands the next one', async () => {
    const { ledger, credits, invoices } = build([
      approved({ id: 'sc-done', decidedVnd: 20_000n, appliedVnd: 20_000n }),
      approved({ id: 'sc-undecided', decidedVnd: null }),
      approved({ id: 'sc-next', decidedVnd: 10_000n }),
    ]);
    await ledger.land('c-1', invoice(45_000n), TX, AT);
    expect(invoices.appendLines).toHaveBeenCalledTimes(1);
    expect(invoices.appendLines).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({ amountVnd: -10_000n, serviceCreditId: 'sc-next' })],
      TX,
    );
    expect(credits.update).toHaveBeenCalledTimes(1);
  });

  it('names the device by id when it has no asset tag, for service and release credits', async () => {
    const { ledger, invoices } = build([
      approved({ id: 'sc-1', deviceId: 'dev-9', decidedVnd: 5_000n }),
      approved({ id: 'sc-2', deviceId: 'dev-9', decidedVnd: 5_000n, kind: 'RELEASE' }),
    ]);
    await ledger.land('c-1', invoice(45_000n), TX, AT);
    expect(invoices.appendLines).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      [
        expect.objectContaining({
          type: InvoiceLineType.SERVICE_CREDIT,
          description: 'Service credit for dev-9: BATTERY_FAULT',
        }),
      ],
      TX,
    );
    expect(invoices.appendLines).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      [
        expect.objectContaining({
          type: InvoiceLineType.EARLY_END_CREDIT,
          description: 'Release credit for dev-9',
        }),
      ],
      TX,
    );
  });

  it('lands a remainder later, and nothing on an invoice already paid', async () => {
    const { ledger, credits, invoices } = build([
      approved({ id: 'sc-1', decidedVnd: 100_000n, appliedVnd: 60_000n }),
      approved({ id: 'sc-2', decidedVnd: 10_000n }),
    ]);
    await ledger.land('c-1', invoice(45_000n), TX, AT);
    expect(invoices.appendLines).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      [expect.objectContaining({ amountVnd: -40_000n, serviceCreditId: 'sc-1' })],
      TX,
    );
    expect(invoices.appendLines).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      [expect.objectContaining({ amountVnd: -5_000n, serviceCreditId: 'sc-2' })],
      TX,
    );
    expect(credits.update).toHaveBeenCalledWith(
      'sc-1',
      { appliedVnd: 100_000n, status: ServiceCreditStatus.APPLIED },
      TX,
    );

    const paid = build([approved({})]);
    await paid.ledger.land('c-1', invoice(45_000n, 45_000n), TX, AT);
    expect(paid.invoices.appendLines).not.toHaveBeenCalled();
    expect(paid.credits.update).not.toHaveBeenCalled();
  });
});
