import { ConfigService } from '@nestjs/config';
import { DamageChargeStatus, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { DevicesService } from '../devices';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ChargesService } from './charges.service';
import { DamageChargeService } from './damage-charge.service';
import { DamageChargeRow, DamageChargesRepository } from './damage-charges.repository';
import { InvoicesRepository } from './invoices.repository';

const TX = {} as Prisma.TransactionClient;
const AT = new Date('2026-10-30T04:00:00.000Z');
const ADMIN = { id: 'admin-1', roles: ['ADMIN'] } as unknown as Caller;
const INSPECTOR_ADMIN = { id: 'staff-1', roles: ['ADMIN'] } as unknown as Caller;

const charge = (overrides: Partial<DamageChargeRow> = {}): DamageChargeRow => ({
  id: 'dc-1',
  inspectionId: 'insp-1',
  deviceId: 'dev-1',
  contractId: 'c-1',
  inspectorId: 'staff-1',
  damageCodes: ['CASING_CRACKED', 'ANTENNA_BROKEN'],
  amountVnd: 700_000n,
  finalVnd: null,
  status: DamageChargeStatus.PENDING_APPROVAL,
  decidedById: null,
  decisionNote: null,
  decidedAt: null,
  createdAt: new Date('2026-10-29T03:00:00.000Z'),
  ...overrides,
});

const build = (row: DamageChargeRow | null = charge()) => {
  const damageCharges = {
    lock: jest.fn().mockResolvedValue(row),
    recordDecision: jest.fn((id: string, decision: object) =>
      Promise.resolve({ ...row, ...decision }),
    ),
    page: jest.fn().mockResolvedValue([[charge()], 1]),
  };
  const invoices = { organizationOfContract: jest.fn().mockResolvedValue('org-1') };
  const charges = { addDecidedDamage: jest.fn().mockResolvedValue({ id: 'closing-1' }) };
  const devices = { assetTags: jest.fn().mockResolvedValue(new Map([['dev-1', 'TL-0001']])) };
  const events = {
    transaction: jest.fn((work: (tx: Prisma.TransactionClient) => unknown) => work(TX)),
    emitAfterCommit: jest.fn(),
  };
  const config = {
    get: jest.fn((key: string) => (key === 'MAX_PAGE_SIZE' ? 100 : 20)),
  };
  const directory = { namesOf: jest.fn().mockResolvedValue(new Map([['staff-1', 'Demo Staff']])) };
  const service = new DamageChargeService(
    damageCharges as unknown as DamageChargesRepository,
    invoices as unknown as InvoicesRepository,
    charges as unknown as ChargesService,
    devices as unknown as DevicesService,
    events as unknown as TransactionalEvents,
    config as unknown as ConfigService<ValidatedEnvironment, true>,
    directory,
  );
  return { service, damageCharges, invoices, charges, devices, events };
};

describe('DamageChargeService.decide (UC-48, api-design 17, BR-24)', () => {
  it('approves the charged amount and adds it as a DAMAGE line on the closing invoice', async () => {
    const { service, damageCharges, charges, events } = build();
    const decided = await service.decide(
      'dc-1',
      { decision: 'APPROVED', note: 'Damage confirmed' },
      ADMIN,
      AT,
    );

    expect(damageCharges.lock).toHaveBeenCalledWith('dc-1', TX);
    expect(damageCharges.recordDecision).toHaveBeenCalledWith(
      'dc-1',
      {
        status: DamageChargeStatus.APPROVED,
        finalVnd: 700_000n,
        decidedById: 'admin-1',
        decisionNote: 'Damage confirmed',
        decidedAt: AT,
      },
      TX,
    );
    expect(charges.addDecidedDamage).toHaveBeenCalledWith(
      { id: 'c-1', organizationId: 'org-1' },
      expect.objectContaining({
        deviceId: 'dev-1',
        damageCodes: ['CASING_CRACKED', 'ANTENNA_BROKEN'],
      }),
      'TL-0001',
      700_000n,
      'admin-1',
      TX,
      AT,
    );
    expect(decided.status).toBe(DamageChargeStatus.APPROVED);
    expect(events.emitAfterCommit).toHaveBeenCalledWith(
      AUDIT_RECORD,
      expect.objectContaining({
        action: 'damageCharge.decided',
        organizationId: 'org-1',
        subjectId: 'dc-1',
        after: {
          status: DamageChargeStatus.APPROVED,
          finalVnd: '700000',
          note: 'Damage confirmed',
        },
      }),
    );
  });

  it('reduces to finalVnd and charges that amount', async () => {
    const { service, charges } = build();
    await service.decide(
      'dc-1',
      { decision: 'REDUCED', finalVnd: 400_000, note: 'Crack predates the rental' },
      ADMIN,
      AT,
    );
    expect(charges.addDecidedDamage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'TL-0001',
      400_000n,
      'admin-1',
      TX,
      AT,
    );
  });

  it('records a waiver on a contract with no invoice yet, with no organization (review of #144)', async () => {
    const { service, charges, events, invoices } = build();
    invoices.organizationOfContract.mockResolvedValue(null);
    await expect(
      service.decide('dc-1', { decision: 'WAIVED', note: 'Goodwill' }, ADMIN, AT),
    ).resolves.toMatchObject({ status: DamageChargeStatus.WAIVED });
    expect(charges.addDecidedDamage).not.toHaveBeenCalled();
    expect(events.emitAfterCommit).toHaveBeenCalledWith(
      AUDIT_RECORD,
      expect.objectContaining({ action: 'damageCharge.decided', organizationId: null }),
    );
  });

  it('waives without an invoice line', async () => {
    const { service, damageCharges, charges, events, invoices } = build();
    await service.decide('dc-1', { decision: 'WAIVED', note: 'Goodwill' }, ADMIN, AT);
    expect(damageCharges.recordDecision).toHaveBeenCalledWith(
      'dc-1',
      expect.objectContaining({ status: DamageChargeStatus.WAIVED, finalVnd: 0n }),
      TX,
    );
    expect(charges.addDecidedDamage).not.toHaveBeenCalled();
    expect(invoices.organizationOfContract).toHaveBeenCalledWith('c-1', TX);
    expect(events.emitAfterCommit).toHaveBeenCalledWith(
      AUDIT_RECORD,
      expect.objectContaining({
        organizationId: 'org-1',
      }),
    );
  });

  it('REQ-ERR-03: refuses the Admin who recorded the inspection', async () => {
    const { service, damageCharges } = build();
    await expect(
      service.decide('dc-1', { decision: 'APPROVED', note: 'x' }, INSPECTOR_ADMIN, AT),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.SEPARATION_OF_DUTY,
      message: 'A different Admin must approve this charge.',
    });
    expect(damageCharges.recordDecision).not.toHaveBeenCalled();
  });

  it('refuses a charge that is no longer pending, and an unknown one', async () => {
    const decided = build(charge({ status: DamageChargeStatus.APPROVED }));
    await expect(
      decided.service.decide('dc-1', { decision: 'WAIVED', note: 'x' }, ADMIN, AT),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      message: 'This cannot be done while it is APPROVED.',
    });

    const missing = build(null);
    await expect(
      missing.service.decide('dc-1', { decision: 'WAIVED', note: 'x' }, ADMIN, AT),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
      message: 'Damage charge not found.',
    });
  });

  it('refuses a reduction that is not below the charged amount', async () => {
    const { service, damageCharges } = build();
    await expect(
      service.decide('dc-1', { decision: 'REDUCED', finalVnd: 700_000, note: 'x' }, ADMIN, AT),
    ).rejects.toMatchObject({ errorCode: ErrorCode.VALIDATION_FAILED });
    expect(damageCharges.recordDecision).not.toHaveBeenCalled();
  });
});

describe('DamageChargeService.list (api-design 16)', () => {
  it('pages the charges with their asset tag and inspector name', async () => {
    const { service, damageCharges, devices } = build();
    const page = await service.list(
      { status: DamageChargeStatus.PENDING_APPROVAL },
      { pageNumber: 1, pageSize: 20 },
    );
    expect(damageCharges.page).toHaveBeenCalledWith(
      { status: DamageChargeStatus.PENDING_APPROVAL },
      0,
      20,
    );
    expect(devices.assetTags).toHaveBeenCalledWith(['dev-1']);
    expect(page.items[0]).toMatchObject({
      id: 'dc-1',
      assetTag: 'TL-0001',
      inspector: { id: 'staff-1', fullName: 'Demo Staff' },
    });
    expect(page.totalCount).toBe(1);
  });
});
