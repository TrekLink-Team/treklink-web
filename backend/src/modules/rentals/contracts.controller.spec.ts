import { ExecutionContext } from '@nestjs/common';
import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import {
  CHECK_POLICIES_KEY,
  PolicyAbility,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { DevicesService } from '../devices';
import { ContractDecisionsService } from './contract-decisions.service';
import { ContractReadsService } from './contract-reads.service';
import { callerOrganization, ContractsController, toContractView } from './contracts.controller';
import { ContractRow } from './contracts.repository';
import { ContractsService } from './contracts.service';

const AT = new Date('2026-10-26T15:00:00.000Z');
const MANAGER = { id: 'manager-1', roles: ['ORG_MANAGER'], organizationId: 'org-1' };
const ORG = { id: 'org-1', code: 'ORG-0001', legalName: 'ACME Trek Co., Ltd.' };

const CONTRACT: ContractRow = {
  id: 'c-1',
  code: 'RC-2026-0002',
  organizationId: 'org-1',
  planType: PlanType.MONTHLY,
  dayPlanDays: null,
  hardwareVariantId: 'v-3',
  quantity: 10,
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
  version: 1,
};

const contextWith = (user: unknown) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;

describe('ContractsController (rentals api-design 01)', () => {
  let contracts: { request: jest.Mock };
  let devices: { variants: jest.Mock };
  let controller: ContractsController;

  beforeEach(() => {
    contracts = {
      request: jest.fn().mockResolvedValue({
        contract: CONTRACT,
        quote: { firstPaymentVnd: 2_250_000n, termFeeVnd: 4_500_000n },
        heldDevices: 10,
        term: {
          id: 't-1',
          seq: 1,
          startsAt: new Date('2026-11-01T02:00:00.000Z'),
          endsAt: new Date('2026-12-01T02:00:00.000Z'),
        },
        holdExpiresAt: new Date('2026-10-27T03:00:00.000Z'),
      }),
    };
    devices = {
      variants: jest
        .fn()
        .mockResolvedValue([
          { id: 'v-3', code: 'treklink-v3', name: 'TrekLink v3', isActive: true },
        ]),
    };
    controller = new ContractsController(
      contracts as unknown as ContractsService,
      devices as unknown as DevicesService,
      {} as ContractReadsService,
      {} as ContractDecisionsService,
    );
  });

  it('requests the contract with the start date at UTC midnight and answers the api-design shape', async () => {
    const dto = {
      planType: PlanType.MONTHLY,
      hardwareVariantId: 'v-3',
      quantity: 10,
      requestedStartDate: '2026-11-01',
    };

    await expect(controller.request(dto, MANAGER, ORG)).resolves.toEqual({
      id: 'c-1',
      code: 'RC-2026-0002',
      organization: ORG,
      planType: PlanType.MONTHLY,
      dayPlanDays: null,
      hardwareVariant: { id: 'v-3', code: 'treklink-v3' },
      quantity: 10,
      requestedStartDate: '2026-11-01',
      monthlyUnitPriceVnd: 450_000,
      dayPremium: null,
      holdingFeeRatio: 0.5,
      status: ContractStatus.REQUESTED,
      statusChangedAt: AT,
      handedOverAt: null,
      // D-092 rule 1: the request opens term 1, holds the units and answers the hold expiry.
      currentTerm: {
        seq: 1,
        startsAt: new Date('2026-11-01T02:00:00.000Z'),
        endsAt: new Date('2026-12-01T02:00:00.000Z'),
      },
      endsAt: null,
      noticeGivenAt: null,
      returnDueAt: null,
      version: 1,
      quote: { firstPaymentVnd: 2_250_000, termFeeVnd: 4_500_000 },
      holdExpiresAt: new Date('2026-10-27T03:00:00.000Z'),
      heldDevices: 10,
    });
    expect(contracts.request).toHaveBeenCalledWith(
      {
        planType: PlanType.MONTHLY,
        dayPlanDays: undefined,
        hardwareVariantId: 'v-3',
        quantity: 10,
        requestedStartDate: new Date('2026-11-01T00:00:00.000Z'),
      },
      MANAGER,
    );
    expect(devices.variants).toHaveBeenCalledWith(false);
  });

  it('leaves the variant code null when the variant is not listed', async () => {
    devices.variants.mockResolvedValue([]);
    const view = await controller.request(
      {
        planType: PlanType.DAY,
        dayPlanDays: 4,
        hardwareVariantId: 'v-3',
        quantity: 8,
        requestedStartDate: '2026-11-01',
      },
      MANAGER,
      null,
    );
    expect(view.hardwareVariant).toEqual({ id: 'v-3', code: null });
    expect(view.organization).toBeNull();
  });

  it('shows a day plan premium as a number', () => {
    const view = toContractView(
      {
        ...CONTRACT,
        planType: PlanType.DAY,
        dayPlanDays: 4,
        dayPremium: new Prisma.Decimal('1.5'),
      },
      ORG,
      'treklink-v3',
      { firstPaymentVnd: 720_000n, totalVnd: 720_000n },
    );
    expect(view.dayPremium).toBe(1.5);
    expect(view.quote).toEqual({ firstPaymentVnd: 720_000, totalVnd: 720_000 });
  });

  it('reads the organization of the verified caller, null for a TrekLink account or no user', () => {
    expect(
      callerOrganization(undefined, contextWith({ organization: { ...ORG, status: 'ACTIVE' } })),
    ).toEqual(ORG);
    expect(callerOrganization(undefined, contextWith({ organization: null }))).toBeNull();
    expect(callerOrganization(undefined, contextWith(undefined))).toBeNull();
  });

  it('answers each device row of the detail with its reset and inspection, null when none', async () => {
    const checkedInAt = new Date('2026-10-30T03:00:00.000Z');
    const resetAt = new Date('2026-10-30T03:05:00.000Z');
    const row = (id: string, deviceId: string) => ({
      id,
      deviceId,
      handedOverAt: AT,
      checkedInAt,
      lostAt: null,
      holderName: null,
      holderPhone: null,
      holderEmergencyContact: null,
    });
    const reads = {
      detail: jest.fn().mockResolvedValue({
        row: {
          ...CONTRACT,
          reservationExpiresAt: null,
          handoverAppointmentAt: null,
          holdExpiresAt: new Date('2026-10-27T03:00:00.000Z'),
          terms: [],
          devices: [row('cd-1', 'd-1'), row('cd-2', 'd-2')],
        },
        organization: ORG,
        variantCode: 'treklink-v3',
        assetTags: new Map([
          ['d-1', 'TL-0017'],
          ['d-2', 'TL-0018'],
        ]),
        returnChecks: new Map([
          ['cd-1', { resetAt, inspection: { result: 'PASSED', at: resetAt } }],
          ['cd-2', { resetAt: null, inspection: null }],
        ]),
        provisionedKeyVersions: new Map([['d-1', 2]]),
        balance: { dueNowVnd: 0n, dueLaterVnd: 0n },
      }),
    };
    const reader = new ContractsController(
      {} as ContractsService,
      {} as DevicesService,
      reads as unknown as ContractReadsService,
      {} as ContractDecisionsService,
    );

    const detail = await reader.detail('c-1', MANAGER);

    expect(detail.holdExpiresAt).toEqual(new Date('2026-10-27T03:00:00.000Z'));
    expect(detail.devices).toEqual([
      expect.objectContaining({
        deviceId: 'd-1',
        assetTag: 'TL-0017',
        resetAt,
        inspection: { result: 'PASSED', at: resetAt },
        provisionedKeyVersion: 2,
      }),
      expect.objectContaining({
        deviceId: 'd-2',
        resetAt: null,
        inspection: null,
        provisionedKeyVersion: null,
      }),
    ]);
  });

  it('answers a rejection with the deposit paid so far, as a number (D-092)', async () => {
    const rejected = { ...CONTRACT, status: ContractStatus.REJECTED, version: 2 };
    const decisions = {
      reject: jest.fn().mockResolvedValue({ contract: rejected, paidVnd: 2_250_000n }),
    };
    const reads = {
      labeller: jest
        .fn()
        .mockResolvedValue(() => ({ organization: ORG, variantCode: 'treklink-v3' })),
    };
    const staff = new ContractsController(
      {} as ContractsService,
      {} as DevicesService,
      reads as unknown as ContractReadsService,
      decisions as unknown as ContractDecisionsService,
    );
    const caller = { id: 'staff-1', roles: ['STAFF'], organizationId: null };

    const view = await staff.reject('c-1', { reason: 'Out of stock', expectedVersion: 1 }, caller);

    expect(decisions.reject).toHaveBeenCalledWith(
      'c-1',
      { reason: 'Out of stock', expectedVersion: 1 },
      caller,
    );
    expect(view).toMatchObject({ status: ContractStatus.REJECTED, paidVnd: 2_250_000 });
  });

  const policiesOf = (method: string): PolicyHandler[] =>
    Reflect.getMetadata(
      CHECK_POLICIES_KEY,
      Object.getOwnPropertyDescriptor(ContractsController.prototype, method)?.value as object,
    ) as PolicyHandler[];

  it.each([
    ['request', 'request'],
    ['list', 'read'],
    ['detail', 'read'],
    ['transitions', 'read'],
    ['approve', 'operate'],
    ['reject', 'operate'],
    ['notice', 'notice'],
    ['holder', 'label'],
  ])('checks the %s route against %s on RentalContract', (method, action) => {
    const can = jest.fn().mockReturnValue(true);
    const ability: PolicyAbility = { can };
    expect(policiesOf(method).every((handler) => handler(ability))).toBe(true);
    expect(can).toHaveBeenCalledWith(action, 'RentalContract');
  });

  it('lets the Org Manager (cancel) or Staff (operate) cancel, and nobody else', () => {
    const only = (allowed: string) => ({ can: (action: string) => action === allowed });
    const [handler] = policiesOf('cancel');
    expect(handler(only('cancel'))).toBe(true);
    expect(handler(only('operate'))).toBe(true);
    expect(handler(only('read'))).toBe(false);
  });
});
