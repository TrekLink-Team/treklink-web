import { Injectable } from '@nestjs/common';
import { InvoiceKind, InvoiceLineType, InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

const HOUR_MS = 3_600_000;
// Invoice numbers count by the calendar year of issue in Vietnam (UTC+7), as contract codes do.
const NUMBER_ZONE_OFFSET_MS = 7 * HOUR_MS;
const NUMBER_MAX = 999_999;

export const INVOICE_SELECT = {
  id: true,
  number: true,
  organizationId: true,
  contractId: true,
  termId: true,
  kind: true,
  status: true,
  totalVnd: true,
  paidVnd: true,
  issuedAt: true,
} satisfies Prisma.InvoiceSelect;

export type InvoiceRow = Prisma.InvoiceGetPayload<{ select: typeof INVOICE_SELECT }>;

export const LINE_SELECT = {
  id: true,
  invoiceId: true,
  seq: true,
  type: true,
  amountVnd: true,
  paidVnd: true,
  dueAt: true,
} satisfies Prisma.InvoiceLineSelect;

export type LineRow = Prisma.InvoiceLineGetPayload<{ select: typeof LINE_SELECT }>;

export type InvoiceWithLines = InvoiceRow & { lines: LineRow[] };

export const DETAIL_LINE_SELECT = {
  seq: true,
  type: true,
  description: true,
  quantity: true,
  unitVnd: true,
  amountVnd: true,
  dueAt: true,
  paidVnd: true,
} satisfies Prisma.InvoiceLineSelect;

export type DetailLineRow = Prisma.InvoiceLineGetPayload<{ select: typeof DETAIL_LINE_SELECT }>;

export type InvoiceDetailRow = InvoiceRow & { lines: DetailLineRow[] };

export interface InvoiceFilter {
  organizationId?: string;
  contractId?: string;
  status?: InvoiceStatus;
  // Only invoices with an unpaid line due before this instant.
  overdueAt?: Date;
}

export interface NewInvoice {
  organizationId: string;
  contractId: string;
  termId: string | null;
  kind: InvoiceKind;
  issuedAt: Date;
}

export interface NewInvoiceLine {
  type: InvoiceLineType;
  description: string;
  // The device a late, damage or loss line charges for; absent on plan lines.
  deviceId?: string;
  quantity: number;
  unitVnd: bigint;
  amountVnd: bigint;
  dueAt: Date;
  createdById: string | null;
}

export const invoiceNumberYear = (at: Date): number =>
  new Date(at.getTime() + NUMBER_ZONE_OFFSET_MS).getUTCFullYear();

// An invoice is PAID once its payments cover its total, which a closing invoice holding only a
// negative adjustment does at once.
export const invoiceStatusOf = (totalVnd: bigint, paidVnd: bigint): InvoiceStatus => {
  if (paidVnd >= totalVnd) return InvoiceStatus.PAID;
  return paidVnd > 0n ? InvoiceStatus.PARTIALLY_PAID : InvoiceStatus.ISSUED;
};

const sumAmounts = (lines: readonly NewInvoiceLine[]): bigint =>
  lines.reduce((total, line) => total + line.amountVnd, 0n);

// The only class of `billing` that touches Invoice and InvoiceLine (D-044 rule 4, billing task 1.1).
@Injectable()
export class InvoicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Issues an invoice with its numbered lines (seq from 1) under the next INV-<year>-NNNNNN.
  async insert(
    invoice: NewInvoice,
    lines: readonly NewInvoiceLine[],
    tx: Prisma.TransactionClient,
  ): Promise<InvoiceRow> {
    const number = await this.nextNumber(invoice.issuedAt, tx);
    const totalVnd = sumAmounts(lines);
    return tx.invoice.create({
      data: {
        ...invoice,
        number,
        totalVnd,
        status: invoiceStatusOf(totalVnd, 0n),
        lines: { create: lines.map((line, index) => ({ ...line, seq: index + 1 })) },
      },
      select: INVOICE_SELECT,
    });
  }

  // Serializes closing-invoice work per contract, then returns its closing invoice or null, so two
  // transactions can never both create one (design §1: one CLOSING invoice per contract).
  // The LOSS line charged for a device on the contract's closing invoice (billing 2.6), or null.
  lossLine(contractId: string, deviceId: string, tx: Prisma.TransactionClient) {
    return tx.invoiceLine.findFirst({
      where: {
        type: InvoiceLineType.LOSS,
        deviceId,
        invoice: { contractId, kind: InvoiceKind.CLOSING },
      },
      select: { id: true, amountVnd: true },
    });
  }

  async lockClosingInvoice(
    contractId: string,
    tx: Prisma.TransactionClient,
  ): Promise<InvoiceRow | null> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:closing:${contractId}`}))`;
    return tx.invoice.findFirst({
      where: { contractId, kind: InvoiceKind.CLOSING },
      select: INVOICE_SELECT,
    });
  }

  // Appends lines to an open closing invoice after its last seq; issued lines are never changed
  // (REQ-UBI-02). Call under lockClosingInvoice.
  async appendLines(
    invoice: InvoiceRow,
    lines: readonly NewInvoiceLine[],
    tx: Prisma.TransactionClient,
  ): Promise<InvoiceRow> {
    const last = await tx.invoiceLine.aggregate({
      where: { invoiceId: invoice.id },
      _max: { seq: true },
    });
    const start = (last._max.seq ?? 0) + 1;
    await tx.invoiceLine.createMany({
      data: lines.map((line, index) => ({ ...line, invoiceId: invoice.id, seq: start + index })),
    });
    const totalVnd = invoice.totalVnd + sumAmounts(lines);
    return tx.invoice.update({
      where: { id: invoice.id },
      data: { totalVnd, status: invoiceStatusOf(totalVnd, invoice.paidVnd) },
      select: INVOICE_SELECT,
    });
  }

  // Locks the invoice row for the rest of the transaction, so concurrent payments on one invoice
  // apply one after the other (billing task 3.1), and returns it with its lines oldest due first;
  // null when it does not exist.
  async lockWithLines(
    invoiceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<InvoiceWithLines | null> {
    await tx.$queryRaw`SELECT 1 FROM "invoices" WHERE "id" = ${invoiceId} FOR UPDATE`;
    return tx.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        ...INVOICE_SELECT,
        lines: { select: LINE_SELECT, orderBy: [{ dueAt: 'asc' }, { seq: 'asc' }] },
      },
    });
  }

  // Applies an amount to the invoice's unpaid lines, oldest due first, and moves the invoice's paid
  // total and status. Call under lockWithLines; the caller checks the amount is at most what is due.
  async applyPayment(
    invoice: InvoiceWithLines,
    amountVnd: bigint,
    tx: Prisma.TransactionClient,
  ): Promise<InvoiceRow> {
    let left = amountVnd;
    for (const line of invoice.lines) {
      const unpaid = line.amountVnd - line.paidVnd;
      if (left === 0n || unpaid <= 0n) continue;
      const applied = unpaid < left ? unpaid : left;
      await tx.invoiceLine.update({
        where: { id: line.id },
        data: { paidVnd: line.paidVnd + applied },
      });
      left -= applied;
    }
    const paidVnd = invoice.paidVnd + amountVnd;
    return tx.invoice.update({
      where: { id: invoice.id },
      data: { paidVnd, status: invoiceStatusOf(invoice.totalVnd, paidVnd) },
      select: INVOICE_SELECT,
    });
  }

  // The contract's first TERM or DAY_PLAN invoice, the one its first payment pays, with its lines.
  firstChargeableInvoice(
    contractId: string,
    client: Client = this.prisma,
  ): Promise<InvoiceWithLines | null> {
    return client.invoice.findFirst({
      where: { contractId, kind: { in: [InvoiceKind.TERM, InvoiceKind.DAY_PLAN] } },
      orderBy: [{ issuedAt: 'asc' }, { number: 'asc' }],
      select: { ...INVOICE_SELECT, lines: { select: LINE_SELECT, orderBy: { seq: 'asc' } } },
    });
  }

  // Every line of every invoice of the contract, oldest due first.
  linesOfContract(contractId: string, client: Client = this.prisma): Promise<LineRow[]> {
    return client.invoiceLine.findMany({
      where: { invoice: { contractId } },
      orderBy: [{ dueAt: 'asc' }, { seq: 'asc' }],
      select: LINE_SELECT,
    });
  }

  // Every line of every invoice of the organization with the contract it belongs to, oldest due first
  // (the reactivation check of `organizations`).
  // The contracts an organization has been invoiced for, from billing's own table, so the reactivation
  // check finds the damage charges still waiting for an Admin without reading `rentals` (task 1.3).
  async contractIdsOfOrganization(
    organizationId: string,
    client: Client = this.prisma,
  ): Promise<string[]> {
    const rows = await client.invoice.findMany({
      where: { organizationId },
      distinct: ['contractId'],
      select: { contractId: true },
    });
    return rows.map((row) => row.contractId);
  }

  linesOfOrganization(organizationId: string, client: Client = this.prisma) {
    return client.invoiceLine.findMany({
      where: { invoice: { organizationId } },
      orderBy: [{ dueAt: 'asc' }, { seq: 'asc' }],
      select: { ...LINE_SELECT, invoice: { select: { contractId: true } } },
    });
  }

  // A page of invoices, newest first (api-design 08). `overdue` keeps invoices with a line past its
  // due time and not fully paid.
  async page(
    filter: InvoiceFilter,
    skip: number,
    take: number,
    client: Client = this.prisma,
  ): Promise<[InvoiceRow[], number]> {
    const where: Prisma.InvoiceWhereInput = {
      ...(filter.organizationId ? { organizationId: filter.organizationId } : {}),
      ...(filter.contractId ? { contractId: filter.contractId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.overdueAt
        ? {
            lines: {
              some: {
                dueAt: { lt: filter.overdueAt },
                paidVnd: { lt: this.prisma.invoiceLine.fields.amountVnd },
              },
            },
          }
        : {}),
    };
    return Promise.all([
      client.invoice.findMany({
        where,
        orderBy: [{ issuedAt: 'desc' }, { number: 'desc' }],
        skip,
        take,
        select: INVOICE_SELECT,
      }),
      client.invoice.count({ where }),
    ]);
  }

  // The invoice with its dated lines in seq order (api-design 09); null when it does not exist.
  detail(id: string, client: Client = this.prisma): Promise<InvoiceDetailRow | null> {
    return client.invoice.findUnique({
      where: { id },
      select: { ...INVOICE_SELECT, lines: { select: DETAIL_LINE_SELECT, orderBy: { seq: 'asc' } } },
    });
  }

  // The organization of any invoice of the contract, or null when none was issued yet. The balance
  // read uses it for the scoped 404 rule.
  async organizationOfContract(
    contractId: string,
    client: Client = this.prisma,
  ): Promise<string | null> {
    const invoice = await client.invoice.findFirst({
      where: { contractId },
      select: { organizationId: true },
    });
    return invoice?.organizationId ?? null;
  }

  // INV-<year>-<6 digits>, serialized per year as the contract code is.
  private async nextNumber(at: Date, tx: Prisma.TransactionClient): Promise<string> {
    const year = invoiceNumberYear(at);
    const prefix = `INV-${year}-`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:invoice:${year}`}))`;
    const latest = await tx.invoice.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const sequence = latest ? Number(latest.number.slice(prefix.length)) + 1 : 1;
    if (sequence > NUMBER_MAX) throw new RangeError(`Invoice number range exhausted for ${year}.`);
    return `${prefix}${String(sequence).padStart(6, '0')}`;
  }
}
