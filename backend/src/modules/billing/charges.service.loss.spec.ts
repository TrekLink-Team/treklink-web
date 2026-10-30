import { InvoiceKind, InvoiceLineType, LossCustody, LossDecision, Prisma } from '@prisma/client';
import { DevicesService, LossCaseView } from '../devices';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ChargesService } from './charges.service';
import { DamageChargesRepository } from './damage-charges.repository';
import { InvoicesRepository } from './invoices.repository';
import { PricingService } from './pricing.service';
import { BillingLossCaseListener } from './providers/loss-case-listener.provider';

const TX = { tx: true } as unknown as Prisma.TransactionClient;
const CONFIRMED = new Date('2026-11-20T03:00:00.000Z');
const SETTLED = new Date('2026-11-27T03:00:00.000Z');
const CONTRACT = { id: 'c-1', organizationId: 'org-1' };
const DEVICE = { id: 'dev-9', assetTag: 'TL-0009' };

const lossCase = (overrides: Partial<LossCaseView> = {}): LossCaseView => ({
  id: 'lc-1',
  code: 'LOSS-0001',
  deviceId: 'dev-9',
  assetTag: 'TL-0009',
  custody: LossCustody.RENTER,
  custodyContract: { contractId: 'c-1', organizationId: 'org-1', contractDeviceId: 'cd-1' },
  confirmedAt: CONFIRMED,
  chargeVnd: null,
  decisionReason: null,
  decidedById: null,
  ...overrides,
});

describe('ChargesService loss charges (billing task 2.6, REQ-EVT-07, AC-05)', () => {
  let invoices: Record<string, jest.Mock>;
  let service: ChargesService;

  beforeEach(() => {
    invoices = {
      lockClosingInvoice: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue({ id: 'closing-1' }),
      appendLines: jest.fn().mockResolvedValue({ id: 'closing-1' }),
      lossLine: jest.fn().mockResolvedValue({ id: 'line-7', amountVnd: 1_800_000n }),
    };
    service = new ChargesService(
      invoices as unknown as InvoicesRepository,
      { insert: jest.fn() } as unknown as DamageChargesRepository,
      {} as PricingService,
      {} as ParameterService,
    );
  });

  it('adds one LOSS line of the remaining value on a new closing invoice', async () => {
    await service.chargeLoss(CONTRACT, DEVICE, 1_800_000, 'LOSS-0001', CONFIRMED, TX);
    expect(invoices.insert).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        contractId: 'c-1',
        termId: null,
        kind: InvoiceKind.CLOSING,
        issuedAt: CONFIRMED,
      },
      [
        {
          type: InvoiceLineType.LOSS,
          description: 'Loss of TL-0009 (LOSS-0001): remaining value',
          deviceId: 'dev-9',
          quantity: 1,
          unitVnd: 1_800_000n,
          amountVnd: 1_800_000n,
          dueAt: CONFIRMED,
          createdById: null,
        },
      ],
      TX,
    );
  });

  it('appends to the closing invoice that already exists, and charges nothing for no value', async () => {
    invoices.lockClosingInvoice.mockResolvedValue({ id: 'closing-1' });
    await service.chargeLoss(CONTRACT, DEVICE, 1_800_000, 'LOSS-0001', CONFIRMED, TX);
    expect(invoices.appendLines).toHaveBeenCalledTimes(1);
    await expect(
      service.chargeLoss(CONTRACT, DEVICE, 0, 'LOSS-0001', CONFIRMED, TX),
    ).resolves.toBeNull();
    expect(invoices.appendLines).toHaveBeenCalledTimes(1);
  });

  it('waives with a negative ADJUSTMENT of the whole LOSS line and never edits it (AC-05)', async () => {
    await service.adjustLoss(
      CONTRACT,
      DEVICE,
      'WAIVED',
      0,
      'Found by the guide',
      'u-admin',
      TX,
      SETTLED,
    );
    expect(invoices.lossLine).toHaveBeenCalledWith('c-1', 'dev-9', TX);
    const [, lines] = invoices.insert.mock.calls[0] as [unknown, Record<string, unknown>[]];
    expect(lines).toEqual([
      expect.objectContaining({
        type: InvoiceLineType.ADJUSTMENT,
        description: 'Loss of TL-0009 waived: Found by the guide',
        amountVnd: -1_800_000n,
        createdById: 'u-admin',
        dueAt: SETTLED,
      }),
    ]);
  });

  it('reduces with an ADJUSTMENT of the difference only', async () => {
    await service.adjustLoss(
      CONTRACT,
      DEVICE,
      'REDUCED',
      1_000_000,
      'Half the strap',
      'u-admin',
      TX,
      SETTLED,
    );
    const [, lines] = invoices.insert.mock.calls[0] as [unknown, Record<string, unknown>[]];
    expect(lines[0]).toMatchObject({ amountVnd: -800_000n, unitVnd: -800_000n });
  });

  it('adds nothing when no LOSS line exists or nothing is taken back', async () => {
    invoices.lossLine.mockResolvedValueOnce(null);
    await expect(
      service.adjustLoss(CONTRACT, DEVICE, 'WAIVED', 0, 'x', null, TX),
    ).resolves.toBeNull();
    await expect(
      service.adjustLoss(CONTRACT, DEVICE, 'REDUCED', 2_000_000, 'x', null, TX),
    ).resolves.toBeNull();
    expect(invoices.insert).not.toHaveBeenCalled();
  });
});

describe('BillingLossCaseListener (the billing side of LOSS_CASE_LISTENERS)', () => {
  let charges: { chargeLoss: jest.Mock; adjustLoss: jest.Mock };
  let devices: { valueAt: jest.Mock };
  let listener: BillingLossCaseListener;

  beforeEach(() => {
    charges = {
      chargeLoss: jest.fn().mockResolvedValue({ id: 'closing-1' }),
      adjustLoss: jest.fn().mockResolvedValue({ id: 'closing-1' }),
    };
    devices = { valueAt: jest.fn().mockResolvedValue(1_800_000) };
    listener = new BillingLossCaseListener(
      charges as unknown as ChargesService,
      devices as unknown as DevicesService,
    );
  });

  it('registers itself under LOSS_CASE_LISTENERS at boot when the token is provided', () => {
    const tokenArray: unknown[] = [];
    const booted = new BillingLossCaseListener(
      charges as unknown as ChargesService,
      devices as unknown as DevicesService,
      tokenArray as never,
    );
    booted.onModuleInit();
    expect(tokenArray).toEqual([booted]);
    booted.onModuleInit(); // idempotent
    expect(tokenArray).toHaveLength(1);
  });

  it('does nothing at boot when the token was not provided (devices not yet booted)', () => {
    expect(() => listener.onModuleInit()).not.toThrow();
  });

  it('charges a RENTER-custody confirmation the remaining value at the confirmation date', async () => {
    await listener.onConfirmed(lossCase(), TX);
    expect(devices.valueAt).toHaveBeenCalledWith('dev-9', CONFIRMED);
    expect(charges.chargeLoss).toHaveBeenCalledWith(
      CONTRACT,
      DEVICE,
      1_800_000,
      'LOSS-0001',
      CONFIRMED,
      TX,
    );
  });

  it('charges nothing for TREKLINK custody', async () => {
    await listener.onConfirmed(
      lossCase({ custody: LossCustody.TREKLINK, custodyContract: null }),
      TX,
    );
    expect(devices.valueAt).not.toHaveBeenCalled();
    expect(charges.chargeLoss).not.toHaveBeenCalled();
  });

  it('adjusts a reduced or waived settlement, and leaves CHARGED and WRITTEN_OFF alone', async () => {
    const decided = lossCase({
      chargeVnd: 1_000_000,
      decisionReason: 'Half the strap',
      decidedById: 'u-admin',
    });
    await listener.onSettled(decided, LossDecision.REDUCED, TX);
    expect(charges.adjustLoss).toHaveBeenCalledWith(
      CONTRACT,
      DEVICE,
      LossDecision.REDUCED,
      1_000_000,
      'Half the strap',
      'u-admin',
      TX,
    );
    await listener.onSettled(decided, LossDecision.CHARGED, TX);
    await listener.onSettled(decided, LossDecision.WRITTEN_OFF, TX);
    expect(charges.adjustLoss).toHaveBeenCalledTimes(1);
  });
});
