import { Injectable } from '@nestjs/common';
import { InvoiceLineType, Prisma, ServiceCreditKind, ServiceCreditStatus } from '@prisma/client';
import { DevicesService } from '../devices';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { InvoiceRow, InvoicesRepository } from './invoices.repository';
import { ServiceCreditsRepository } from './service-credits.repository';

// Lands decided service credits on an invoice as negative SERVICE_CREDIT lines (design §9.3, task
// 8.1). A credit lands only the part that brings the invoice's unpaid amount to zero; the rest stays
// owed on the credit for the next invoice, or becomes REFUND_DUE at the close (build ruling of
// 2026-11-02). Every part is a new line; no line is ever changed (REQ-UBI-02).
@Injectable()
export class ServiceCreditLedger {
  constructor(
    private readonly credits: ServiceCreditsRepository,
    private readonly invoices: InvoicesRepository,
    private readonly devices: DevicesService,
    private readonly events: TransactionalEvents,
  ) {}

  // Lands the contract's APPROVED remainders on `invoice`, oldest decision first, and returns the
  // invoice as it stands after. The caller holds the invoice (a new term invoice, or the closing
  // invoice under its lock). Each part is audited as `serviceCredit.applied` by the system.
  async land(
    contractId: string,
    invoice: InvoiceRow,
    tx: Prisma.TransactionClient,
    at: Date,
  ): Promise<InvoiceRow> {
    const waiting = await this.credits.approvedWithRemainder(contractId, tx);
    if (waiting.length === 0) return invoice;
    const tags = await this.devices.assetTags([...new Set(waiting.map((c) => c.deviceId))], tx);
    let current = invoice;
    for (const credit of waiting) {
      const room = current.totalVnd - current.paidVnd;
      if (room <= 0n) break;
      const remainder = (credit.decidedVnd ?? 0n) - credit.appliedVnd;
      if (remainder <= 0n) continue;
      const part = remainder < room ? remainder : room;
      current = await this.invoices.appendLines(
        current,
        [
          {
            // A release credit is a credit for unused days, so it reads as one (design §12.1).
            type:
              credit.kind === ServiceCreditKind.RELEASE
                ? InvoiceLineType.EARLY_END_CREDIT
                : InvoiceLineType.SERVICE_CREDIT,
            description:
              credit.kind === ServiceCreditKind.RELEASE
                ? `Release credit for ${tags.get(credit.deviceId) ?? credit.deviceId}`
                : `Service credit for ${tags.get(credit.deviceId) ?? credit.deviceId}: ${credit.cause}`,
            deviceId: credit.deviceId,
            quantity: 1,
            unitVnd: -part,
            amountVnd: -part,
            dueAt: at,
            createdById: credit.decidedById,
            serviceCreditId: credit.id,
          },
        ],
        tx,
      );
      const applied = credit.appliedVnd + part;
      const updated = await this.credits.update(
        credit.id,
        {
          appliedVnd: applied,
          status:
            applied === credit.decidedVnd
              ? ServiceCreditStatus.APPLIED
              : ServiceCreditStatus.APPROVED,
        },
        tx,
      );
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: null,
        actorRoles: [],
        organizationId: credit.organizationId,
        action: 'serviceCredit.applied',
        subjectType: 'ServiceCredit',
        subjectId: credit.id,
        before: { status: credit.status, appliedVnd: credit.appliedVnd.toString() },
        after: {
          status: updated.status,
          appliedVnd: updated.appliedVnd.toString(),
          invoiceId: current.id,
          lineVnd: (-part).toString(),
        },
      } satisfies AuditRecordEvent);
    }
    return current;
  }
}
