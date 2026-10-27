import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { BalanceService, ChargesService, InvoicesService } from '../billing';
import { DevicesService } from '../devices';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ContractDecisionsService, DEVICE_LABEL_CHANGED } from './contract-decisions.service';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractRow, ContractsRepository } from './contracts.repository';

const AT = new Date('2026-11-10T03:00:00.000Z');
const TERM_END = new Date('2026-11-25T02:00:00.000Z');
const TX = {} as Prisma.TransactionClient;
const MANAGER: Caller = { id: 'u-mgr', roles: ['ORG_MANAGER'], organizationId: 'org-1' };
const OPERATOR: Caller = { id: 'u-op', roles: ['ORG_OPERATOR'], organizationId: 'org-1' };
const OTHER: Caller = { id: 'u-x', roles: ['ORG_MANAGER'], organizationId: 'org-2' };

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
  status: ContractStatus.ACTIVE,
  statusChangedAt: AT,
  handedOverAt: AT,
  endsAt: null,
  noticeGivenAt: null,
  returnDueAt: null,
  version: 4,
  ...overrides,
});

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'cd-1',
  deviceId: 'd-1',
  handedOverAt: AT,
  checkedInAt: null,
  lostAt: null,
  holderName: null,
  holderPhone: null,
  holderEmergencyContact: null,
  ...overrides,
});

describe('ContractDecisionsService notice and holder labels (rentals 3.1 part, 2.5)', () => {
  let contracts: Record<string, jest.Mock>;
  let lifecycle: { apply: jest.Mock };
  let emitAfterCommit: jest.Mock;
  let service: ContractDecisionsService;

  beforeEach(() => {
    contracts = {
      lockById: jest.fn().mockResolvedValue(contract()),
      openTerm: jest.fn().mockResolvedValue({
        id: 't-1',
        seq: 1,
        startsAt: new Date('2026-10-25T02:00:00.000Z'),
        endsAt: TERM_END,
        status: 'OPEN',
      }),
      recordNotice: jest.fn().mockResolvedValue(undefined),
      findDeviceRow: jest.fn().mockResolvedValue(row()),
      setHolder: jest
        .fn()
        .mockImplementation(() => Promise.resolve(row({ holderName: 'Le Thi E' }))),
    };
    lifecycle = {
      apply: jest.fn().mockResolvedValue(contract({ status: ContractStatus.ENDING, version: 5 })),
    };
    emitAfterCommit = jest.fn();
    const events = {
      transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
      emitAfterCommit,
    };
    service = new ContractDecisionsService(
      contracts as unknown as ContractsRepository,
      lifecycle as unknown as ContractLifecycleService,
      {} as DevicesService,
      {} as InvoicesService,
      {} as ChargesService,
      {
        balanceSummary: jest.fn().mockResolvedValue({ dueLaterVnd: 450_000n }),
      } as unknown as BalanceService,
      {} as ParameterService,
      events as unknown as TransactionalEvents,
    );
  });

  describe('giveNotice (MSG18)', () => {
    it('moves an ACTIVE monthly contract to ENDING with the term end and the amount due then', async () => {
      const notice = await service.giveNotice('c-1', 4, MANAGER, AT);
      expect(lifecycle.apply).toHaveBeenCalledWith(
        'c-1',
        ContractStatus.ACTIVE,
        ContractStatus.ENDING,
        'NOTICE',
        MANAGER,
        TX,
      );
      expect(contracts.recordNotice).toHaveBeenCalledWith(
        'c-1',
        { noticeGivenAt: AT, noticeGivenById: 'u-mgr', endsAt: TERM_END },
        TX,
      );
      expect(notice.contract).toMatchObject({ status: ContractStatus.ENDING, endsAt: TERM_END });
      expect(notice.dueAtEndVnd).toBe(450_000n);
    });

    it('refuses a day plan with 409 DAY_PLAN_NO_NOTICE', async () => {
      contracts.lockById.mockResolvedValue(contract({ planType: PlanType.DAY, dayPlanDays: 4 }));
      await expect(service.giveNotice('c-1', 4, MANAGER, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.DAY_PLAN_NO_NOTICE,
      });
    });

    it('refuses a contract that is not ACTIVE, a stale version, and another organization', async () => {
      contracts.lockById.mockResolvedValueOnce(contract({ status: ContractStatus.APPROVED }));
      await expect(service.giveNotice('c-1', 4, MANAGER, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
      await expect(service.giveNotice('c-1', 3, MANAGER, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.STALE_VERSION,
      });
      await expect(service.giveNotice('c-1', 4, OTHER, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
      expect(lifecycle.apply).not.toHaveBeenCalled();
    });
  });

  describe('setHolder (AC-07)', () => {
    const holder = { name: 'Le Thi E', phone: '0912345678', emergencyContact: null };

    it('labels a device that is out and emits device.labelChanged with the name only', async () => {
      await service.setHolder('c-1', 'd-1', holder, OPERATOR, AT);
      expect(contracts.setHolder).toHaveBeenCalledWith('cd-1', holder, TX);
      expect(emitAfterCommit).toHaveBeenCalledWith(DEVICE_LABEL_CHANGED, {
        deviceId: 'd-1',
        contractId: 'c-1',
        organizationId: 'org-1',
        holder: { name: 'Le Thi E' },
        at: AT,
      });
    });

    it('clears the label with a null holder', async () => {
      await service.setHolder('c-1', 'd-1', null, MANAGER, AT);
      expect(contracts.setHolder).toHaveBeenCalledWith('cd-1', null, TX);
      expect(emitAfterCommit).toHaveBeenCalledWith(
        DEVICE_LABEL_CHANGED,
        expect.objectContaining({ holder: null }),
      );
    });

    it('refuses a device not on the contract with 409 DEVICE_NOT_ON_CONTRACT (MSG12)', async () => {
      contracts.findDeviceRow.mockResolvedValue(null);
      await expect(service.setHolder('c-1', 'd-9', holder, MANAGER, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.DEVICE_NOT_ON_CONTRACT,
      });
    });

    it('refuses a device back at TrekLink, a closed contract, a TrekLink account and another organization', async () => {
      contracts.findDeviceRow.mockResolvedValueOnce(row({ checkedInAt: AT }));
      await expect(service.setHolder('c-1', 'd-1', holder, MANAGER, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
      contracts.lockById.mockResolvedValueOnce(contract({ status: ContractStatus.CLOSED }));
      await expect(service.setHolder('c-1', 'd-1', holder, MANAGER, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      });
      const staff: Caller = { id: 'u-s', roles: ['STAFF'], organizationId: null };
      await expect(service.setHolder('c-1', 'd-1', holder, staff, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
      await expect(service.setHolder('c-1', 'd-1', holder, OTHER, AT)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
      expect(contracts.setHolder).not.toHaveBeenCalled();
    });
  });
});
