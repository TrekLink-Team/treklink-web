import { ConfigService } from '@nestjs/config';
import { InspectionResult, Prisma, ServiceCreditCause, ServiceCreditStatus } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { DevicesService } from '../devices';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { InvoicesRepository } from './invoices.repository';
import { CreditContract, CreditUnit } from './ports/credit-basis.port';
import { ServiceCreditLedger } from './service-credit-ledger';
import {
  SERVICE_CREDIT_NOTICE,
  ServiceCreditService,
  outageDaysOf,
  outageEndOf,
} from './service-credit.service';
import { ServiceCreditRow, ServiceCreditsRepository } from './service-credits.repository';

const TX = {} as Prisma.TransactionClient;
const DAY = 86_400_000;
const TERM_START = new Date('2026-10-01T00:00:00.000Z');
const day = (n: number) => new Date(TERM_START.getTime() + n * DAY);
const STAFF = { id: 'staff-1', roles: ['STAFF'] } as unknown as Caller;
const ADMIN = { id: 'admin-1', roles: ['ADMIN'] } as unknown as Caller;

const contract = (overrides: Partial<CreditContract> = {}): CreditContract => ({
  id: 'c-1',
  organizationId: 'org-1',
  status: 'ACTIVE',
  planType: 'MONTHLY',
  monthlyUnitPriceVnd: 450_000n,
  dayPremium: null,
  dayPlanDays: null,
  noticeGivenAt: null,
  terms: [{ seq: 1, startsAt: TERM_START, endsAt: day(30), invoiced: true }],
  ...overrides,
});

const unit = (overrides: Partial<CreditUnit> = {}): CreditUnit => ({
  contractDeviceId: 'cd-1',
  deviceId: 'dev-1',
  handedOverAt: TERM_START,
  checkedInAt: null,
  lostAt: null,
  replacementHandedOverAt: day(13),
  ...overrides,
});

const credit = (overrides: Partial<ServiceCreditRow> = {}): ServiceCreditRow => ({
  id: 'sc-1',
  contractId: 'c-1',
  organizationId: 'org-1',
  contractDeviceId: 'cd-1',
  deviceId: 'dev-1',
  kind: 'FAULT',
  unitReleaseId: null,
  cause: ServiceCreditCause.BATTERY_FAULT,
  faultInspectionId: 'insp-1',
  outageFrom: day(10),
  outageSourceIncidentId: null,
  outageSourceFaultReportId: null,
  outageSourceNote: 'Called the counter at 08:10',
  outageTo: day(13),
  outageDays: 3,
  computedVnd: 45_000n,
  decidedVnd: null,
  appliedVnd: 0n,
  status: ServiceCreditStatus.REQUESTED,
  requestedById: 'staff-1',
  decidedById: null,
  decisionReason: null,
  decidedAt: null,
  refundReference: null,
  refundedAt: null,
  version: 1,
  createdAt: day(14),
  ...overrides,
});

const REQUEST = {
  contractDeviceId: 'cd-1',
  cause: ServiceCreditCause.BATTERY_FAULT,
  faultInspectionId: 'insp-1',
  outageFrom: day(10),
  outageSourceNote: 'Called the counter at 08:10',
};

const build = (
  options: {
    basis?: { contract: CreditContract; unit: CreditUnit } | null;
    row?: ServiceCreditRow | null;
    inspection?: object | null;
  } = {},
) => {
  const basisRow =
    options.basis === undefined ? { contract: contract(), unit: unit() } : options.basis;
  const row = options.row === undefined ? credit() : options.row;
  const credits = {
    lockUnit: jest.fn().mockResolvedValue(undefined),
    overlapping: jest.fn().mockResolvedValue(null),
    insert: jest.fn((data: object) => Promise.resolve(credit({ ...data }))),
    lock: jest.fn().mockResolvedValue(row),
    update: jest.fn((id: string, data: Record<string, unknown>) =>
      Promise.resolve({ ...row, ...data } as ServiceCreditRow),
    ),
    find: jest.fn(() => Promise.resolve(row)),
    refundReferenceUsed: jest.fn().mockResolvedValue(null),
    approvedWithRemainder: jest.fn().mockResolvedValue([]),
    requestedOfContract: jest.fn().mockResolvedValue([]),
  };
  const invoices = { lockClosingInvoice: jest.fn().mockResolvedValue(null) };
  const ledger = { land: jest.fn((cid: string, invoice: object) => Promise.resolve(invoice)) };
  const devices = {
    inspectionFor: jest.fn().mockResolvedValue(
      options.inspection === undefined
        ? {
            id: 'insp-1',
            deviceId: 'dev-1',
            contractDeviceId: 'cd-1',
            result: InspectionResult.FAILED,
          }
        : options.inspection,
    ),
  };
  const events = {
    transaction: jest.fn((work: (tx: Prisma.TransactionClient) => unknown) => work(TX)),
    emitAfterCommit: jest.fn(),
  };
  const config = { get: jest.fn((key: string) => (key === 'MAX_PAGE_SIZE' ? 100 : 20)) };
  const basis = {
    basisOf: jest.fn().mockResolvedValue(basisRow),
    faultReportSource: jest.fn().mockResolvedValue(null),
    releaseNotes: jest.fn().mockResolvedValue(new Map()),
  };
  const service = new ServiceCreditService(
    credits as unknown as ServiceCreditsRepository,
    invoices as unknown as InvoicesRepository,
    ledger as unknown as ServiceCreditLedger,
    devices as unknown as DevicesService,
    events as unknown as TransactionalEvents,
    config as unknown as ConfigService<ValidatedEnvironment, true>,
    basis,
  );
  return { service, credits, invoices, ledger, devices, events, basis };
};

describe('service credit outage (design §9.2)', () => {
  it('counts whole days rounded up, one at least', () => {
    expect(outageDaysOf(day(10), day(13))).toBe(3);
    expect(outageDaysOf(day(10), new Date(day(10).getTime() + 3_600_000))).toBe(1);
    expect(outageDaysOf(day(10), new Date(day(12).getTime() + 1))).toBe(3);
  });

  it('ends at the first of the replacement handover, the check-in and the term end', () => {
    expect(outageEndOf(unit(), day(30))).toEqual(day(13));
    expect(
      outageEndOf(unit({ replacementHandedOverAt: null, checkedInAt: day(20) }), day(30)),
    ).toEqual(day(20));
    expect(outageEndOf(unit({ replacementHandedOverAt: day(40) }), day(30))).toEqual(day(30));
  });
});

describe('ServiceCreditService.request (REQ-EVT-12, billing 8.1)', () => {
  it('AC-06: records 45,000 VND for days 10 to 13 of a 30-day term, then audits and notifies', async () => {
    const { service, credits, events } = build();
    const requested = await service.request('c-1', REQUEST, STAFF, day(14));

    expect(credits.lockUnit).toHaveBeenCalledWith('cd-1', TX);
    expect(credits.overlapping).toHaveBeenCalledWith('cd-1', day(10), day(13), TX);
    expect(credits.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        deviceId: 'dev-1',
        outageTo: day(13),
        outageDays: 3,
        computedVnd: 45_000n,
        outageSourceIncidentId: null,
        outageSourceFaultReportId: null,
        outageSourceNote: 'Called the counter at 08:10',
        requestedById: 'staff-1',
      }),
      TX,
    );
    expect(requested.computedVnd).toBe(45_000n);
    expect(events.emitAfterCommit).toHaveBeenCalledWith(
      AUDIT_RECORD,
      expect.objectContaining({ action: 'serviceCredit.requested', subjectId: 'sc-1' }),
    );
    expect(events.emitAfterCommit).toHaveBeenCalledWith(SERVICE_CREDIT_NOTICE, {
      creditId: 'sc-1',
      contractId: 'c-1',
      organizationId: 'org-1',
      kind: 'REQUESTED',
      amountVnd: 45_000n,
    });
  });

  it('prices a day plan from its premium, capped at the unit day-plan fee', async () => {
    const { service, credits } = build({
      basis: {
        contract: contract({
          planType: 'DAY',
          dayPremium: new Prisma.Decimal('1.5'),
          dayPlanDays: 4,
          terms: [{ seq: 1, startsAt: TERM_START, endsAt: day(4), invoiced: true }],
        }),
        unit: unit({ replacementHandedOverAt: null, checkedInAt: day(4) }),
      },
    });
    await service.request('c-1', { ...REQUEST, outageFrom: day(2) }, STAFF, day(5));
    // 450,000 / 30 x 1.5 x 2 days
    expect(credits.insert).toHaveBeenCalledWith(
      expect.objectContaining({ outageDays: 2, computedVnd: 45_000n }),
      TX,
    );
  });

  it('REQ-ERR-06: refuses a request with no source for the outage start', async () => {
    const { service, credits } = build();
    await expect(
      service.request('c-1', { ...REQUEST, outageSourceNote: '  ' }, STAFF, day(14)),
    ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_FAILED });
    expect(credits.insert).not.toHaveBeenCalled();
  });

  it('defaults the outage start to a fault report for the same custody row', async () => {
    const { service, basis, credits } = build();
    basis.faultReportSource.mockResolvedValue({ reportedAt: day(11) });
    const requested = await service.request(
      'c-1',
      {
        ...REQUEST,
        outageFrom: undefined,
        outageSourceNote: undefined,
        outageSourceFaultReportId: 'fault-1',
      },
      STAFF,
      day(14),
    );
    expect(basis.faultReportSource).toHaveBeenCalledWith('fault-1', 'c-1', 'cd-1', TX);
    expect(credits.overlapping).toHaveBeenCalledWith('cd-1', day(11), day(13), TX);
    expect(requested).toMatchObject({
      outageFrom: day(11),
      outageSourceFaultReportId: 'fault-1',
      computedVnd: 30_000n,
    });
  });

  it('rejects a foreign fault report even if the request supplies another source and time', async () => {
    const { service, credits } = build();
    await expect(
      service.request('c-1', { ...REQUEST, outageSourceFaultReportId: 'foreign' }, STAFF, day(14)),
    ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_FAILED });
    expect(credits.insert).not.toHaveBeenCalled();
  });

  it('requires an explicit outage start for a note without a fault report', async () => {
    const { service, credits } = build();
    await expect(
      service.request('c-1', { ...REQUEST, outageFrom: undefined }, STAFF, day(14)),
    ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_FAILED });
    expect(credits.insert).not.toHaveBeenCalled();
  });

  it('refuses a unit not on the contract, and one still out', async () => {
    await expect(
      build({ basis: null }).service.request('c-1', REQUEST, STAFF, day(14)),
    ).rejects.toMatchObject({ errorCode: ErrorCode.DEVICE_NOT_ON_CONTRACT });
    await expect(
      build({
        basis: { contract: contract(), unit: unit({ replacementHandedOverAt: null }) },
      }).service.request('c-1', REQUEST, STAFF, day(14)),
    ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_STATE_TRANSITION });
  });

  it('accepts only a FAILED inspection of the same contract row as the fault record', async () => {
    for (const inspection of [
      null,
      { id: 'insp-1', contractDeviceId: 'cd-1', result: InspectionResult.DAMAGED },
      { id: 'insp-1', contractDeviceId: 'cd-2', result: InspectionResult.FAILED },
    ]) {
      await expect(
        build({ inspection }).service.request('c-1', REQUEST, STAFF, day(14)),
      ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_FAILED });
    }
  });

  it('refuses an outage start before the handover or after the unit came back', async () => {
    const { service } = build();
    await expect(
      service.request(
        'c-1',
        { ...REQUEST, outageFrom: new Date(TERM_START.getTime() - 1) },
        STAFF,
        day(14),
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_FAILED });
    await expect(
      service.request('c-1', { ...REQUEST, outageFrom: day(13) }, STAFF, day(14)),
    ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_FAILED });
  });

  it('REQ-ERR-08: refuses an outage another credit of the row already covers', async () => {
    const { service, credits } = build();
    credits.overlapping.mockResolvedValueOnce({ id: 'sc-0' });
    await expect(service.request('c-1', REQUEST, STAFF, day(14))).rejects.toMatchObject({
      errorCode: ErrorCode.DUPLICATE_CREDIT,
    });
    expect(credits.insert).not.toHaveBeenCalled();
  });
});

describe('ServiceCreditService.decide (REQ-EVT-13, REQ-EVT-14)', () => {
  it('AC-07: the requester cannot decide their own credit', async () => {
    const { service, credits } = build();
    await expect(
      service.decide('sc-1', { decision: 'APPROVE', expectedVersion: 1 }, STAFF, day(15)),
    ).rejects.toMatchObject({ errorCode: ErrorCode.SEPARATION_OF_DUTY });
    expect(credits.update).not.toHaveBeenCalled();
  });

  it('refuses a stale version and a credit already decided', async () => {
    await expect(
      build().service.decide('sc-1', { decision: 'APPROVE', expectedVersion: 2 }, ADMIN),
    ).rejects.toMatchObject({ errorCode: ErrorCode.STALE_VERSION });
    await expect(
      build({ row: credit({ status: ServiceCreditStatus.APPROVED }) }).service.decide(
        'sc-1',
        { decision: 'APPROVE', expectedVersion: 1 },
        ADMIN,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_STATE_TRANSITION });
  });

  it('REQ-ERR-07: reducing or rejecting needs a reason, and a reduction stays below the computed credit', async () => {
    const { service } = build();
    await expect(
      service.decide('sc-1', { decision: 'REJECT', expectedVersion: 1 }, ADMIN),
    ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_FAILED });
    await expect(
      service.decide(
        'sc-1',
        { decision: 'REDUCE', decidedVnd: 45_000, reason: 'Partial use', expectedVersion: 1 },
        ADMIN,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_FAILED });
  });

  it('leaves an approved credit of a running monthly contract for the next term invoice', async () => {
    const { service, credits, invoices, ledger, events } = build();
    const decided = await service.decide(
      'sc-1',
      { decision: 'APPROVE', expectedVersion: 1 },
      ADMIN,
      day(15),
    );
    expect(credits.update).toHaveBeenCalledWith(
      'sc-1',
      expect.objectContaining({
        status: ServiceCreditStatus.APPROVED,
        decidedVnd: 45_000n,
        decidedAt: day(15),
      }),
      TX,
    );
    expect(invoices.lockClosingInvoice).not.toHaveBeenCalled();
    expect(ledger.land).not.toHaveBeenCalled();
    expect(decided.status).toBe(ServiceCreditStatus.APPROVED);
    expect(events.emitAfterCommit).toHaveBeenCalledWith(
      SERVICE_CREDIT_NOTICE,
      expect.objectContaining({ kind: 'APPROVED', amountVnd: 45_000n }),
    );
  });

  it('AC-07: a reduction with notice given lands on the closing invoice now', async () => {
    const { service, invoices, ledger } = build({
      basis: { contract: contract({ noticeGivenAt: day(5) }), unit: unit() },
    });
    invoices.lockClosingInvoice.mockResolvedValueOnce({ id: 'inv-closing' });
    await service.decide(
      'sc-1',
      {
        decision: 'REDUCE',
        decidedVnd: 30_000,
        reason: 'Unit used for part of day 10',
        expectedVersion: 1,
      },
      ADMIN,
      day(15),
    );
    expect(ledger.land).toHaveBeenCalledWith('c-1', { id: 'inv-closing' }, TX, day(15));
  });

  it('AC-08: a credit decided after the close becomes REFUND_DUE', async () => {
    const { service, credits } = build({
      basis: { contract: contract({ status: 'CLOSED' }), unit: unit() },
      row: credit(),
    });
    credits.find.mockResolvedValueOnce(
      credit({ status: ServiceCreditStatus.APPROVED, decidedVnd: 45_000n }),
    );
    const decided = await service.decide(
      'sc-1',
      { decision: 'APPROVE', expectedVersion: 1 },
      ADMIN,
      day(40),
    );
    expect(credits.update).toHaveBeenLastCalledWith(
      'sc-1',
      { status: ServiceCreditStatus.REFUND_DUE },
      TX,
    );
    expect(decided.status).toBe(ServiceCreditStatus.REFUND_DUE);
  });
});

describe('ServiceCreditService.recordRefund (REQ-EVT-15, AC-08)', () => {
  it('records the reference once and refuses it again', async () => {
    const due = credit({ status: ServiceCreditStatus.REFUND_DUE, decidedVnd: 45_000n });
    const { service, credits } = build({ row: due });
    const refunded = await service.recordRefund('sc-1', ' FT2611020001 ', STAFF, day(41));
    expect(credits.update).toHaveBeenCalledWith(
      'sc-1',
      {
        status: ServiceCreditStatus.REFUNDED,
        refundReference: 'FT2611020001',
        refundedAt: day(41),
      },
      TX,
    );
    expect(refunded.status).toBe(ServiceCreditStatus.REFUNDED);

    credits.refundReferenceUsed.mockResolvedValueOnce({ id: 'sc-0' });
    await expect(service.recordRefund('sc-1', 'FT2611020001', STAFF)).rejects.toMatchObject({
      errorCode: ErrorCode.DUPLICATE_REFERENCE,
    });
  });

  it('refuses a credit that is not REFUND_DUE', async () => {
    await expect(build().service.recordRefund('sc-1', 'FT1', STAFF)).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_STATE_TRANSITION,
    });
  });
});

describe('ServiceCreditService.onContractClosed (REQ-EVT-15)', () => {
  it('turns every approved remainder into REFUND_DUE', async () => {
    const { service, credits } = build();
    credits.approvedWithRemainder.mockResolvedValueOnce([
      credit({ id: 'sc-1', status: ServiceCreditStatus.APPROVED }),
      credit({ id: 'sc-2', status: ServiceCreditStatus.APPROVED }),
    ]);
    await expect(service.onContractClosed('c-1', TX)).resolves.toBe(2);
    expect(credits.update).toHaveBeenCalledWith(
      'sc-2',
      { status: ServiceCreditStatus.REFUND_DUE },
      TX,
    );
  });
});
