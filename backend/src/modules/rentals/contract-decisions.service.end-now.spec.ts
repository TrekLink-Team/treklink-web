import { HttpStatus } from '@nestjs/common';
import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { BalanceService, ChargesService, InvoicesService } from '../billing';
import { DevicesService } from '../devices';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { CONTRACT_ENDED_EARLY, ContractDecisionsService } from './contract-decisions.service';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractRow, ContractsRepository } from './contracts.repository';

// End now (rentals task 10.2, REQ-EVT-27, REQ-EVT-28, REQ-ERR-17, design §12, D-097).
const AT = new Date('2026-11-06T03:00:00.000Z');
const TX = {} as Prisma.TransactionClient;
const STAFF: Caller = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
const MANAGER: Caller = { id: 'u-mgr', roles: ['ORG_MANAGER'], organizationId: 'org-1' };
const OTHER_MANAGER: Caller = { id: 'u-mgr-2', roles: ['ORG_MANAGER'], organizationId: 'org-2' };
const TERM = {
  id: 't-2',
  seq: 2,
  startsAt: new Date('2026-11-01T02:00:00.000Z'),
  endsAt: new Date('2026-12-01T02:00:00.000Z'),
  status: 'OPEN',
};
const QUOTE = {
  termFeeVnd: 900_000n,
  termDays: 30,
  usedDays: 6,
  unusedDays: 24,
  creditVnd: 720_000n,
};

const contract = (overrides: Partial<ContractRow> = {}): ContractRow => ({
  id: 'c-2',
  code: 'RC-2026-0002',
  organizationId: 'org-1',
  planType: PlanType.MONTHLY,
  dayPlanDays: null,
  hardwareVariantId: 'v-3',
  quantity: 2,
  requestedStartDate: new Date('2026-10-01T00:00:00.000Z'),
  monthlyUnitPriceVnd: 450_000n,
  dayPremium: null,
  holdingFeeRatio: new Prisma.Decimal('0.5'),
  status: ContractStatus.ACTIVE,
  statusChangedAt: AT,
  handedOverAt: new Date('2026-10-01T02:00:00.000Z'),
  endsAt: null,
  noticeGivenAt: null,
  returnDueAt: null,
  version: 4,
  ...overrides,
});

describe('ContractDecisionsService End now (rentals task 10.2, D-097)', () => {
  let contracts: Record<string, jest.Mock>;
  let lifecycle: { apply: jest.Mock };
  let charges: { creditEarlyEnd: jest.Mock; earlyEndCredit: jest.Mock };
  let balances: { balanceSummary: jest.Mock; afterCredit: jest.Mock };
  let emitted: { name: string; payload: unknown }[];
  let service: ContractDecisionsService;

  beforeEach(() => {
    emitted = [];
    contracts = {
      lockById: jest.fn().mockResolvedValue(contract()),
      findById: jest.fn().mockResolvedValue(contract()),
      openTerm: jest.fn().mockResolvedValue(TERM),
      closeTerm: jest.fn().mockResolvedValue(true),
      recordEarlyEnd: jest.fn().mockResolvedValue(undefined),
      returnCounts: jest.fn().mockResolvedValue({ total: 2, returned: 0 }),
    };
    lifecycle = {
      apply: jest
        .fn()
        .mockImplementation((_id: string, _from: ContractStatus, to: ContractStatus) =>
          Promise.resolve(contract({ status: to, version: 5 })),
        ),
    };
    charges = {
      creditEarlyEnd: jest.fn().mockResolvedValue({ quote: QUOTE, invoice: { id: 'inv-c' } }),
      earlyEndCredit: jest.fn().mockReturnValue(QUOTE),
    };
    balances = {
      balanceSummary: jest.fn().mockResolvedValue({
        dueNowVnd: 0n,
        dueLaterVnd: 0n,
        paidVnd: 900_000n,
        owedToOrganizationVnd: 720_000n,
      }),
      afterCredit: jest
        .fn()
        .mockResolvedValue({ outstandingVnd: 0n, owedToOrganizationVnd: 720_000n }),
    };
    // Events are held until the work resolves, as `TransactionalEvents` holds them until commit.
    let pending: { name: string; payload: unknown }[] = [];
    const events = {
      transaction: async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
        pending = [];
        const result = await work(TX);
        emitted.push(...pending);
        return result;
      },
      emitAfterCommit: (name: string, payload: unknown) => pending.push({ name, payload }),
    };
    service = new ContractDecisionsService(
      contracts as unknown as ContractsRepository,
      lifecycle as unknown as ContractLifecycleService,
      {} as DevicesService,
      {} as InvoicesService,
      charges as unknown as ChargesService,
      balances as unknown as BalanceService,
      { get: jest.fn() } as unknown as ParameterService,
      events as unknown as TransactionalEvents,
    );
  });

  const input = { reason: '  Trek finished early  ', expectedVersion: 4 };

  it('closes the term, credits it, sets the dates and moves ACTIVE to RETURN_DUE', async () => {
    const ended = await service.endNow('c-2', input, STAFF, AT);

    expect(contracts.closeTerm).toHaveBeenCalledWith('t-2', TX);
    expect(charges.creditEarlyEnd).toHaveBeenCalledWith(
      {
        id: 'c-2',
        organizationId: 'org-1',
        planType: PlanType.MONTHLY,
        quantity: 2,
        monthlyUnitPriceVnd: 450_000n,
      },
      TERM,
      AT,
      'Trek finished early',
      'u-staff',
      TX,
    );
    expect(contracts.recordEarlyEnd).toHaveBeenCalledWith('c-2', AT, TX);
    expect(lifecycle.apply).toHaveBeenCalledTimes(1);
    expect(lifecycle.apply).toHaveBeenCalledWith(
      'c-2',
      ContractStatus.ACTIVE,
      ContractStatus.RETURN_DUE,
      'Ended early: Trek finished early',
      STAFF,
      TX,
    );
    expect(ended.contract).toMatchObject({
      status: ContractStatus.RETURN_DUE,
      endsAt: AT,
      returnDueAt: AT,
    });
    expect(ended.earlyEnd).toEqual({
      endedAt: AT,
      reason: 'Trek finished early',
      creditVnd: 720_000n,
      usedDays: 6,
      unusedDays: 24,
      termDays: 30,
      outstandingVnd: 0n,
      owedToOrganizationVnd: 720_000n,
    });
  });

  it('records the audit entry and the domain event after commit only', async () => {
    await service.endNow('c-2', input, MANAGER, AT);

    expect(emitted.map((event) => event.name)).toEqual([AUDIT_RECORD, CONTRACT_ENDED_EARLY]);
    expect(emitted[0].payload).toMatchObject({
      actorId: 'u-mgr',
      actorRoles: ['ORG_MANAGER'],
      organizationId: 'org-1',
      action: 'contract.endedEarly',
      subjectId: 'c-2',
      before: { status: ContractStatus.ACTIVE },
      after: {
        status: ContractStatus.RETURN_DUE,
        reason: 'Trek finished early',
        creditVnd: 720_000,
      },
    });
    expect(emitted[1].payload).toEqual({
      contractId: 'c-2',
      organizationId: 'org-1',
      endedAt: AT,
      reason: 'Trek finished early',
      creditVnd: 720_000n,
      actorId: 'u-mgr',
    });
  });

  it('lets the Org Manager end the own organization’s ENDING contract at once', async () => {
    contracts.lockById.mockResolvedValue(contract({ status: ContractStatus.ENDING }));

    const ended = await service.endNow('c-2', input, MANAGER, AT);

    expect(lifecycle.apply).toHaveBeenCalledWith(
      'c-2',
      ContractStatus.ENDING,
      ContractStatus.RETURN_DUE,
      'Ended early: Trek finished early',
      MANAGER,
      TX,
    );
    expect(ended.contract.status).toBe(ContractStatus.RETURN_DUE);
  });

  it('goes on to RETURNED when every device is already back or lost', async () => {
    contracts.returnCounts.mockResolvedValue({ total: 2, returned: 2 });

    const ended = await service.endNow('c-2', input, STAFF, AT);

    expect(lifecycle.apply).toHaveBeenLastCalledWith(
      'c-2',
      ContractStatus.RETURN_DUE,
      ContractStatus.RETURNED,
      'ALL_DEVICES_BACK',
      STAFF,
      TX,
    );
    expect(ended.contract.status).toBe(ContractStatus.RETURNED);
  });

  it('passes a day plan to billing, which credits nothing', async () => {
    contracts.lockById.mockResolvedValue(contract({ planType: PlanType.DAY, dayPlanDays: 4 }));
    charges.creditEarlyEnd.mockResolvedValue({
      quote: { ...QUOTE, usedDays: 4, unusedDays: 0, termDays: 4, creditVnd: 0n },
      invoice: null,
    });

    const ended = await service.endNow('c-2', input, STAFF, AT);

    expect(charges.creditEarlyEnd).toHaveBeenCalledWith(
      expect.objectContaining({ planType: PlanType.DAY }),
      TERM,
      AT,
      'Trek finished early',
      'u-staff',
      TX,
    );
    expect(ended.earlyEnd.creditVnd).toBe(0n);
  });

  it('credits nothing when no term is open', async () => {
    contracts.openTerm.mockResolvedValue(null);

    const ended = await service.endNow('c-2', input, STAFF, AT);

    expect(contracts.closeTerm).not.toHaveBeenCalled();
    expect(charges.creditEarlyEnd).not.toHaveBeenCalled();
    expect(ended.earlyEnd.creditVnd).toBe(0n);
    expect(ended.term).toBeNull();
  });

  const refusal = async (promise: Promise<unknown>) => {
    const error = await promise.catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(DomainException);
    return error as DomainException;
  };

  it.each([
    ContractStatus.REQUESTED,
    ContractStatus.APPROVED,
    ContractStatus.RETURN_DUE,
    ContractStatus.OVERDUE,
    ContractStatus.DEFAULTED,
    ContractStatus.RETURNED,
    ContractStatus.CLOSED,
    ContractStatus.CANCELLED,
    ContractStatus.REJECTED,
  ])(
    'refuses a %s contract with 409 INVALID_STATE_TRANSITION and changes nothing',
    async (status) => {
      contracts.lockById.mockResolvedValue(contract({ status }));

      const error = await refusal(service.endNow('c-2', input, STAFF, AT));

      expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(error.errorCode).toBe(ErrorCode.INVALID_STATE_TRANSITION);
      expect(contracts.closeTerm).not.toHaveBeenCalled();
      expect(charges.creditEarlyEnd).not.toHaveBeenCalled();
      expect(lifecycle.apply).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    },
  );

  it('answers 404 for a Manager of another organization before anything else', async () => {
    const error = await refusal(
      service.endNow('c-2', { ...input, expectedVersion: 1 }, OTHER_MANAGER, AT),
    );

    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(lifecycle.apply).not.toHaveBeenCalled();
  });

  it('refuses a stale version with 409 STALE_VERSION', async () => {
    const error = await refusal(service.endNow('c-2', { ...input, expectedVersion: 3 }, STAFF, AT));

    expect(error.errorCode).toBe(ErrorCode.STALE_VERSION);
    expect(contracts.closeTerm).not.toHaveBeenCalled();
  });

  it.each(['', '   ', 'x'.repeat(501)])(
    'refuses the reason %j with 400 and reads nothing',
    async (reason) => {
      const error = await refusal(service.endNow('c-2', { reason, expectedVersion: 4 }, STAFF, AT));

      expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(error.errorCode).toBe(ErrorCode.VALIDATION_FAILED);
      expect(contracts.lockById).not.toHaveBeenCalled();
    },
  );

  it('takes a reason of exactly 500 characters', async () => {
    await expect(
      service.endNow('c-2', { reason: 'x'.repeat(500), expectedVersion: 4 }, STAFF, AT),
    ).resolves.toBeDefined();
  });

  describe('endPreview (REQ-EVT-28)', () => {
    it('answers the credit and the balance after it, and stores nothing', async () => {
      const preview = await service.endPreview('c-2', MANAGER, AT);

      expect(charges.earlyEndCredit).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c-2', quantity: 2, monthlyUnitPriceVnd: 450_000n }),
        TERM,
        AT,
      );
      expect(balances.afterCredit).toHaveBeenCalledWith('c-2', 720_000n, TX);
      expect(preview).toMatchObject({
        endsAt: AT,
        term: { seq: 2 },
        termFeeVnd: 900_000n,
        unusedDays: 24,
        creditVnd: 720_000n,
        outstandingVnd: 0n,
        owedToOrganizationVnd: 720_000n,
      });
      expect(contracts.lockById).not.toHaveBeenCalled();
      expect(contracts.closeTerm).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    });

    it('answers 409 on a RETURN_DUE contract and 404 for another organization', async () => {
      contracts.findById.mockResolvedValue(contract({ status: ContractStatus.RETURN_DUE }));
      expect((await refusal(service.endPreview('c-2', STAFF, AT))).errorCode).toBe(
        ErrorCode.INVALID_STATE_TRANSITION,
      );
      expect((await refusal(service.endPreview('c-2', OTHER_MANAGER, AT))).getStatus()).toBe(
        HttpStatus.NOT_FOUND,
      );
    });
  });
});
