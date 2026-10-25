import { Injectable } from '@nestjs/common';
import { InvoiceKind, InvoiceLineType, Prisma } from '@prisma/client';
import { InvoiceRow, InvoicesRepository, LineRow, NewInvoiceLine } from './invoices.repository';

export interface ChargedContract {
  id: string;
  organizationId: string;
}

const unpaidOf = (lines: readonly LineRow[]): bigint =>
  lines.reduce(
    (total, line) =>
      line.amountVnd > line.paidVnd ? total + line.amountVnd - line.paidVnd : total,
    0n,
  );

// Charges outside the plan, on the contract's closing invoice (billing design §1 and §2). Task 2.3:
// the cancellation adjustment. Late, damage and loss charges (2.5, 2.6) join this service later.
@Injectable()
export class ChargesService {
  constructor(private readonly invoices: InvoicesRepository) {}

  // A contract cancelled before handover (REQ-EVT-11, FR-CON-04, E01-7): the unpaid lines of its
  // first invoice are voided by one ADJUSTMENT line of the opposite amount on the closing invoice,
  // so the balance nets to zero while a paid holding fee stays paid and retained. Issued lines never
  // change (REQ-UBI-02). Returns the closing invoice, or null when nothing was unpaid or no invoice
  // was issued yet (a cancellation from REQUESTED). `actorId` is null for SYSTEM.
  async settleCancellation(
    contract: ChargedContract,
    actorId: string | null,
    tx: Prisma.TransactionClient,
    at: Date = new Date(),
  ): Promise<InvoiceRow | null> {
    const first = await this.invoices.firstChargeableInvoice(contract.id, tx);
    if (!first) return null;
    const unpaid = unpaidOf(first.lines);
    if (unpaid === 0n) return null;

    const adjustment: NewInvoiceLine = {
      type: InvoiceLineType.ADJUSTMENT,
      description: `Cancellation before handover: voids the unpaid lines of ${first.number}`,
      quantity: 1,
      unitVnd: -unpaid,
      amountVnd: -unpaid,
      dueAt: at,
      createdById: actorId,
    };
    const closing = await this.invoices.lockClosingInvoice(contract.id, tx);
    if (closing) return this.invoices.appendLines(closing, [adjustment], tx);
    return this.invoices.insert(
      {
        organizationId: contract.organizationId,
        contractId: contract.id,
        termId: null,
        kind: InvoiceKind.CLOSING,
        issuedAt: at,
      },
      [adjustment],
      tx,
    );
  }
}
