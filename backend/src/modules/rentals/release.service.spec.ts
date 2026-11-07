import { ContractStatus, PlanType, Prisma, ReleasePhase } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { ChargesService, ServiceCreditService } from '../billing';
import { DevicesService } from '../devices';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ContractRow, ContractsRepository } from './contracts.repository';
import { CustodyService } from './custody.service';
import { CONTRACT_UNIT_RELEASED, ReleaseService } from './release.service';
import { DEVICE_CHECKED_IN } from './return.service';

const TX = {} as Prisma.TransactionClient;
const AT = new Date('2026-11-11T02:00:00.000Z');
const TERM = {
  startsAt: new Date('2026-11-01T02:00:00.000Z'),
  endsAt: new Date('2026-12-01T02:00:00.000Z'),
};
const STAFF: Caller = { id: 'u-staff', roles: ['STAFF'], organizationId: null };

const contract = (overrides: Partial<ContractRow> = {}): ContractRow =>
  ({
    id: 'c-1',
    code: 'RC-2026-0042',
    organizationId: 'org-1',
    planType: PlanType.MONTHLY,
    dayPlanDays: null,
    quantity: 5,
    monthlyUnitPriceVnd: 450_000n,
    dayPremium: null,
    holdingFeeRatio: new Prisma.Decimal('0.5'),
    status: ContractStatus.ACTIVE,
    version: 9,
    ...overrides,
  }) as ContractRow;

const out = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `cd-${i + 1}`, deviceId: `d-${i + 1}` }));

const build = (row: ContractRow = contract(), rows = out(5)) => {
  const contracts = {
    lockById: jest.fn().mockResolvedValue(row),
    findById: jest.fn().mockResolvedValue(row),
    rowsOut: jest.fn().mockResolvedValue(rows),
    liveRows: jest.fn().mockResolvedValue(rows.map((r) => ({ ...r, handedOverAt: null }))),
    openTerm: jest.fn().mockResolvedValue({ id: 't-1', seq: 1, ...TERM }),
    releaseRow: jest.fn().mockResolvedValue(undefined),
    setQuantity: jest.fn().mockResolvedValue(true),
    insertUnitRelease: jest.fn((data: object) => Promise.resolve({ id: 'ur-1', ...data })),
  };
  const custody = { closeCustody: jest.fn().mockResolvedValue(undefined) };
  const devices = {
    assetTags: jest.fn().mockResolvedValue(new Map([['d-9', 'TL-0009']])),
    markReturned: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const charges = {
    lowerFirstInvoice: jest
      .fn()
      .mockResolvedValue({ invoice: { id: 'inv-1' }, loweredByVnd: 450_000n }),
    previewLowerFirstInvoice: jest.fn().mockResolvedValue({
      totalVnd: 2_250_000n,
      paidVnd: 1_125_000n,
      newTotalVnd: 1_800_000n,
      owedToOrganizationVnd: 0n,
    }),
  };
  const credits = {
    requestReleaseCredit: jest.fn().mockResolvedValue({
      credit: { id: 'sc-7', kind: 'RELEASE', status: 'REQUESTED', computedVnd: 300_000n },
      quote: { unusedDays: 20, termDays: 30, usedDays: 10, creditVnd: 300_000n },
    }),
  };
  const emitAfterCommit = jest.fn();
  const service = new ReleaseService(
    contracts as unknown as ContractsRepository,
    custody as unknown as CustodyService,
    devices as unknown as DevicesService,
    charges as unknown as ChargesService,
    credits as unknown as ServiceCreditService,
    {
      transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
      emitAfterCommit,
    } as unknown as TransactionalEvents,
  );
  return { service, contracts, custody, devices, charges, credits, emitAfterCommit };
};

const input = { reason: 'The group shrank to 4 trekkers', expectedVersion: 9 };

describe('ReleaseService (rentals 13.2, D-099)', () => {
  it('AC-19: closes a running unit RELEASED, returns it, lowers the quantity and requests the credit', async () => {
    const { service, contracts, custody, devices, credits, emitAfterCommit } = build();
    const released = await service.release('c-1', 'd-3', input, STAFF, AT);

    expect(custody.closeCustody).toHaveBeenCalledWith(
      'org-1',
      [{ id: 'cd-3', deviceId: 'd-3' }],
      { reason: 'RELEASED', actorId: 'u-staff' },
      AT,
      TX,
    );
    expect(devices.markReturned).toHaveBeenCalledWith(['d-3'], AT, TX, {
      contractId: 'c-1',
      contractCode: 'RC-2026-0042',
      actorId: 'u-staff',
      reason: 'RELEASED',
    });
    expect(contracts.setQuantity).toHaveBeenCalledWith('c-1', 9, 4, TX);
    expect(contracts.insertUnitRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        contractDeviceId: 'cd-3',
        phase: ReleasePhase.RUNNING,
        quantityBefore: 5,
        quantityAfter: 4,
        releasedAt: AT,
      }),
      TX,
    );
    expect(credits.requestReleaseCredit).toHaveBeenCalledWith(
      expect.objectContaining({ unitReleaseId: 'ur-1', contractDeviceId: 'cd-3' }),
      STAFF,
      AT,
      TX,
    );
    expect(released).toMatchObject({
      contract: { quantity: 4, version: 10 },
      credit: { id: 'sc-7', computedVnd: 300_000n, unusedDays: 20 },
      firstInvoiceLoweredByVnd: null,
    });
    expect(emitAfterCommit).toHaveBeenCalledWith(
      AUDIT_RECORD,
      expect.objectContaining({ action: CONTRACT_UNIT_RELEASED }),
    );
    expect(emitAfterCommit).toHaveBeenCalledWith(
      DEVICE_CHECKED_IN,
      expect.objectContaining({ deviceId: 'd-3' }),
    );
  });

  it('AC-21: before handover releases the held row, frees the unit and lowers the first invoice', async () => {
    const { service, contracts, custody, devices, charges, credits } = build(
      contract({ status: ContractStatus.APPROVED }),
    );
    const released = await service.release('c-1', 'd-2', input, STAFF, AT);
    expect(custody.closeCustody).not.toHaveBeenCalled();
    expect(contracts.releaseRow).toHaveBeenCalledWith('cd-2', AT, TX);
    expect(devices.release).toHaveBeenCalledWith(
      ['d-2'],
      AT,
      TX,
      expect.objectContaining({ reason: 'RELEASED' }),
    );
    expect(charges.lowerFirstInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-1', quantity: 5 }),
      'u-staff',
      TX,
    );
    expect(credits.requestReleaseCredit).not.toHaveBeenCalled();
    expect(released.firstInvoiceLoweredByVnd).toBe(450_000n);
  });

  it('AC-20: refuses the last unit, pointing to End now or Cancel, and changes nothing', async () => {
    const running = build(contract(), out(1));
    await expect(running.service.release('c-1', 'd-1', input, STAFF, AT)).rejects.toMatchObject({
      errorCode: ErrorCode.LAST_UNIT,
      message: 'This is the last unit. End the contract now instead.',
    });
    expect(running.contracts.setQuantity).not.toHaveBeenCalled();
    const held = build(contract({ status: ContractStatus.REQUESTED }), out(1));
    await expect(held.service.release('c-1', 'd-1', input, STAFF, AT)).rejects.toMatchObject({
      errorCode: ErrorCode.LAST_UNIT,
      message: 'This is the last unit. Cancel the request instead.',
    });
  });

  it('REQ-ERR-20: checks reason, state, version and unit in that order', async () => {
    const { service } = build();
    await expect(
      service.release('c-1', 'd-3', { ...input, reason: '  ' }, STAFF, AT),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.VALIDATION_FAILED,
    });
    await expect(
      build(contract({ status: ContractStatus.RETURN_DUE })).service.release(
        'c-1',
        'd-3',
        input,
        STAFF,
        AT,
      ),
    ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_STATE_TRANSITION });
    await expect(
      service.release('c-1', 'd-3', { ...input, expectedVersion: 8 }, STAFF, AT),
    ).rejects.toMatchObject({ errorCode: ErrorCode.STALE_VERSION });
    await expect(service.release('c-1', 'd-9', input, STAFF, AT)).rejects.toMatchObject({
      errorCode: ErrorCode.DEVICE_NOT_ON_CONTRACT,
      message: 'TL-0009 does not belong to contract RC-2026-0042.',
    });
  });

  it('REQ-EVT-33: previews the credit of a running unit and the first invoice before handover', async () => {
    const running = await build().service.preview('c-1', 'd-3', AT);
    expect(running).toMatchObject({
      phase: ReleasePhase.RUNNING,
      quantityBefore: 5,
      quantityAfter: 4,
      // 450,000 x 20 unused days / 30
      credit: { applies: true, unusedDays: 20, termDays: 30, computedVnd: 300_000n },
      firstInvoice: null,
    });
    const day = await build(contract({ planType: PlanType.DAY })).service.preview('c-1', 'd-3', AT);
    expect(day.credit).toMatchObject({ applies: false, computedVnd: 0n });
    const held = await build(contract({ status: ContractStatus.APPROVED })).service.preview(
      'c-1',
      'd-2',
      AT,
    );
    expect(held).toMatchObject({
      phase: ReleasePhase.BEFORE_HANDOVER,
      credit: null,
      firstInvoice: { newTotalVnd: 1_800_000n },
    });
  });
});
