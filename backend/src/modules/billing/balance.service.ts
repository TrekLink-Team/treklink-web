import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DamageChargeRow, DamageChargesRepository } from './damage-charges.repository';
import { InvoicesRepository, LineRow } from './invoices.repository';

type Client = Prisma.TransactionClient;

export interface BalanceSummary {
  contractId: string;
  dueNowVnd: bigint;
  dueLaterVnd: bigint;
  paidVnd: bigint;
  // Damage charges above the threshold still waiting for an Admin (UC-48): they have no invoice line
  // yet, so they are listed apart and `settled` covers the lines only. The close guard counts them.
  pendingDamageCharges: DamageChargeRow[];
  settled: boolean;
}

interface Remaining {
  dueAt: Date;
  vnd: bigint;
}

// What each line still owes, after negative ADJUSTMENT lines are credited against the oldest-due
// positive lines first, the order payments apply in (REQ-EVT-09 of billing).
const remainingAfterCredits = (lines: readonly LineRow[]): Remaining[] => {
  let credit = 0n;
  const owing: Remaining[] = [];
  for (const line of lines) {
    const left = line.amountVnd - line.paidVnd;
    if (left < 0n) credit -= left;
    else if (left > 0n) owing.push({ dueAt: line.dueAt, vnd: left });
  }
  return owing
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
    .map((item) => {
      const applied = credit < item.vnd ? credit : item.vnd;
      credit -= applied;
      return { dueAt: item.dueAt, vnd: item.vnd - applied };
    });
};

const sum = (items: readonly Remaining[]): bigint =>
  items.reduce((total, item) => total + item.vnd, 0n);

// Balances over the contract's invoice lines (billing task 2.4, REQ-STA-02, FR-CON-13, BR-27), with
// the damage charges awaiting approval, found by the contract each charge stores (D-081).
@Injectable()
export class BalanceService {
  constructor(
    private readonly invoices: InvoicesRepository,
    private readonly damageCharges: DamageChargesRepository,
  ) {}

  // The first payment rule of the handover (FR-CON-05, BR-09): the first line of the contract's
  // first TERM or DAY_PLAN invoice, the holding fee or the day-plan fee, is paid in full.
  async firstPaymentConfirmed(contractId: string, client?: Client): Promise<boolean> {
    const invoice = await this.invoices.firstChargeableInvoice(contractId, client);
    const first = invoice?.lines[0];
    return first !== undefined && first.paidVnd >= first.amountVnd;
  }

  // What the contract still owes, in VND; zero when its lines net to nothing or less.
  async outstanding(contractId: string, client?: Client): Promise<bigint> {
    return sum(remainingAfterCredits(await this.invoices.linesOfContract(contractId, client)));
  }

  // What every contract of the organization owes that is due at or before `at` and unpaid, in VND: the
  // reactivation check counts only due and unpaid lines, so an installment not yet due never blocks it
  // (leader ruling 2026-10-30). Credits net inside one contract only, oldest due first as in
  // `balanceSummary`, so a credit on one contract never pays another contract's debt.
  async dueUnpaidOfOrganization(
    organizationId: string,
    at: Date,
    client?: Client,
  ): Promise<bigint> {
    const byContract = new Map<string, LineRow[]>();
    for (const line of await this.invoices.linesOfOrganization(organizationId, client)) {
      const lines = byContract.get(line.invoice.contractId) ?? [];
      lines.push(line);
      byContract.set(line.invoice.contractId, lines);
    }
    let total = 0n;
    for (const lines of byContract.values()) {
      total += sum(
        remainingAfterCredits(lines).filter((item) => item.dueAt.getTime() <= at.getTime()),
      );
    }
    return total;
  }

  // Damage charges of the organization's contracts still waiting for an Admin (UC-48). They have no
  // invoice line yet, so `dueUnpaidOfOrganization` cannot see them; the reactivation check reads both.
  async pendingDamageOfOrganization(organizationId: string, client?: Client): Promise<number> {
    const contractIds = await this.invoices.contractIdsOfOrganization(organizationId, client);
    return this.damageCharges.countPendingOfContracts(contractIds, client);
  }

  // The contract balance: due now (due at or before `at`), due later, and paid (api-design 10).
  async balanceSummary(
    contractId: string,
    at: Date = new Date(),
    client?: Client,
  ): Promise<BalanceSummary> {
    const [lines, pendingDamageCharges] = await Promise.all([
      this.invoices.linesOfContract(contractId, client),
      this.damageCharges.pendingOfContract(contractId, client),
    ]);
    const remaining = remainingAfterCredits(lines);
    const dueNowVnd = sum(remaining.filter((item) => item.dueAt.getTime() <= at.getTime()));
    const dueLaterVnd = sum(remaining) - dueNowVnd;
    const paidVnd = lines.reduce((total, line) => total + line.paidVnd, 0n);
    return {
      contractId,
      dueNowVnd,
      dueLaterVnd,
      paidVnd,
      pendingDamageCharges,
      settled: dueNowVnd + dueLaterVnd === 0n,
    };
  }
}
