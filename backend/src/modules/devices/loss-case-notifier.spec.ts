import { LossDecision, Prisma } from '@prisma/client';
import { LossCaseNotifier } from './loss-case-notifier';
import { LossCaseListener, registerLossCaseListener } from './ports/loss-case-listener.port';

const VIEW = {
  id: 'lc-1',
  code: 'LC-2026-0001',
  deviceId: 'd-1',
  assetTag: 'TL-0001',
  custody: 'RENTER',
  custodyContract: null,
  confirmedAt: null,
  chargeVnd: null,
  decisionReason: null,
  decidedById: null,
} as const;
const TX = {} as Prisma.TransactionClient;

describe('LOSS_CASE_LISTENERS (devices task 1.4, provided to billing 2.6 and rentals)', () => {
  it('registers a listener once and calls onConfirmed and onSettled in order', async () => {
    const calls: string[] = [];
    const listeners: LossCaseListener[] = [];
    const billing = {
      onConfirmed: jest.fn(() => {
        calls.push('billing');
        return Promise.resolve();
      }),
      onSettled: jest.fn(() => {
        calls.push('billing-settled');
        return Promise.resolve();
      }),
    };
    const rentals = {
      onConfirmed: jest.fn(() => {
        calls.push('rentals');
        return Promise.resolve();
      }),
      onSettled: jest.fn(() => {
        calls.push('rentals-settled');
        return Promise.resolve();
      }),
    };
    registerLossCaseListener(listeners, billing);
    registerLossCaseListener(listeners, rentals);
    registerLossCaseListener(listeners, billing); // ignored, already present

    const notifier = new LossCaseNotifier(listeners);
    await notifier.confirmed(VIEW, TX);
    expect(calls).toEqual(['billing', 'rentals']);
    expect(billing.onConfirmed).toHaveBeenCalledTimes(1);

    await notifier.settled(VIEW, LossDecision.WAIVED, TX);
    expect(calls).toEqual(['billing', 'rentals', 'billing-settled', 'rentals-settled']);
    expect(rentals.onSettled).toHaveBeenCalledWith(VIEW, LossDecision.WAIVED, TX);
  });

  it('does nothing when no listener was ever provided (devices boots without billing or rentals)', async () => {
    const notifier = new LossCaseNotifier(null);
    await expect(notifier.confirmed(VIEW, TX)).resolves.toBeUndefined();
    await expect(notifier.settled(VIEW, LossDecision.CHARGED, TX)).resolves.toBeUndefined();
  });
});
