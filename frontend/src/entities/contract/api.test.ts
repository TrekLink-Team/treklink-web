import { describe, expect, it } from 'vitest';
import { nextDateOf, type Contract } from './api';

const contract = (status: Contract['status']): Contract =>
  ({ status, requestedStartDate: '2026-10-28', currentTerm: null, returnDueAt: null }) as Contract;

describe('nextDateOf (screen 5.2)', () => {
  it('uses the requested start date of a request', () => {
    expect(nextDateOf(contract('REQUESTED'))).toEqual({ day: '2026-10-28' });
  });

  it.each(['REJECTED', 'CANCELLED', 'RETURNED', 'CLOSED'] as const)(
    'has no next date once the contract is %s',
    (status) => {
      expect(nextDateOf(contract(status))).toBeNull();
    },
  );
});
