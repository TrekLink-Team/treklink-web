import { ContractStatus, InspectionResult, PlanType, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { BalanceService, ChargesService } from '../billing';
import { DevicesService } from '../devices';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractRow, ContractsRepository } from './contracts.repository';
import { DEVICE_CHECKED_IN, ReturnService } from './return.service';

const AT = new Date('2026-11-30T03:00:00.000Z');
const DUE = new Date('2026-11-25T02:00:00.000Z');
const TX = {} as Prisma.TransactionClient;
const STAFF: Caller = { id: 'u-staff', roles: ['STAFF'], organizationId: null };

const contract = (overrides: Partial<ContractRow> = {}): ContractRow => ({
  id: 'c-1',
  code: 'RC-2026-0001',
  organizationId: 'org-1',
  planType: PlanType.MONTHLY,
  dayPlanDays: null,
  hardwareVariantId: 'v-3',
  quantity: 2,
  requestedStartDate: new Date('2026-10-25T00:00:00.000Z'),
  monthlyUnitPriceVnd: 450_000n,
  dayPremium: null,
  holdingFeeRatio: new Prisma.Decimal('0.5'),
  status: ContractStatus.RETURN_DUE,
  statusChangedAt: DUE,
  handedOverAt: new Date('2026-10-25T03:00:00.000Z'),
  endsAt: DUE,
  noticeGivenAt: null,
  returnDueAt: DUE,
  version: 6,
  ...overrides,
});

describe('ReturnService (rentals tasks 4.1, 4.2, 4.4; MF-05)', () => {
  let contracts: Record<string, jest.Mock>;
  let lifecycle: { apply: jest.Mock };
  let devices: Record<string, jest.Mock>;
  let charges: Record<string, jest.Mock>;
  let balances: { outstanding: jest.Mock };
  let emitAfterCommit: jest.Mock;
  let closeCheck: { blockingReason: jest.Mock };
  let service: ReturnService;

  beforeEach(() => {
    contracts = {
      lockById: jest.fn().mockResolvedValue(contract()),
      rowsOut: jest.fn().mockResolvedValue([
        { id: 'cd-1', deviceId: 'd-1' },
        { id: 'cd-2', deviceId: 'd-2' },
      ]),
      openTerm: jest.fn().mockResolvedValue({ endsAt: new Date('2026-12-01T02:00:00Z') }),
      markCheckedIn: jest.fn().mockResolvedValue(undefined),
      returnCounts: jest.fn().mockResolvedValue({ total: 2, returned: 2 }),
      findDeviceRow: jest
        .fn()
        .mockResolvedValue({ id: 'cd-1', deviceId: 'd-1', handedOverAt: DUE, checkedInAt: AT }),
      liveRows: jest.fn().mockResolvedValue([{ id: 'cd-1', deviceId: 'd-1' }]),
      eraseLabels: jest.fn().mockResolvedValue(undefined),
      custodyDevices: jest.fn().mockResolvedValue(['d-1']),
      unsettledReplacedLosses: jest.fn().mockResolvedValue(0),
    };
    lifecycle = {
      apply: jest
        .fn()
        .mockImplementation((_id: string, _from: ContractStatus, to: ContractStatus) =>
          Promise.resolve(contract({ status: to })),
        ),
    };
    devices = {
      assetTags: jest.fn().mockResolvedValue(
        new Map([
          ['d-1', 'TL-0001'],
          ['d-2', 'TL-0002'],
        ]),
      ),
      markReturned: jest.fn().mockResolvedValue(undefined),
      recordInspection: jest.fn().mockResolvedValue({
        inspection: {
          id: 'in-1',
          result: 'DAMAGED',
          damageCodes: ['ANTENNA_BROKEN'],
          createdAt: AT,
        },
        device: { id: 'd-1', hardwareVariantId: 'v-3', status: 'MAINTENANCE' },
      }),
    };
    charges = {
      pendingDamage: jest.fn().mockResolvedValue(0),
      chargeLate: jest.fn().mockResolvedValue(null),
      chargeDamage: jest.fn().mockResolvedValue({
        charge: { id: 'dc-1', amountVnd: 300_000n, status: 'APPROVED' },
        invoice: null,
      }),
    };
    balances = { outstanding: jest.fn().mockResolvedValue(0n) };
    emitAfterCommit = jest.fn();
    closeCheck = { blockingReason: jest.fn().mockResolvedValue(null) };
    service = new ReturnService(
      contracts as unknown as ContractsRepository,
      lifecycle as unknown as ContractLifecycleService,
      devices as unknown as DevicesService,
      charges as unknown as ChargesService,
      balances as unknown as BalanceService,
      {
        transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
        emitAfterCommit,
      } as unknown as TransactionalEvents,
      [closeCheck],
    );
  });

  describe('checkIn (api-design 14)', () => {
    it('checks the scanned devices in, charges lateness and moves the contract to RETURNED (MSG07)', async () => {
      balances.outstanding.mockResolvedValueOnce(0n).mockResolvedValueOnce(160_000n);
      await expect(service.checkIn('c-1', ['TL-0001', ' TL-0002 '], STAFF, AT)).resolves.toEqual({
        checkedIn: ['TL-0001', 'TL-0002'],
        returned: 2,
        total: 2,
        contractStatus: ContractStatus.RETURNED,
        lateFeeVnd: 160_000,
      });
      expect(contracts.markCheckedIn).toHaveBeenCalledWith(['cd-1', 'cd-2'], AT, 'u-staff', TX);
      expect(devices.markReturned).toHaveBeenCalledWith(['d-1', 'd-2'], AT, TX);
      expect(charges.chargeLate).toHaveBeenCalledTimes(2);
      expect(lifecycle.apply).toHaveBeenCalledWith(
        'c-1',
        ContractStatus.RETURN_DUE,
        ContractStatus.RETURNED,
        'CHECKED_IN',
        STAFF,
        TX,
      );
      expect(emitAfterCommit).toHaveBeenCalledWith(
        DEVICE_CHECKED_IN,
        expect.objectContaining({ deviceId: 'd-1', contractId: 'c-1' }),
      );
    });

    it('keeps a due contract open while devices are still out', async () => {
      contracts.returnCounts.mockResolvedValue({ total: 2, returned: 1 });
      await expect(service.checkIn('c-1', ['TL-0001'], STAFF, AT)).resolves.toMatchObject({
        returned: 1,
        total: 2,
        contractStatus: ContractStatus.RETURN_DUE,
      });
      expect(lifecycle.apply).not.toHaveBeenCalled();
    });

    it('refuses a running monthly ACTIVE contract, accepts an ACTIVE day plan (REQ-STA-01)', async () => {
      contracts.lockById.mockResolvedValueOnce(contract({ status: ContractStatus.ACTIVE }));
      await expect(service.checkIn('c-1', ['TL-0001'], STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
      contracts.lockById.mockResolvedValueOnce(
        contract({ status: ContractStatus.ACTIVE, planType: PlanType.DAY, returnDueAt: null }),
      );
      await expect(service.checkIn('c-1', ['TL-0001'], STAFF, AT)).resolves.toMatchObject({
        contractStatus: ContractStatus.ACTIVE,
      });
      expect(charges.chargeLate).not.toHaveBeenCalled();
    });

    it.each([
      { status: ContractStatus.ACTIVE, planType: PlanType.DAY },
      { status: ContractStatus.ENDING, planType: PlanType.MONTHLY },
    ])(
      'charges lateness before the scheduler catches up for $planType $status',
      async ({ status, planType }) => {
        contracts.lockById.mockResolvedValue(contract({ status, planType, returnDueAt: null }));
        contracts.openTerm.mockResolvedValue({ endsAt: DUE });
        await service.checkIn('c-1', ['TL-0001'], STAFF, AT);
        expect(charges.chargeLate).toHaveBeenCalledWith(
          { id: 'c-1', organizationId: 'org-1', returnDueAt: DUE },
          { id: 'd-1', assetTag: 'TL-0001' },
          AT,
          'u-staff',
          TX,
        );
      },
    );

    it('does not silently check in a running plan whose term is missing', async () => {
      contracts.lockById.mockResolvedValue(
        contract({ status: ContractStatus.ACTIVE, planType: PlanType.DAY, returnDueAt: null }),
      );
      contracts.openTerm.mockResolvedValue(null);
      await expect(service.checkIn('c-1', ['TL-0001'], STAFF, AT)).rejects.toThrow(
        'has no open term',
      );
      expect(contracts.markCheckedIn).not.toHaveBeenCalled();
    });

    it('refuses tags that trim to nothing and moves nothing (review of #104)', async () => {
      await expect(service.checkIn('c-1', ['   ', ''], STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.VALIDATION_FAILED,
        message: 'assetTags must name at least one device.',
      });
      expect(contracts.lockById).not.toHaveBeenCalled();
      expect(contracts.markCheckedIn).not.toHaveBeenCalled();
      expect(lifecycle.apply).not.toHaveBeenCalled();
    });

    it('refuses a tag that is not out on the contract and stores nothing (MSG12)', async () => {
      await expect(service.checkIn('c-1', ['TL-0099'], STAFF, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.DEVICE_NOT_ON_CONTRACT,
        message: 'TL-0099 does not belong to contract RC-2026-0001.',
      });
      expect(contracts.markCheckedIn).not.toHaveBeenCalled();
    });
  });

  describe('inspect (api-design 16)', () => {
    it('records a DAMAGED inspection and its damage charge in one transaction', async () => {
      const input = {
        result: InspectionResult.DAMAGED,
        damageCodes: ['ANTENNA_BROKEN'],
        note: null,
      };
      await expect(service.inspect('c-1', 'd-1', input, STAFF, AT)).resolves.toEqual({
        inspection: expect.objectContaining({ id: 'in-1' }) as unknown,
        device: { id: 'd-1', assetTag: 'TL-0001', status: 'MAINTENANCE' },
        damageCharge: { id: 'dc-1', amountVnd: 300_000, status: 'APPROVED' },
      });
      expect(devices.recordInspection).toHaveBeenCalledWith(
        'd-1',
        expect.objectContaining({ contractDeviceId: 'cd-1', checkedInAt: AT }),
        'u-staff',
        AT,
        TX,
      );
      expect(charges.chargeDamage).toHaveBeenCalledWith(
        { id: 'c-1', organizationId: 'org-1' },
        expect.objectContaining({ id: 'in-1', assetTag: 'TL-0001', hardwareVariantId: 'v-3' }),
        'u-staff',
        TX,
        AT,
      );
    });

    it('needs damage codes for DAMAGED, and refuses a CLOSED contract', async () => {
      await expect(
        service.inspect(
          'c-1',
          'd-1',
          { result: 'DAMAGED', damageCodes: [], note: null },
          STAFF,
          AT,
        ),
      ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_FAILED });
      contracts.lockById.mockResolvedValueOnce(contract({ status: ContractStatus.CLOSED }));
      await expect(
        service.inspect('c-1', 'd-1', { result: 'PASSED', damageCodes: [], note: null }, STAFF, AT),
      ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_STATE_TRANSITION });
    });
  });

  describe('close (api-design 17)', () => {
    beforeEach(() =>
      contracts.lockById.mockResolvedValue(contract({ status: ContractStatus.RETURNED })),
    );

    it('closes a settled RETURNED contract and erases the holder labels', async () => {
      await expect(service.close('c-1', 6, STAFF)).resolves.toMatchObject({
        status: ContractStatus.CLOSED,
      });
      expect(contracts.eraseLabels).toHaveBeenCalledWith('c-1', TX);
      expect(closeCheck.blockingReason).toHaveBeenCalledWith('c-1', ['d-1'], TX);
      // Found by the contract the charge stores (D-081).
      expect(charges.pendingDamage).toHaveBeenCalledWith('c-1', TX);
    });

    it('refuses a stale version, an open balance and an open incident', async () => {
      await expect(service.close('c-1', 5, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.STALE_VERSION,
      });
      balances.outstanding.mockResolvedValueOnce(1_000n);
      await expect(service.close('c-1', 6, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.BALANCE_OUTSTANDING,
      });
      closeCheck.blockingReason.mockResolvedValueOnce({
        code: 'OPEN_INCIDENTS',
        message: 'This cannot be done while it has open incidents.',
      });
      await expect(service.close('c-1', 6, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.OPEN_INCIDENTS,
      });
      expect(lifecycle.apply).not.toHaveBeenCalled();
    });

    it('refuses a contract with a damage charge still waiting for an Admin (api-design 17, REQ-ERR-05)', async () => {
      charges.pendingDamage.mockResolvedValueOnce(1);
      await expect(service.close('c-1', 6, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.BALANCE_OUTSTANDING,
        message: 'This cannot be done while it has open balances.',
      });
      expect(closeCheck.blockingReason).not.toHaveBeenCalled();
      expect(contracts.eraseLabels).not.toHaveBeenCalled();
      expect(lifecycle.apply).not.toHaveBeenCalled();
    });

    it('refuses a contract with a unit replaced while missing until its loss settles (rentals 4.3)', async () => {
      contracts.unsettledReplacedLosses.mockResolvedValueOnce(1);
      await expect(service.close('c-1', 6, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.BALANCE_OUTSTANDING,
      });
      expect(lifecycle.apply).not.toHaveBeenCalled();
    });

    it('refuses a contract that is not RETURNED', async () => {
      contracts.lockById.mockResolvedValueOnce(contract({ status: ContractStatus.OVERDUE }));
      await expect(service.close('c-1', 6, STAFF)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
        message: 'This cannot be done while it is OVERDUE.',
      });
    });
  });
});
