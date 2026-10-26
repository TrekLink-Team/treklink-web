import { EventEmitter2 } from '@nestjs/event-emitter';
import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PricingService } from '../billing';
import { OrganizationsService } from '../organizations';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ContractsRepository } from './contracts.repository';
import { ContractRequest, ContractsService } from './contracts.service';

const tx = { tx: true } as unknown as Prisma.TransactionClient;
// 09:00 on 26 October in UTC+7.
const AT = new Date('2026-10-26T02:00:00.000Z');
const MANAGER: Caller = { id: 'manager-1', roles: ['ORG_MANAGER'], organizationId: 'org-1' };
const SNAPSHOT = {
  monthlyUnitPriceVnd: 450_000n,
  dayPremium: new Prisma.Decimal('1.5'),
  holdingFeeRatio: new Prisma.Decimal('0.5'),
};
const PARAMETERS: Record<string, unknown> = {
  'rentals.minOrderQuantity': 5,
  'rentals.dayPlanLengths': [3, 4, 7],
};
const MONTHLY: ContractRequest = {
  planType: PlanType.MONTHLY,
  hardwareVariantId: 'v-3',
  quantity: 10,
  requestedStartDate: new Date('2026-10-26T00:00:00.000Z'),
};
const DAY: ContractRequest = {
  planType: PlanType.DAY,
  dayPlanDays: 4,
  hardwareVariantId: 'v-3',
  quantity: 8,
  requestedStartDate: new Date('2026-10-30T00:00:00.000Z'),
};

describe('ContractsService.request (rentals task 2.1, UC-15, REQ-EVT-01)', () => {
  let contracts: { insertRequested: jest.Mock };
  let organizations: { assertActive: jest.Mock };
  let pricing: { snapshot: jest.Mock };
  let parameters: { get: jest.Mock };
  let emitter: { emit: jest.Mock };
  let prisma: { $transaction: jest.Mock };
  let service: ContractsService;

  beforeEach(() => {
    contracts = {
      insertRequested: jest.fn().mockResolvedValue({
        id: 'c-1',
        code: 'RC-2026-0001',
        status: ContractStatus.REQUESTED,
      }),
    };
    organizations = { assertActive: jest.fn().mockResolvedValue(undefined) };
    pricing = { snapshot: jest.fn().mockResolvedValue(SNAPSHOT) };
    parameters = { get: jest.fn((key: string) => Promise.resolve(PARAMETERS[key])) };
    emitter = { emit: jest.fn() };
    prisma = {
      $transaction: jest.fn((work: (client: Prisma.TransactionClient) => Promise<unknown>) =>
        work(tx),
      ),
    };
    service = new ContractsService(
      contracts as unknown as ContractsRepository,
      organizations as unknown as OrganizationsService,
      pricing as unknown as PricingService,
      parameters as unknown as ParameterService,
      new TransactionalEvents(
        prisma as unknown as PrismaService,
        emitter as unknown as EventEmitter2,
      ),
    );
  });

  const refusal = async (input: ContractRequest, caller: Caller = MANAGER) => {
    const error = await service.request(input, caller, AT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainException);
    expect(contracts.insertRequested).not.toHaveBeenCalled();
    return error as DomainException;
  };

  it('inserts a monthly contract REQUESTED with the snapshot and returns its quote', async () => {
    await expect(service.request(MONTHLY, MANAGER, AT)).resolves.toEqual({
      contract: { id: 'c-1', code: 'RC-2026-0001', status: ContractStatus.REQUESTED },
      quote: { firstPaymentVnd: 2_250_000n, termFeeVnd: 4_500_000n },
    });

    expect(organizations.assertActive).toHaveBeenCalledWith('org-1', tx);
    expect(pricing.snapshot).toHaveBeenCalledWith('v-3', tx, AT);
    expect(contracts.insertRequested).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        planType: PlanType.MONTHLY,
        dayPlanDays: null,
        hardwareVariantId: 'v-3',
        quantity: 10,
        requestedStartDate: MONTHLY.requestedStartDate,
        monthlyUnitPriceVnd: 450_000n,
        dayPremium: null,
        holdingFeeRatio: SNAPSHOT.holdingFeeRatio,
        requestedById: 'manager-1',
      },
      AT,
      tx,
    );
    expect(emitter.emit).toHaveBeenCalledWith(AUDIT_RECORD, {
      actorId: 'manager-1',
      actorRoles: ['ORG_MANAGER'],
      organizationId: 'org-1',
      action: 'contract.request',
      subjectType: 'RentalContract',
      subjectId: 'c-1',
      after: {
        code: 'RC-2026-0001',
        planType: PlanType.MONTHLY,
        quantity: 10,
        monthlyUnitPriceVnd: '450000',
      },
    });
  });

  it('keeps the day premium on a day plan and quotes the whole amount up front', async () => {
    await expect(service.request(DAY, MANAGER, AT)).resolves.toMatchObject({
      quote: { firstPaymentVnd: 720_000n, totalVnd: 720_000n },
    });
    expect(contracts.insertRequested).toHaveBeenCalledWith(
      expect.objectContaining({
        planType: PlanType.DAY,
        dayPlanDays: 4,
        dayPremium: SNAPSHOT.dayPremium,
      }),
      AT,
      tx,
    );
  });

  it('stores the price of its own request: a later price reaches only later requests', async () => {
    await service.request(MONTHLY, MANAGER, AT);
    pricing.snapshot.mockResolvedValue({ ...SNAPSHOT, monthlyUnitPriceVnd: 500_000n });
    await service.request(MONTHLY, MANAGER, AT);

    expect(contracts.insertRequested).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ monthlyUnitPriceVnd: 450_000n }),
      AT,
      tx,
    );
    expect(contracts.insertRequested).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ monthlyUnitPriceVnd: 500_000n }),
      AT,
      tx,
    );
  });

  it('refuses a caller with no organization (403)', async () => {
    const error = await refusal(MONTHLY, { ...MANAGER, organizationId: null });
    expect(error.errorCode).toBe(ErrorCode.FORBIDDEN);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lets the organization check refuse first (409 ORGANIZATION_NOT_ACTIVE)', async () => {
    organizations.assertActive.mockRejectedValue(
      Object.assign(new DomainException(409, ErrorCode.ORGANIZATION_NOT_ACTIVE, 'suspended')),
    );
    const error = await refusal(MONTHLY);
    expect(error.errorCode).toBe(ErrorCode.ORGANIZATION_NOT_ACTIVE);
    expect(pricing.snapshot).not.toHaveBeenCalled();
  });

  it('refuses below the minimum order quantity (400 BELOW_MOQ, MSG13)', async () => {
    const error = await refusal({ ...MONTHLY, quantity: 4 });
    expect(error.errorCode).toBe(ErrorCode.BELOW_MOQ);
    expect(error.message).toBe('The minimum order is 5 devices.');
  });

  it.each([[undefined], [5]])(
    'refuses a day plan of %s days (400 DAY_PLAN_LENGTH)',
    async (days) => {
      const error = await refusal({ ...DAY, dayPlanDays: days });
      expect(error.errorCode).toBe(ErrorCode.DAY_PLAN_LENGTH);
      expect(error.message).toBe('Choose a plan of 3, 4 or 7 days.');
    },
  );

  it('treats a malformed day-plan parameter as no allowed length', async () => {
    PARAMETERS['rentals.dayPlanLengths'] = 'three';
    try {
      expect((await refusal(DAY)).errorCode).toBe(ErrorCode.DAY_PLAN_LENGTH);
    } finally {
      PARAMETERS['rentals.dayPlanLengths'] = [3, 4, 7];
    }
  });

  it('refuses a start date before today in UTC+7, and accepts today', async () => {
    const error = await refusal({
      ...MONTHLY,
      requestedStartDate: new Date('2026-10-25T00:00:00.000Z'),
    });
    expect(error.errorCode).toBe(ErrorCode.VALIDATION_FAILED);
    expect(error.message).toBe('requestedStartDate must not be in the past.');

    // 23:30 on 25 October UTC is already 26 October in Vietnam, so the 25th is in the past there.
    const lateEvening = new Date('2026-10-25T23:30:00.000Z');
    await expect(
      service.request(
        { ...MONTHLY, requestedStartDate: new Date('2026-10-25T00:00:00.000Z') },
        MANAGER,
        lateEvening,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_FAILED });
  });

  it('lets a missing price refuse through the snapshot, before anything is inserted', async () => {
    pricing.snapshot.mockRejectedValue(new DomainException(404, ErrorCode.NOT_FOUND, 'No price'));
    expect((await refusal(MONTHLY)).errorCode).toBe(ErrorCode.NOT_FOUND);
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('runs at the current time by default', async () => {
    await service.request(
      { ...MONTHLY, requestedStartDate: new Date('2099-01-01T00:00:00Z') },
      MANAGER,
    );
    expect(pricing.snapshot).toHaveBeenCalledWith('v-3', tx, expect.any(Date));
  });
});
