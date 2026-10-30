import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DevicesService } from '../devices';
import { CONTRACT_DIRECTORY, ContractDirectory } from './ports/contract-directory.port';
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

// Sorts after every code and id, so rows without one come last in the revenue report.
const LAST = '\uffff';

// Code unit order, the same on every server whatever its locale (review of #174).
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sum = (items: readonly Remaining[]): bigint =>
  items.reduce((total, item) => total + item.vnd, 0n);

// Revenue of one hardware variant over a range (task 2.4, monitoring api-design 08): what the lines
// due in the range invoice, what has been paid on them, and what they still owe. A negative
// adjustment lowers what is invoiced. `hardwareVariantId` is null for contracts the directory does
// not name (no provider, as in a module test).
export interface VariantRevenue {
  hardwareVariantId: string | null;
  variantCode: string | null;
  invoicedVnd: bigint;
  paidVnd: bigint;
  outstandingVnd: bigint;
}

// Balances over the contract's invoice lines (billing task 2.4, REQ-STA-02, FR-CON-13, BR-27), with
// the damage charges awaiting approval, found by the contract each charge stores (D-081).
@Injectable()
export class BalanceService {
  constructor(
    private readonly invoices: InvoicesRepository,
    private readonly damageCharges: DamageChargesRepository,
    @Optional() private readonly devices?: DevicesService,
    @Optional() @Inject(CONTRACT_DIRECTORY) private readonly directory?: ContractDirectory,
  ) {}

  // Revenue per variant over [from, to) for the Staff and Admin report (task 2.4). By the ruling of
  // 2026-10-30 a line belongs to the period of its due time: a holding fee to the term start, a term
  // balance to the term end, a late, damage or loss line to when it arose. The variant is the
  // contract's, which a replacement keeps (rentals 4.3).
  async revenue(range: { from: Date; to: Date }): Promise<VariantRevenue[]> {
    const lines = await this.invoices.linesDueBetween(range.from, range.to);
    const contractIds = [...new Set(lines.map((line) => line.invoice.contractId))];
    const [variantOf, variants] = await Promise.all([
      this.directory && contractIds.length > 0
        ? this.directory.variantsOf(contractIds)
        : Promise.resolve(new Map<string, string>()),
      this.devices ? this.devices.variants(false) : Promise.resolve([]),
    ]);
    const codeOf = new Map(variants.map((variant) => [variant.id, variant.code]));
    const byVariant = new Map<string | null, { invoicedVnd: bigint; paidVnd: bigint }>();
    for (const line of lines) {
      const variantId = variantOf.get(line.invoice.contractId) ?? null;
      const sums = byVariant.get(variantId) ?? { invoicedVnd: 0n, paidVnd: 0n };
      sums.invoicedVnd += line.amountVnd;
      sums.paidVnd += line.paidVnd;
      byVariant.set(variantId, sums);
    }
    return [...byVariant.entries()]
      .map(([hardwareVariantId, sums]) => {
        const owed = sums.invoicedVnd - sums.paidVnd;
        return {
          hardwareVariantId,
          variantCode: hardwareVariantId ? (codeOf.get(hardwareVariantId) ?? null) : null,
          invoicedVnd: sums.invoicedVnd,
          paidVnd: sums.paidVnd,
          outstandingVnd: owed > 0n ? owed : 0n,
        };
      })
      .sort(
        (a, b) =>
          compare(a.variantCode ?? LAST, b.variantCode ?? LAST) ||
          compare(a.hardwareVariantId ?? LAST, b.hardwareVariantId ?? LAST),
      );
  }

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
