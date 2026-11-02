import { PlanType, Prisma } from '@prisma/client';
import { InvoicesService } from '../billing';
import { firstTerm } from './contract-terms';
import { ContractRow, ContractsRepository } from './contracts.repository';

export interface FirstTerm {
  id: string;
  seq: number;
  startsAt: Date;
  endsAt: Date;
}

// Term 1 anchored to the requested start date and its invoice through billing (design §3): one TERM
// invoice with the holding fee and the term balance, or one DAY_PLAN invoice. Called by the request
// since D-092 rule 1, and by the approval of a contract requested before it (design §2.1). The
// first line of the invoice is the deposit the request's hold waits for; `depositDueBy`, the request's
// hold expiry, makes it fall due by then (D-092 rule 1, billing design §2). The approval passes none.
export const openFirstTerm = async (
  contracts: ContractsRepository,
  invoices: InvoicesService,
  contract: ContractRow,
  variantCode: string,
  tx: Prisma.TransactionClient,
  at: Date,
  depositDueBy: Date | null = null,
): Promise<FirstTerm> => {
  const { startsAt, endsAt } = firstTerm(contract);
  const term = await contracts.insertTerm(
    { contractId: contract.id, seq: 1, startsAt, endsAt },
    tx,
  );
  const billable = {
    id: contract.id,
    organizationId: contract.organizationId,
    quantity: contract.quantity,
    monthlyUnitPriceVnd: contract.monthlyUnitPriceVnd,
    variantCode,
    depositDueBy,
  };
  if (contract.planType === PlanType.DAY) {
    await invoices.issueDayPlanInvoice(
      {
        ...billable,
        dayPremium: contract.dayPremium ?? new Prisma.Decimal(1),
        dayPlanDays: contract.dayPlanDays ?? 0,
        termId: term.id,
        startsAt: term.startsAt,
      },
      tx,
      at,
    );
  } else {
    await invoices.issueTermInvoice(
      { ...billable, holdingFeeRatio: contract.holdingFeeRatio },
      term,
      tx,
      at,
    );
  }
  return { id: term.id, seq: term.seq, startsAt: term.startsAt, endsAt: term.endsAt };
};
