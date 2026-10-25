import { Injectable } from '@nestjs/common';
import { InvoiceKind, InvoiceLineType, Prisma } from '@prisma/client';
import { InvoiceRow, InvoicesRepository, NewInvoiceLine } from './invoices.repository';
import { dayPlanFeeVnd, holdingFeeVnd, termFeeVnd } from './money';

// What `rentals` hands billing when it issues an invoice: the contract's price snapshot
// (REQ-UBI-04 of rentals) and the variant code for the line description. Billing reads no
// contract, term or variant table itself (04-architecture-conventions.md §1.1).
export interface BillableContract {
  id: string;
  organizationId: string;
  quantity: number;
  monthlyUnitPriceVnd: bigint;
  variantCode: string;
}

export interface BillableMonthlyContract extends BillableContract {
  holdingFeeRatio: Prisma.Decimal;
}

// A day plan has one term, created at approval (rentals design §3); `termId` links the invoice to it
// and `startsAt` is that term's start, 09:00 UTC+7 on the requested start date.
export interface BillableDayPlan extends BillableContract {
  dayPremium: Prisma.Decimal;
  dayPlanDays: number;
  termId: string;
  startsAt: Date;
}

export interface BillableTerm {
  id: string;
  seq: number;
  startsAt: Date;
  endsAt: Date;
}

// One dated line. The line keeps the device count when the amount divides evenly by it, and is one
// line of the whole amount otherwise, so quantity × unit always equals the amount.
const line = (
  type: InvoiceLineType,
  description: string,
  quantity: number,
  amountVnd: bigint,
  dueAt: Date,
): NewInvoiceLine => {
  const even = amountVnd % BigInt(quantity) === 0n;
  return {
    type,
    description,
    quantity: even ? quantity : 1,
    unitVnd: even ? amountVnd / BigInt(quantity) : amountVnd,
    amountVnd,
    dueAt,
    createdById: null,
  };
};

// Term and day-plan invoices (billing task 2.2, REQ-EVT-02, REQ-EVT-03, D-037). Called by `rentals`
// inside its approval and rollover transactions; issued lines never change (REQ-UBI-02).
@Injectable()
export class InvoicesService {
  constructor(private readonly invoices: InvoicesRepository) {}

  // One TERM invoice: the holding fee due at the term start and the balance due at the term end.
  issueTermInvoice(
    contract: BillableMonthlyContract,
    term: BillableTerm,
    tx: Prisma.TransactionClient,
    at: Date = new Date(),
  ): Promise<InvoiceRow> {
    const fee = termFeeVnd(contract.monthlyUnitPriceVnd, contract.quantity);
    const holding = holdingFeeVnd(
      contract.monthlyUnitPriceVnd,
      contract.quantity,
      contract.holdingFeeRatio,
    );
    const devices = `${contract.quantity} x ${contract.variantCode}`;
    return this.invoices.insert(
      {
        organizationId: contract.organizationId,
        contractId: contract.id,
        termId: term.id,
        kind: InvoiceKind.TERM,
        issuedAt: at,
      },
      [
        line(
          InvoiceLineType.HOLDING_FEE,
          `Term ${term.seq} holding fee, ${devices}`,
          contract.quantity,
          holding,
          term.startsAt,
        ),
        line(
          InvoiceLineType.TERM_BALANCE,
          `Term ${term.seq} balance, ${devices}`,
          contract.quantity,
          fee - holding,
          term.endsAt,
        ),
      ],
      tx,
    );
  }

  // One DAY_PLAN invoice with one line for the whole plan, due at the start date and paid at the
  // latest at the counter.
  issueDayPlanInvoice(
    contract: BillableDayPlan,
    tx: Prisma.TransactionClient,
    at: Date = new Date(),
  ): Promise<InvoiceRow> {
    const fee = dayPlanFeeVnd(
      contract.monthlyUnitPriceVnd,
      contract.dayPremium,
      contract.dayPlanDays,
      contract.quantity,
    );
    return this.invoices.insert(
      {
        organizationId: contract.organizationId,
        contractId: contract.id,
        termId: contract.termId,
        kind: InvoiceKind.DAY_PLAN,
        issuedAt: at,
      },
      [
        line(
          InvoiceLineType.DAY_PLAN_FEE,
          `Day plan, ${contract.dayPlanDays} days, ${contract.quantity} x ${contract.variantCode}`,
          contract.quantity,
          fee,
          contract.startsAt,
        ),
      ],
      tx,
    );
  }
}
