import { ContractStatus } from '@prisma/client';
import { ALLOWED_TRANSITIONS, isAllowedTransition } from './contract-states';

const S = ContractStatus;

// The edges of specs/rentals/design.md Figure 2 and its table, written out once more by hand so the
// test does not read the table it checks.
const DESIGN_EDGES = new Set([
  'REQUESTED>APPROVED',
  'REQUESTED>REJECTED',
  'REQUESTED>CANCELLED',
  'APPROVED>CANCELLED',
  'APPROVED>ACTIVE',
  'ACTIVE>ENDING',
  'ACTIVE>RETURN_DUE',
  'ENDING>RETURN_DUE',
  'RETURN_DUE>OVERDUE',
  'RETURN_DUE>RETURNED',
  'OVERDUE>DEFAULTED',
  'OVERDUE>RETURNED',
  'DEFAULTED>RETURNED',
  'RETURNED>CLOSED',
]);

const STATES = Object.values(S);
const PAIRS = STATES.flatMap((from) => STATES.map((to) => [from, to] as const));

describe('contract lifecycle table (D-035, rentals task 1.2)', () => {
  it('covers all eleven states', () => {
    expect(STATES).toHaveLength(11);
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([...STATES].sort());
  });

  it.each(PAIRS)('%s -> %s is allowed exactly when design Figure 2 has the edge', (from, to) => {
    expect(isAllowedTransition(from, to)).toBe(DESIGN_EDGES.has(`${from}>${to}`));
  });

  it('ends at REJECTED, CANCELLED and CLOSED', () => {
    for (const final of [S.REJECTED, S.CANCELLED, S.CLOSED]) {
      expect(ALLOWED_TRANSITIONS[final]).toEqual([]);
    }
  });
});
