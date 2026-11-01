import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { BalanceService, ChargesService, InvoicesService } from '../billing';
import { DevicesService } from '../devices';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ContractDecisionsService, HOLD_EXPIRED } from './contract-decisions.service';
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
  let balances: { balanceSummary: jest.Mock; firstPaymentConfirmed: jest.Mock };
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
      // No held rows: a contract requested before D-092, whose approval reserves (design §2.1).
      liveRows: jest.fn().mockResolvedValue([]),
      openTerm: jest.fn().mockResolvedValue(null),
      holdExpiresAt: jest.fn().mockResolvedValue(new Date('2026-10-26T02:00:00.000Z')),
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
      assetTags: jest.fn().mockResolvedValue(
        new Map([
          ['d-7', 'TL-0007'],
          ['d-8', 'TL-0008'],
        ]),
      ),
    };
    invoices = {
      issueTermInvoice: jest.fn().mockResolvedValue({}),
      issueDayPlanInvoice: jest.fn().mockResolvedValue({}),
    };
    charges = { settleCancellation: jest.fn().mockResolvedValue(null) };
    balances = {
      balanceSummary: jest.fn().mockResolvedValue({ paidVnd: 450_000n }),
      firstPaymentConfirmed: jest.fn().mockResolvedValue(false),
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

      expect(devices.reserve).toHaveBeenCalledWith(
        { id: 'v-3', code: 'treklink-v3' },
        2,
        AT,
        TX,
        { contractId: 'c-1', contractCode: 'RC-2026-0001', actorId: STAFF.id },
        undefined,
      );
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
          handoverAppointmentAt: new Date('2026-11-01T02:00:00.000Z'),
        },
        TX,
      );
      expect(approved.handoverAppointmentAt).toEqual(new Date('2026-11-01T02:00:00.000Z'));
      expect(approved.devices.map((device) => device.assetTag)).toEqual(['TL-0001', 'TL-0002']);
    });

    it('reserves only the Staff choice when explicit device IDs are supplied', async () => {
      await service.approve('c-1', { ...input, deviceIds: ['d-1', 'd-2'] }, STAFF, AT);
      expect(devices.reserve).toHaveBeenCalledWith(
        { id: 'v-3', code: 'treklink-v3' },
        2,
        AT,
        TX,
        { contractId: 'c-1', contractCode: 'RC-2026-0001', actorId: STAFF.id },
        ['d-1', 'd-2'],
      );
    });

    it.each([{ deviceIds: [] }, { deviceIds: ['d-1'] }, { deviceIds: ['d-1', 'd-1'] }])(
      'refuses an incomplete or duplicate explicit choice: $deviceIds',
      async ({ deviceIds }) => {
        await expect(
          service.approve('c-1', { ...input, deviceIds }, STAFF, AT),
        ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_FAILED });
        expect(devices.reserve).not.toHaveBeenCalled();
        expect(contracts.insertTerm).not.toHaveBeenCalled();
      },
    );

    it('refuses an appointment before the current minute with 400, reserving nothing (REQ-ERR-09)', async () => {
      await expect(
        service.approve(
          'c-1',
          { ...input, handoverAt: new Date('2026-10-26T02:59:00.000Z') },
          STAFF,
          new Date('2026-10-26T03:00:20.000Z'),
        ),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.VALIDATION_FAILED,
        message: 'The handover appointment is in the past. Choose a time from now on.',
      });
      expect(devices.reserve).not.toHaveBeenCalled();
      expect(contracts.insertTerm).not.toHaveBeenCalled();
      expect(lifecycle.apply).not.toHaveBeenCalled();
    });

    it('accepts an appointment in the current minute, the precision of the form', async () => {
      await service.approve(
        'c-1',
        { ...input, handoverAt: new Date('2026-10-26T03:00:00.000Z') },
        STAFF,
        new Date('2026-10-26T03:00:20.000Z'),
      );
      expect(devices.reserve).toHaveBeenCalled();
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

  describe('approve a request that holds its devices (D-092 rule 1)', () => {
    const input = { handoverAt: new Date('2026-11-01T02:00:00.000Z'), expectedVersion: 0 };
    const term = {
      id: 't-1',
      seq: 1,
      startsAt: new Date('2026-11-01T02:00:00.000Z'),
      endsAt: new Date('2026-12-01T02:00:00.000Z'),
      status: 'OPEN',
    };

    beforeEach(() => {
      contracts.liveRows.mockResolvedValue([
        { id: 'r-7', deviceId: 'd-7', handedOverAt: null },
        { id: 'r-8', deviceId: 'd-8', handedOverAt: null },
      ]);
      contracts.openTerm.mockResolvedValue(term);
      // The hold runs until an hour after AT unless a test moves it.
      contracts.holdExpiresAt.mockResolvedValue(new Date('2026-10-26T04:00:00.000Z'));
    });

    it('refuses an unpaid hold already past holdExpiresAt and changes nothing (REQ-ERR-12)', async () => {
      contracts.holdExpiresAt.mockResolvedValue(new Date('2026-10-26T03:00:00.000Z'));
      balances.firstPaymentConfirmed.mockResolvedValue(false);

      await expect(service.approve('c-1', input, STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
      expect(lifecycle.apply).not.toHaveBeenCalled();
      expect(devices.reserve).not.toHaveBeenCalled();
    });

    it('approves a hold past holdExpiresAt whose deposit is paid', async () => {
      contracts.holdExpiresAt.mockResolvedValue(new Date('2026-10-26T02:00:00.000Z'));
      balances.firstPaymentConfirmed.mockResolvedValue(true);

      await service.approve('c-1', input, STAFF, AT);

      expect(lifecycle.apply).toHaveBeenCalled();
    });

    it('keeps the held units, term 1 and the invoice of the request, and moves to APPROVED', async () => {
      const approved = await service.approve('c-1', input, STAFF, AT);

      expect(devices.reserve).not.toHaveBeenCalled();
      expect(contracts.insertContractDevices).not.toHaveBeenCalled();
      expect(contracts.insertTerm).not.toHaveBeenCalled();
      expect(invoices.issueTermInvoice).not.toHaveBeenCalled();
      expect(approved.devices).toEqual([
        { id: 'd-7', assetTag: 'TL-0007' },
        { id: 'd-8', assetTag: 'TL-0008' },
      ]);
      expect(approved.term).toEqual({ seq: 1, startsAt: term.startsAt, endsAt: term.endsAt });
      expect(lifecycle.apply).toHaveBeenCalledWith(
        'c-1',
        ContractStatus.REQUESTED,
        ContractStatus.APPROVED,
        'Handover appointment 2026-11-01T02:00:00.000Z',
        STAFF,
        TX,
      );
    });

    it('accepts deviceIds naming exactly the held set, in any order', async () => {
      await service.approve('c-1', { ...input, deviceIds: ['d-8', 'd-7'] }, STAFF, AT);
      expect(devices.reserve).not.toHaveBeenCalled();
      expect(lifecycle.apply).toHaveBeenCalled();
    });

    it('refuses deviceIds naming another set with 400, changing nothing (REQ-ERR-11)', async () => {
      await expect(
        service.approve('c-1', { ...input, deviceIds: ['d-7', 'd-9'] }, STAFF, AT),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.VALIDATION_FAILED,
        message: 'This request already holds TL-0007, TL-0008. Swap a unit at the counter instead.',
      });
      expect(devices.reserve).not.toHaveBeenCalled();
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

  it('releases the held units on rejection, voids the unpaid lines and answers the paid deposit (D-092)', async () => {
    const rejected = await service.reject(
      'c-1',
      { reason: 'Out of stock', expectedVersion: 0 },
      STAFF,
      AT,
    );
    expect(contracts.releaseReservedRows).toHaveBeenCalledWith('c-1', AT, TX);
    expect(devices.release).toHaveBeenCalledWith(['d-1', 'd-2'], AT, TX, {
      contractId: 'c-1',
      contractCode: 'RC-2026-0001',
      actorId: STAFF.id,
    });
    expect(charges.settleCancellation).toHaveBeenCalledWith(
      { id: 'c-1', organizationId: 'org-1' },
      'u-staff',
      TX,
      AT,
    );
    expect(rejected.paidVnd).toBe(450_000n);
    expect(rejected.contract.status).toBe(ContractStatus.REJECTED);
  });

  describe('expireHold (REQ-EVT-17)', () => {
    it('cancels an unpaid expired hold as SYSTEM, releasing the units and voiding the lines', async () => {
      await expect(service.expireHold('c-1', AT)).resolves.toBe(true);
      expect(balances.firstPaymentConfirmed).toHaveBeenCalledWith('c-1', TX);
      expect(lifecycle.apply).toHaveBeenCalledWith(
        'c-1',
        ContractStatus.REQUESTED,
        ContractStatus.CANCELLED,
        HOLD_EXPIRED,
        null,
        TX,
      );
      expect(devices.release).toHaveBeenCalledWith(['d-1', 'd-2'], AT, TX, {
        contractId: 'c-1',
        contractCode: 'RC-2026-0001',
        actorId: null,
      });
      expect(charges.settleCancellation).toHaveBeenCalledWith(
        { id: 'c-1', organizationId: 'org-1' },
        null,
        TX,
        AT,
      );
      expect(contracts.recordCancellation).toHaveBeenCalledWith('c-1', HOLD_EXPIRED, AT, TX);
    });

    it('keeps a hold whose deposit is paid', async () => {
      balances.firstPaymentConfirmed.mockResolvedValue(true);
      await expect(service.expireHold('c-1', AT)).resolves.toBe(false);
      expect(lifecycle.apply).not.toHaveBeenCalled();
      expect(devices.release).not.toHaveBeenCalled();
    });

    it('changes nothing before the expiry, for a contract without a hold, or one no longer REQUESTED', async () => {
      contracts.holdExpiresAt.mockResolvedValueOnce(new Date('2026-10-26T03:00:00.001Z'));
      await expect(service.expireHold('c-1', AT)).resolves.toBe(false);
      contracts.holdExpiresAt.mockResolvedValueOnce(null);
      await expect(service.expireHold('c-1', AT)).resolves.toBe(false);
      contracts.lockById.mockResolvedValueOnce(contract({ status: ContractStatus.APPROVED }));
      await expect(service.expireHold('c-1', AT)).resolves.toBe(false);
      expect(lifecycle.apply).not.toHaveBeenCalled();
      expect(charges.settleCancellation).not.toHaveBeenCalled();
    });
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
      expect(devices.release).toHaveBeenCalledWith(['d-1', 'd-2'], AT, TX, {
        contractId: 'c-1',
        contractCode: 'RC-2026-0001',
        actorId: MANAGER.id,
      });
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
