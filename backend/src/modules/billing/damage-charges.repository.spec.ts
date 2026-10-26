import { DamageChargeStatus, Prisma } from '@prisma/client';
import { DAMAGE_CHARGE_SELECT, DamageChargesRepository } from './damage-charges.repository';

describe('DamageChargesRepository (billing task 2.5)', () => {
  it('inserts a damage charge in the caller transaction', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'dc-1' });
    const tx = { damageCharge: { create } } as unknown as Prisma.TransactionClient;
    const charge = {
      inspectionId: 'insp-1',
      deviceId: 'dev-1',
      amountVnd: 700_000n,
      status: DamageChargeStatus.PENDING_APPROVAL,
      finalVnd: null,
      decidedAt: null,
    };

    await expect(new DamageChargesRepository().insert(charge, tx)).resolves.toEqual({ id: 'dc-1' });
    expect(create).toHaveBeenCalledWith({ data: charge, select: DAMAGE_CHARGE_SELECT });
  });
});
