import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { BalanceService, ChargesService, InvoicesService } from '../billing';
import { DevicesService } from '../devices';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ContractDecisionsService } from './contract-decisions.service';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractRow, ContractsRepository } from './contracts.repository';

const AT = new Date('2026-10-26T03:00:00.000Z');
const TX = {} as Prisma.TransactionClient;
const STAFF: Caller = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
const MANAGER: Caller = { id: 'u-mgr', roles: ['ORG_MANAGER'], organizationId: 'org-1' };

const contract = (overrides: Partial<ContractRow> = {}): ContractRow => ({
  id: 'c-1',
  code: 'RC-2026-0001',
  organizationId: 'org-1',
  planType: PlanType.MONTHLY,
  dayPlanDays: null,
  hardwareVariantId: 'v-3',
  quantity: 2,
  requestedStartDate: new Date('2026-11-01T00:00:00.000Z'),
  monthlyUnitPriceVnd: 450_000n,
  dayPremium: null,
  holdingFeeRatio: new Prisma.Decimal('0.5'),
  status: ContractStatus.REQUESTED,
  statusChangedAt: AT,
  handedOverAt: null,
  endsAt: null,
  noticeGivenAt: null,
  returnDueAt: null,
  version: 0,
  ...overrides,
});

describe('ContractDecisionsService (rentals task 2.2)', () => {
  let contracts: Record<string, jest.Mock>;
  let lifecycle: { apply: jest.Mock };
  let devices: Record<string, jest.Mock>;
  let invoices: Record<string, jest.Mock>;
  let charges: { settleCancellation: jest.Mock };
  let balances: { balanceSummary: jest.Mock };
  let service: ContractDecisionsService;

  beforeEach(() => {
    contracts = {
      lockById: jest.fn().mockResolvedValue(contract()),
      insertContractDevices: jest.fn().mockResolvedValue(undefined),
      insertTerm: jest
        .fn()
        .mockImplementation((term: object) =>
          Promise.resolve({ id: 't-1', status: 'OPEN', ...term }),
        ),
      recordDecision: jest.fn().mockResolvedValue(undefined),
      recordCancellation: jest.fn().mockResolvedValue(undefined),
      releaseReservedRows: jest.fn().mockResolvedValue(['d-1', 'd-2']),
    };
    lifecycle = {
      apply: jest
        .fn()
        .mockImplementation((_id: string, _from: ContractStatus, to: ContractStatus) =>
          Promise.resolve(contract({ status: to, version: 1 })),
        ),
    };
    devices = {
      variants: jest.fn().mockResolvedValue([{ id: 'v-3', code: 'treklink-v3' }]),
      reserve: jest.fn().mockResolvedValue([
        { id: 'd-1', assetTag: 'TL-0001' },
        { id: 'd-2', assetTag: 'TL-0002' },
      ]),
      release: jest.fn().mockResolvedValue(undefined),
    };
    invoices = {
      issueTermInvoice: jest.fn().mockResolvedValue({}),
      issueDayPlanInvoice: jest.fn().mockResolvedValue({}),
    };
    charges = { settleCancellation: jest.fn().mockResolvedValue(null) };
    balances = {
      balanceSummary: jest.fn().mockResolvedValue({ paidVnd: 450_000n }),
    };
    const events = {
      transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
    };
    const parameters = { get: jest.fn().mockResolvedValue(48) };
    service = new ContractDecisionsService(
      contracts as unknown as ContractsRepository,
      lifecycle as unknown as ContractLifecycleService,
      devices as unknown as DevicesService,
      invoices as unknown as InvoicesService,
      charges as unknown as ChargesService,
      balances as unknown as BalanceService,
      parameters as unknown as ParameterService,
      events as unknown as TransactionalEvents,
    );
  });

  describe('approve (REQ-EVT-02)', () => {
    const input = { handoverAt: new Date('2026-11-01T02:00:00.000Z'), expectedVersion: 0 };

    it('reserves the units, creates term 1, issues the term invoice and moves to APPROVED', async () => {
      const approved = await service.approve('c-1', input, STAFF, AT);

      expect(devices.reserve).toHaveBeenCalledWith({ id: 'v-3', code: 'treklink-v3' }, 2, AT, TX);
      expect(contracts.insertContractDevices).toHaveBeenCalledWith(
        [
          { contractId: 'c-1', deviceId: 'd-1' },
          { contractId: 'c-1', deviceId: 'd-2' },
        ],
        TX,
      );
      expect(contracts.insertTerm).toHaveBeenCalledWith(
        {
          contractId: 'c-1',
          seq: 1,
          startsAt: new Date('2026-11-01T02:00:00.000Z'),
          endsAt: new Date('2026-12-01T02:00:00.000Z'),
        },
        TX,
      );
      expect(invoices.issueTermInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c-1', variantCode: 'treklink-v3', quantity: 2 }),
        expect.objectContaining({ id: 't-1', seq: 1 }),
        TX,
        AT,
      );
      expect(lifecycle.apply).toHaveBeenCalledWith(
        'c-1',
        ContractStatus.REQUESTED,
        ContractStatus.APPROVED,
        'Handover appointment 2026-11-01T02:00:00.000Z',
        STAFF,
        TX,
      );
      expect(approved.reservationExpiresAt).toEqual(new Date('2026-11-03T02:00:00.000Z'));
      expect(contracts.recordDecision).toHaveBeenCalledWith(
        'c-1',
        {
          decidedById: 'u-staff',
          decidedAt: AT,
          reservationExpiresAt: approved.reservationExpiresAt,
        },
        TX,
      );
      expect(approved.devices.map((device) => device.assetTag)).toEqual(['TL-0001', 'TL-0002']);
    });

    it('issues a day-plan invoice for a day plan', async () => {
      contracts.lockById.mockResolvedValue(
        contract({
          planType: PlanType.DAY,
          dayPlanDays: 4,
          dayPremium: new Prisma.Decimal('1.5'),
        }),
      );
      await service.approve('c-1', input, STAFF, AT);
      expect(invoices.issueDayPlanInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ dayPlanDays: 4, termId: 't-1' }),
        TX,
        AT,
      );
      expect(invoices.issueTermInvoice).not.toHaveBeenCalled();
    });

    it('refuses a stale version with 409 STALE_VERSION before reserving anything', async () => {
      await expect(
        service.approve('c-1', { ...input, expectedVersion: 3 }, STAFF, AT),
      ).rejects.toMatchObject({ errorCode: ErrorCode.STALE_VERSION });
      expect(devices.reserve).not.toHaveBeenCalled();
    });

    it('refuses a contract that is no longer REQUESTED with 409', async () => {
      contracts.lockById.mockResolvedValue(contract({ status: ContractStatus.CANCELLED }));
      await expect(service.approve('c-1', input, STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
    });

    it('lets a device shortfall stop the approval before any term or invoice', async () => {
      devices.reserve.mockRejectedValue(new Error('INSUFFICIENT_DEVICES'));
      await expect(service.approve('c-1', input, STAFF, AT)).rejects.toThrow(
        'INSUFFICIENT_DEVICES',
      );
      expect(contracts.insertTerm).not.toHaveBeenCalled();
      expect(lifecycle.apply).not.toHaveBeenCalled();
    });
  });

  it('rejects with the reason the Manager sees (MSG16)', async () => {
    await service.reject('c-1', { reason: 'Out of stock', expectedVersion: 0 }, STAFF, AT);
    expect(lifecycle.apply).toHaveBeenCalledWith(
      'c-1',
      ContractStatus.REQUESTED,
      ContractStatus.REJECTED,
      'Out of stock',
      STAFF,
      TX,
    );
    expect(contracts.recordDecision).toHaveBeenCalledWith(
      'c-1',
      { decidedById: 'u-staff', decidedAt: AT, rejectionReason: 'Out of stock' },
      TX,
    );
  });

  describe('cancel (FR-CON-04, MSG15)', () => {
    it('releases the reserved units, settles the invoice and reports what was paid as retained', async () => {
      contracts.lockById.mockResolvedValue(contract({ status: ContractStatus.APPROVED }));
      const result = await service.cancel(
        'c-1',
        { reason: 'Tour cancelled', expectedVersion: 0 },
        MANAGER,
        AT,
      );
      expect(devices.release).toHaveBeenCalledWith(['d-1', 'd-2'], AT, TX);
      expect(charges.settleCancellation).toHaveBeenCalledWith(
        { id: 'c-1', organizationId: 'org-1' },
        'u-mgr',
        TX,
        AT,
      );
      expect(contracts.recordCancellation).toHaveBeenCalledWith('c-1', 'Tour cancelled', AT, TX);
      expect(result.retainedVnd).toBe(450_000n);
    });

    it("answers 404 for another organization's contract", async () => {
      contracts.lockById.mockResolvedValue(contract({ organizationId: 'org-2' }));
      await expect(
        service.cancel('c-1', { reason: 'x', expectedVersion: 0 }, MANAGER, AT),
      ).rejects.toMatchObject({ errorCode: ErrorCode.NOT_FOUND });
      expect(lifecycle.apply).not.toHaveBeenCalled();
    });
  });
});
