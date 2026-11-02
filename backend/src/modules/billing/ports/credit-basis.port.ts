import { Prisma } from '@prisma/client';

// What a service credit is computed from (billing design §9, task 8.1): the contract's price snapshot,
// the unit's custody times on that contract and the contract's terms. Declared by `billing`, which may
// not read `rental_contracts`, `contract_terms` or `contract_devices` (owned by `rentals`); provided by
// `rentals`, which depends on `billing` (platform design §2.1, the D-032 pattern).
export const CREDIT_BASIS = Symbol('CREDIT_BASIS');

export interface CreditTerm {
  seq: number;
  startsAt: Date;
  endsAt: Date;
  // false for a term whose invoice `rentals` has not issued yet
  invoiced: boolean;
}

export interface CreditUnit {
  contractDeviceId: string;
  deviceId: string;
  handedOverAt: Date | null;
  checkedInAt: Date | null;
  lostAt: Date | null;
  // the handover of the row that replaced this one (rentals REQ-EVT-12, D-045), when there is one
  replacementHandedOverAt: Date | null;
}

export interface CreditContract {
  id: string;
  organizationId: string;
  status: string;
  planType: 'MONTHLY' | 'DAY';
  monthlyUnitPriceVnd: bigint;
  dayPremium: Prisma.Decimal | null;
  dayPlanDays: number | null;
  // notice given: the rollover issues no further term
  noticeGivenAt: Date | null;
  terms: CreditTerm[];
}

export interface CreditBasis {
  // null when the contract or the row does not exist, or the row is not on this contract
  basisOf(
    contractId: string,
    contractDeviceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<{ contract: CreditContract; unit: CreditUnit } | null>;
}
