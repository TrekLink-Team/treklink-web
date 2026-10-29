import { DamageChargeStatus, InvoiceKind, InvoiceLineType, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ChargesService, DamagedInspection } from './charges.service';
import { DamageChargesRepository } from './damage-charges.repository';
import { InvoicesRepository } from './invoices.repository';
import { PricingService } from './pricing.service';

const TX = { tx: true } as unknown as Prisma.TransactionClient;
const HOUR = 3_600_000;
const DUE = new Date('2026-10-20T02:00:00.000Z');
const CONTRACT = { id: 'c-1', organizationId: 'org-1', returnDueAt: DUE };
const PARAMETERS: Record<string, number> = {
  'rentals.returnGraceHours': 24,
  'billing.lateFeePerDevicePerDayVnd': 50_000,
  'billing.damageApprovalThresholdVnd': 500_000,
};
const after = (hours: number) => new Date(DUE.getTime() + hours * HOUR);
const device = (n: number) => ({ id: `dev-${n}`, assetTag: `TL-000${n}` });

const INSPECTION: DamagedInspection = {
  id: 'insp-1',
  deviceId: 'dev-1',
  assetTag: 'TL-0001',
  hardwareVariantId: 'v-3',
  damageCodes: ['ANTENNA_BROKEN', 'CASING_CRACKED'],
};

describe('ChargesService late and damage charges (billing task 2.5)', () => {
  let invoices: Record<string, jest.Mock>;
  let damageCharges: { insert: jest.Mock };
  let pricing: { damageRateFor: jest.Mock };
  let parameters: { get: jest.Mock };
  let service: ChargesService;

  beforeEach(() => {
    invoices = {
      lockClosingInvoice: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue({ id: 'closing-1' }),
      appendLines: jest.fn().mockResolvedValue({ id: 'closing-1' }),
    };
    damageCharges = {
      insert: jest.fn((charge: Record<string, unknown>) =>
        Promise.resolve({ id: 'dc-1', ...charge }),
      ),
    };
    pricing = {
      damageRateFor: jest.fn((code: string) =>
        Promise.resolve(code === 'ANTENNA_BROKEN' ? 300_000n : 400_000n),
      ),
    };
    parameters = { get: jest.fn((key: string) => Promise.resolve(PARAMETERS[key])) };
    service = new ChargesService(
      invoices as unknown as InvoicesRepository,
      damageCharges as unknown as DamageChargesRepository,
      pricing as unknown as PricingService,
      parameters as unknown as ParameterService,
    );
  });

  describe('chargeLate (REQ-EVT-04, FR-BILL-03, BR-23)', () => {
    it('charges nothing within the grace', async () => {
      await expect(
        service.chargeLate(CONTRACT, device(1), after(24), null, TX),
      ).resolves.toBeNull();
      await expect(
        service.chargeLate(CONTRACT, device(1), after(-5), null, TX),
      ).resolves.toBeNull();
      expect(invoices.lockClosingInvoice).not.toHaveBeenCalled();
      expect(parameters.get).toHaveBeenCalledWith('rentals.returnGraceHours', TX);
    });

    it('opens the closing invoice with one line per started day after the due time', async () => {
      const checkedInAt = after(24 + 1);
      await expect(
        service.chargeLate(CONTRACT, device(1), checkedInAt, 'staff-1', TX),
      ).resolves.toEqual({ id: 'closing-1' });

      expect(invoices.insert).toHaveBeenCalledWith(
        {
          organizationId: 'org-1',
          contractId: 'c-1',
          termId: null,
          kind: InvoiceKind.CLOSING,
          issuedAt: checkedInAt,
        },
        [
          {
            type: InvoiceLineType.LATE_FEE,
            description: 'Late return of TL-0001, 2 days',
            deviceId: 'dev-1',
            quantity: 2,
            unitVnd: 50_000n,
            amountVnd: 100_000n,
            dueAt: checkedInAt,
            createdById: 'staff-1',
          },
        ],
        TX,
      );
    });

    it('three late days on two devices give two lines of three days', async () => {
      invoices.lockClosingInvoice
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'closing-1' });
      const checkedInAt = after(72);

      await service.chargeLate(CONTRACT, device(1), checkedInAt, 'staff-1', TX);
      await service.chargeLate(CONTRACT, device(2), checkedInAt, 'staff-1', TX);

      const [, [first]] = invoices.insert.mock.calls[0] as [unknown, Record<string, unknown>[]];
      const [, [second]] = invoices.appendLines.mock.calls[0] as [
        unknown,
        Record<string, unknown>[],
      ];
      expect(first).toMatchObject({ deviceId: 'dev-1', quantity: 3, amountVnd: 150_000n });
      expect(second).toMatchObject({
        deviceId: 'dev-2',
        quantity: 3,
        amountVnd: 150_000n,
        description: 'Late return of TL-0002, 3 days',
      });
    });

    it('writes one day in the singular (a 12-hour grace, 13 hours late)', async () => {
      parameters.get.mockImplementation((key: string) =>
        Promise.resolve(key === 'rentals.returnGraceHours' ? 12 : PARAMETERS[key]),
      );
      await service.chargeLate(CONTRACT, device(1), after(13), null, TX);
      const [, [made]] = invoices.insert.mock.calls[0] as [unknown, Record<string, unknown>[]];
      expect(made).toMatchObject({ quantity: 1, description: 'Late return of TL-0001, 1 day' });
    });
  });

  describe('chargeDamage (REQ-EVT-05, FR-BILL-04, BR-24)', () => {
    const AT = after(30);

    it('AC-04: a 700,000 VND total above the 500,000 threshold waits for approval', async () => {
      const result = await service.chargeDamage(CONTRACT, INSPECTION, 'staff-1', TX, AT);

      expect(pricing.damageRateFor).toHaveBeenCalledWith('ANTENNA_BROKEN', 'v-3', TX);
      expect(pricing.damageRateFor).toHaveBeenCalledWith('CASING_CRACKED', 'v-3', TX);
      expect(damageCharges.insert).toHaveBeenCalledWith(
        {
          inspectionId: 'insp-1',
          deviceId: 'dev-1',
          amountVnd: 700_000n,
          status: DamageChargeStatus.PENDING_APPROVAL,
          finalVnd: null,
          decidedAt: null,
        },
        TX,
      );
      expect(result?.invoice).toBeNull();
      expect(invoices.lockClosingInvoice).not.toHaveBeenCalled();
    });

    it('approves a total at the threshold at once and adds a DAMAGE line', async () => {
      pricing.damageRateFor.mockResolvedValue(250_000n);

      const result = await service.chargeDamage(CONTRACT, INSPECTION, 'staff-1', TX, AT);

      expect(damageCharges.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          amountVnd: 500_000n,
          status: DamageChargeStatus.APPROVED,
          finalVnd: 500_000n,
          decidedAt: AT,
        }),
        TX,
      );
      expect(result?.invoice).toEqual({ id: 'closing-1' });
      expect(invoices.insert).toHaveBeenCalledWith(
        expect.objectContaining({ kind: InvoiceKind.CLOSING }),
        [
          {
            type: InvoiceLineType.DAMAGE,
            description: 'Damage to TL-0001: ANTENNA_BROKEN, CASING_CRACKED',
            deviceId: 'dev-1',
            quantity: 1,
            unitVnd: 500_000n,
            amountVnd: 500_000n,
            dueAt: AT,
            createdById: 'staff-1',
          },
        ],
        TX,
      );
    });

    it('refuses a code with no active rate and records nothing', async () => {
      pricing.damageRateFor.mockResolvedValueOnce(300_000n).mockResolvedValueOnce(null);

      await expect(
        service.chargeDamage(CONTRACT, INSPECTION, 'staff-1', TX, AT),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.UNKNOWN_DAMAGE_CODE,
        message: 'Unknown damage code: CASING_CRACKED.',
      });
      expect(damageCharges.insert).not.toHaveBeenCalled();
    });

    it('does nothing for an inspection without damage codes', async () => {
      await expect(
        service.chargeDamage(CONTRACT, { ...INSPECTION, damageCodes: [] }, null, TX),
      ).resolves.toBeNull();
      expect(pricing.damageRateFor).not.toHaveBeenCalled();
    });

    it('charges at the current time by default', async () => {
      pricing.damageRateFor.mockResolvedValue(100_000n);
      const before = Date.now();
      const result = await service.chargeDamage(CONTRACT, INSPECTION, null, TX);
      expect((result?.charge.decidedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    });
  });
});

describe('ChargesService.pendingDamage (rentals close guard, api-design 17)', () => {
  it('counts the charges still waiting for an Admin on the devices since the handover', async () => {
    const countPending = jest.fn().mockResolvedValue(2);
    const service = new ChargesService(
      {} as InvoicesRepository,
      { countPending } as unknown as DamageChargesRepository,
      {} as PricingService,
      {} as ParameterService,
    );
    const since = new Date('2026-10-25T03:00:00.000Z');
    await expect(service.pendingDamage(['dev-1'], since, TX)).resolves.toBe(2);
    expect(countPending).toHaveBeenCalledWith(['dev-1'], since, TX);
    await expect(service.pendingDamage([], since, TX)).resolves.toBe(0);
    expect(countPending).toHaveBeenCalledTimes(1);
  });
});
