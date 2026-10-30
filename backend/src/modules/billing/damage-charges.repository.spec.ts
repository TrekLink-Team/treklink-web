import { DamageChargeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DAMAGE_CHARGE_SELECT, DamageChargesRepository } from './damage-charges.repository';

describe('DamageChargesRepository (billing task 2.5, D-081)', () => {
  it('inserts a damage charge with its contract, inspector and codes in the caller transaction', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'dc-1' });
    const tx = { damageCharge: { create } } as unknown as Prisma.TransactionClient;
    const charge = {
      inspectionId: 'insp-1',
      deviceId: 'dev-1',
      contractId: 'c-1',
      inspectorId: 'staff-1',
      damageCodes: ['CASING_CRACKED'],
      amountVnd: 700_000n,
      status: DamageChargeStatus.PENDING_APPROVAL,
      finalVnd: null,
      decidedAt: null,
    };

    await expect(
      new DamageChargesRepository({} as PrismaService).insert(charge, tx),
    ).resolves.toEqual({
      id: 'dc-1',
    });
    expect(create).toHaveBeenCalledWith({ data: charge, select: DAMAGE_CHARGE_SELECT });
  });

  it('reads the pending charges of a contract, oldest first', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const tx = { damageCharge: { findMany } } as unknown as Prisma.TransactionClient;
    await new DamageChargesRepository({} as PrismaService).pendingOfContract('c-1', tx);
    expect(findMany).toHaveBeenCalledWith({
      where: { contractId: 'c-1', status: DamageChargeStatus.PENDING_APPROVAL },
      orderBy: { createdAt: 'asc' },
      select: DAMAGE_CHARGE_SELECT,
    });
  });

  it('locks the row before reading it, then records the decision', async () => {
    const order: string[] = [];
    const update = jest.fn().mockResolvedValue({ id: 'dc-1' });
    const tx = {
      $queryRaw: jest.fn(() => {
        order.push('lock');
        return Promise.resolve([]);
      }),
      damageCharge: {
        findUnique: jest.fn(() => {
          order.push('read');
          return Promise.resolve({ id: 'dc-1' });
        }),
        update,
      },
    } as unknown as Prisma.TransactionClient;
    const repository = new DamageChargesRepository({} as PrismaService);

    await expect(repository.lock('dc-1', tx)).resolves.toEqual({ id: 'dc-1' });
    expect(order).toEqual(['lock', 'read']);

    const decision = {
      status: DamageChargeStatus.REDUCED,
      finalVnd: 400_000n,
      decidedById: 'admin-1',
      decisionNote: 'Pre-existing crack',
      decidedAt: new Date('2026-10-30T04:00:00.000Z'),
    };
    await repository.recordDecision('dc-1', decision, tx);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'dc-1' },
      data: decision,
      select: DAMAGE_CHARGE_SELECT,
    });
  });

  it('pages the charges by status and contract, newest first', async () => {
    const findMany = jest.fn().mockReturnValue('rows');
    const count = jest.fn().mockReturnValue('total');
    const $transaction = jest.fn().mockResolvedValue([[], 0]);
    const prisma = { damageCharge: { findMany, count }, $transaction } as unknown as PrismaService;

    await new DamageChargesRepository(prisma).page(
      { status: DamageChargeStatus.PENDING_APPROVAL, contractId: undefined },
      20,
      20,
    );
    const where = { status: DamageChargeStatus.PENDING_APPROVAL, contractId: undefined };
    expect(findMany).toHaveBeenCalledWith({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: 20,
      take: 20,
      select: DAMAGE_CHARGE_SELECT,
    });
    expect(count).toHaveBeenCalledWith({ where });
    expect($transaction).toHaveBeenCalledWith(['rows', 'total']);
  });
});
