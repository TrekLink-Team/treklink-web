import { EventEmitter2 } from '@nestjs/event-emitter';
import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InvoicesService, PricingService } from '../billing';
import { DevicesService } from '../devices';
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
  'rentals.requestHoldHours': 24,
};
const HELD = Array.from({ length: 10 }, (_, i) => ({ id: `d-${i}`, assetTag: `TL-00${10 + i}` }));
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
  let contracts: {
    insertRequested: jest.Mock;
    insertContractDevices: jest.Mock;
    insertTerm: jest.Mock;
  };
  let organizations: { lockActive: jest.Mock };
  let pricing: { snapshot: jest.Mock };
  let devices: { variants: jest.Mock; reserve: jest.Mock };
  let invoices: { issueTermInvoice: jest.Mock; issueDayPlanInvoice: jest.Mock };
  let parameters: { get: jest.Mock };
  let emitter: { emit: jest.Mock };
  let prisma: { $transaction: jest.Mock };
  let service: ContractsService;

  beforeEach(() => {
    contracts = {
      insertRequested: jest.fn().mockImplementation((data: object) =>
        Promise.resolve({
          ...data,
          id: 'c-1',
          code: 'RC-2026-0001',
          status: ContractStatus.REQUESTED,
          version: 0,
        }),
      ),
      insertContractDevices: jest.fn().mockResolvedValue(undefined),
      insertTerm: jest
        .fn()
        .mockImplementation((term: object) =>
          Promise.resolve({ id: 't-1', status: 'OPEN', ...term }),
        ),
    };
    invoices = {
      issueTermInvoice: jest.fn().mockResolvedValue({}),
      issueDayPlanInvoice: jest.fn().mockResolvedValue({}),
    };
    organizations = { lockActive: jest.fn().mockResolvedValue(undefined) };
    pricing = { snapshot: jest.fn().mockResolvedValue(SNAPSHOT) };
    devices = {
      variants: jest.fn().mockResolvedValue([{ id: 'v-3', code: 'treklink-v3', isActive: true }]),
      reserve: jest.fn((_variant: unknown, quantity: number) =>
        Promise.resolve(HELD.slice(0, quantity)),
      ),
    };
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
      devices as unknown as DevicesService,
      invoices as unknown as InvoicesService,
    );
  });

  const refusal = async (input: ContractRequest, caller: Caller = MANAGER) => {
    const error = await service.request(input, caller, AT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainException);
    expect(contracts.insertRequested).not.toHaveBeenCalled();
    return error as DomainException;
  };

  it('inserts a monthly contract REQUESTED with the snapshot and returns its quote', async () => {
    await expect(service.request(MONTHLY, MANAGER, AT)).resolves.toMatchObject({
      contract: { id: 'c-1', code: 'RC-2026-0001', status: ContractStatus.REQUESTED },
      quote: { firstPaymentVnd: 2_250_000n, termFeeVnd: 4_500_000n },
    });

    expect(organizations.lockActive).toHaveBeenCalledWith('org-1', tx);
    expect(devices.variants).toHaveBeenCalledWith(true, tx);
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
        holdExpiresAt: new Date('2026-10-27T02:00:00.000Z'),
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
        heldDevices: 10,
        holdExpiresAt: '2026-10-27T02:00:00.000Z',
      },
    });
  });

  describe('the hold at request (D-092 rule 1, design §2.1)', () => {
    it('holds the quantity, opens term 1 and issues the first invoice in the request transaction', async () => {
      const requested = await service.request(MONTHLY, MANAGER, AT);

      expect(devices.reserve).toHaveBeenCalledWith({ id: 'v-3', code: 'treklink-v3' }, 10, AT, tx, {
        contractId: 'c-1',
        contractCode: 'RC-2026-0001',
        actorId: 'manager-1',
      });
      expect(contracts.insertContractDevices).toHaveBeenCalledWith(
        HELD.map((device) => ({ contractId: 'c-1', deviceId: device.id })),
        tx,
      );
      // Term 1 from 09:00 UTC+7 on the start date, one calendar month.
      expect(contracts.insertTerm).toHaveBeenCalledWith(
        {
          contractId: 'c-1',
          seq: 1,
          startsAt: new Date('2026-10-26T02:00:00.000Z'),
          endsAt: new Date('2026-11-26T02:00:00.000Z'),
        },
        tx,
      );
      expect(invoices.issueTermInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c-1', quantity: 10, variantCode: 'treklink-v3' }),
        expect.objectContaining({ id: 't-1', seq: 1 }),
        tx,
        AT,
      );
      expect(requested).toMatchObject({
        heldDevices: 10,
        holdExpiresAt: new Date('2026-10-27T02:00:00.000Z'),
        term: { id: 't-1', seq: 1 },
      });
    });

    it('issues the day-plan invoice for a day plan', async () => {
      await service.request(DAY, MANAGER, AT);
      expect(invoices.issueDayPlanInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c-1', dayPlanDays: 4, quantity: 8, termId: 't-1' }),
        tx,
        AT,
      );
      expect(invoices.issueTermInvoice).not.toHaveBeenCalled();
    });

    it('lets a shortfall refuse with 409 INSUFFICIENT_DEVICES before any row, term or event (MSG11)', async () => {
      devices.reserve.mockRejectedValue(
        new DomainException(
          409,
          ErrorCode.INSUFFICIENT_DEVICES,
          'Only 7 treklink-v3 devices are available. Lower the quantity or choose another variant.',
        ),
      );
      await expect(service.request(MONTHLY, MANAGER, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.INSUFFICIENT_DEVICES,
      });
      expect(contracts.insertContractDevices).not.toHaveBeenCalled();
      expect(contracts.insertTerm).not.toHaveBeenCalled();
      expect(invoices.issueTermInvoice).not.toHaveBeenCalled();
      // Events go out only after commit; the rolled-back request emits nothing.
      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it('reads the hold length from rentals.requestHoldHours (D-015)', async () => {
      PARAMETERS['rentals.requestHoldHours'] = 2;
      try {
        await expect(service.request(MONTHLY, MANAGER, AT)).resolves.toMatchObject({
          holdExpiresAt: new Date('2026-10-26T04:00:00.000Z'),
        });
      } finally {
        PARAMETERS['rentals.requestHoldHours'] = 24;
      }
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
    organizations.lockActive.mockRejectedValue(
      Object.assign(new DomainException(409, ErrorCode.ORGANIZATION_NOT_ACTIVE, 'suspended')),
    );
    const error = await refusal(MONTHLY);
    expect(error.errorCode).toBe(ErrorCode.ORGANIZATION_NOT_ACTIVE);
    expect(pricing.snapshot).not.toHaveBeenCalled();
  });

  it('refuses a request that waited on a closing which committed first (409, CLOSED)', async () => {
    // The closing held the organization row; once it commits, the FOR SHARE read sees CLOSED.
    organizations.lockActive.mockRejectedValue(
      new DomainException(
        409,
        ErrorCode.ORGANIZATION_NOT_ACTIVE,
        'Your organization cannot request devices while it is CLOSED.',
      ),
    );
    const error = await refusal(MONTHLY);
    expect(error.errorCode).toBe(ErrorCode.ORGANIZATION_NOT_ACTIVE);
    expect(error.message).toBe('Your organization cannot request devices while it is CLOSED.');
    expect(organizations.lockActive).toHaveBeenCalledWith('org-1', tx);
    expect(emitter.emit).not.toHaveBeenCalled();
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

  it.each([
    ['unknown', []],
    ['inactive', [{ id: 'v-3', isActive: false }]],
  ])('refuses an %s variant before pricing or writing a contract', async (_, variants) => {
    devices.variants.mockResolvedValue(variants);
    expect((await refusal(MONTHLY)).errorCode).toBe(ErrorCode.NOT_FOUND);
    expect(pricing.snapshot).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
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
