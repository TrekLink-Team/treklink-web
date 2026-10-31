import { ContractStatus, LossCustody, LossDecision, Prisma } from '@prisma/client';
import { LossCaseView } from '../../devices';
import { ContractsService } from '../contracts.service';
import { RentalsLossCaseListener } from './loss-case-listener.provider';

const TX = { tx: true } as unknown as Prisma.TransactionClient;
const CONFIRMED = new Date('2026-11-20T03:00:00.000Z');

const lossCase = (overrides: Partial<LossCaseView> = {}): LossCaseView => ({
  id: 'lc-1',
  code: 'LOSS-0001',
  deviceId: 'dev-9',
  assetTag: 'TL-0009',
  custody: LossCustody.RENTER,
  custodyContract: { contractId: 'c-1', organizationId: 'org-1', contractDeviceId: 'cd-1' },
  confirmedAt: CONFIRMED,
  chargeVnd: 1_000_000,
  decisionReason: null,
  decidedById: 'admin-1',
  ...overrides,
});

describe('RentalsLossCaseListener (the rentals side of LOSS_CASE_LISTENERS, task 1.3)', () => {
  let contracts: { onLossSettled: jest.Mock };
  let repository: { lockById: jest.Mock; returnCounts: jest.Mock };
  let lifecycle: { apply: jest.Mock };
  let listener: RentalsLossCaseListener;

  beforeEach(() => {
    contracts = { onLossSettled: jest.fn().mockResolvedValue(undefined) };
    repository = {
      lockById: jest.fn().mockResolvedValue({ id: 'c-1', status: ContractStatus.ACTIVE }),
      returnCounts: jest.fn().mockResolvedValue({ total: 2, returned: 2 }),
    };
    lifecycle = { apply: jest.fn().mockResolvedValue({ status: ContractStatus.RETURNED }) };
    listener = new RentalsLossCaseListener(
      contracts as unknown as ContractsService,
      [],
      repository as never,
      lifecycle as never,
    );
  });

  it('registers itself under LOSS_CASE_LISTENERS at boot, once', () => {
    const tokenArray: unknown[] = [];
    const booted = new RentalsLossCaseListener(
      contracts as unknown as ContractsService,
      tokenArray as never,
      repository as never,
      lifecycle as never,
    );
    booted.onModuleInit();
    booted.onModuleInit();
    expect(tokenArray).toEqual([booted]);
  });

  it.each([LossDecision.CHARGED, LossDecision.REDUCED, LossDecision.WAIVED])(
    'sets lostAt to the confirmation time inside the caller transaction when settled %s (REQ-EVT-12)',
    async (decision) => {
      await listener.onSettled(lossCase(), decision, TX);
      expect(contracts.onLossSettled).toHaveBeenCalledWith('cd-1', CONFIRMED, TX);
    },
  );

  it('keeps an ACTIVE contract running after the loss settles', async () => {
    await listener.onSettled(lossCase(), LossDecision.CHARGED, TX);
    expect(repository.lockById).toHaveBeenCalledWith('c-1', TX);
    expect(lifecycle.apply).not.toHaveBeenCalled();
  });

  it.each([ContractStatus.RETURN_DUE, ContractStatus.OVERDUE, ContractStatus.DEFAULTED])(
    'moves a %s contract to RETURNED when the lost unit was the last one out (REQ-EVT-12)',
    async (status) => {
      repository.lockById.mockResolvedValue({ id: 'c-1', status });
      await listener.onSettled(lossCase(), LossDecision.WAIVED, TX);
      expect(repository.returnCounts).toHaveBeenCalledWith('c-1', TX);
      expect(lifecycle.apply).toHaveBeenCalledWith(
        'c-1',
        status,
        ContractStatus.RETURNED,
        'LOST',
        { id: 'admin-1', roles: [], organizationId: null },
        TX,
      );
    },
  );

  it('leaves a due contract with another unit still out in its state', async () => {
    repository.lockById.mockResolvedValue({ id: 'c-1', status: ContractStatus.OVERDUE });
    repository.returnCounts.mockResolvedValue({ total: 2, returned: 1 });
    await listener.onSettled(lossCase(), LossDecision.CHARGED, TX);
    expect(lifecycle.apply).not.toHaveBeenCalled();
  });

  it('leaves a TREKLINK-custody case alone, since no contract row holds the device', async () => {
    await listener.onSettled(
      lossCase({ custody: LossCustody.TREKLINK, custodyContract: null }),
      LossDecision.WRITTEN_OFF,
      TX,
    );
    expect(contracts.onLossSettled).not.toHaveBeenCalled();
  });

  it('does nothing on confirmation', async () => {
    await listener.onConfirmed();
    expect(contracts.onLossSettled).not.toHaveBeenCalled();
  });

  it('lets a refused lostAt fail the settlement, so the caller transaction rolls back', async () => {
    contracts.onLossSettled.mockRejectedValue(new Error('The custody interval is already closed.'));
    await expect(listener.onSettled(lossCase(), LossDecision.CHARGED, TX)).rejects.toThrow(
      'already closed',
    );
  });
});
