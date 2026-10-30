import { LossCustody, LossDecision, Prisma } from '@prisma/client';
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
  let listener: RentalsLossCaseListener;

  beforeEach(() => {
    contracts = { onLossSettled: jest.fn().mockResolvedValue(undefined) };
    listener = new RentalsLossCaseListener(contracts as unknown as ContractsService);
  });

  it('registers itself under LOSS_CASE_LISTENERS at boot, once', () => {
    const tokenArray: unknown[] = [];
    const booted = new RentalsLossCaseListener(
      contracts as unknown as ContractsService,
      tokenArray as never,
    );
    booted.onModuleInit();
    booted.onModuleInit();
    expect(tokenArray).toEqual([booted]);
  });

  it('does nothing at boot when the token was not provided', () => {
    expect(() => listener.onModuleInit()).not.toThrow();
  });

  it.each([LossDecision.CHARGED, LossDecision.REDUCED, LossDecision.WAIVED])(
    'sets lostAt to the confirmation time inside the caller transaction when settled %s (REQ-EVT-12)',
    async (decision) => {
      await listener.onSettled(lossCase(), decision, TX);
      expect(contracts.onLossSettled).toHaveBeenCalledWith('cd-1', CONFIRMED, TX);
    },
  );

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
