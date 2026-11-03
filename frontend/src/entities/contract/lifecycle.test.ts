import { describe, expect, it } from 'vitest';
import type { ContractStatus, ContractTransition } from './api';
import { DAY_PATH, MONTHLY_PATH, lifecycleOf, transitionLine } from './lifecycle';

const base = {
  planType: 'MONTHLY' as const,
  statusChangedAt: '2026-11-10T02:00:00Z',
  handedOverAt: null,
  noticeGivenAt: null,
  handoverAppointmentAt: null,
};

const move = (fromStatus: ContractStatus | null, toStatus: ContractStatus, createdAt: string): ContractTransition => ({
  fromStatus,
  toStatus,
  actor: null,
  reason: null,
  createdAt,
});

describe('contract lifecycle (rentals design §2)', () => {
  it('follows the monthly path with Ending, and the day path without it', () => {
    expect(lifecycleOf({ ...base, status: 'ACTIVE' }).steps.map((step) => step.status)).toEqual(MONTHLY_PATH);
    expect(lifecycleOf({ ...base, planType: 'DAY', status: 'ACTIVE' }).steps.map((step) => step.status)).toEqual(
      DAY_PATH,
    );
  });

  it('marks the steps before the current one done and the rest to come', () => {
    const { steps, index } = lifecycleOf({ ...base, status: 'ACTIVE', handedOverAt: '2026-11-10T02:00:00Z' });
    expect(index).toBe(2);
    expect(steps.map((step) => step.state)).toEqual(['done', 'done', 'current', 'todo', 'todo', 'todo', 'todo']);
    expect(steps[2].at).toBe('2026-11-10T02:00:00Z');
  });

  it('draws Rejected as an exit from Requested and the later steps as not reached', () => {
    const { steps, index } = lifecycleOf({ ...base, status: 'REJECTED' });
    expect(index).toBe(0);
    expect(steps[0].exits.map((exit) => exit.status)).toEqual(['REJECTED']);
    expect(steps.slice(1).every((step) => step.state === 'skipped')).toBe(true);
  });

  it('places Cancelled on the step the history names, else on Approved when an appointment was set', () => {
    const history = [move(null, 'REQUESTED', '2026-11-01T00:00:00Z'), move('REQUESTED', 'CANCELLED', '2026-11-02T00:00:00Z')];
    expect(lifecycleOf({ ...base, status: 'CANCELLED', handoverAppointmentAt: '2026-11-09T02:00:00Z' }, history).index).toBe(0);
    expect(lifecycleOf({ ...base, status: 'CANCELLED', handoverAppointmentAt: '2026-11-09T02:00:00Z' }).index).toBe(1);
    expect(lifecycleOf({ ...base, status: 'CANCELLED' }).index).toBe(0);
  });

  it('draws Overdue and Defaulted as a detour from Return due that can still reach Returned', () => {
    const { steps, index } = lifecycleOf({ ...base, planType: 'DAY', status: 'DEFAULTED' });
    expect(DAY_PATH[index]).toBe('RETURN_DUE');
    expect(steps[index].exits.map((exit) => [exit.status, exit.current])).toEqual([
      ['OVERDUE', false],
      ['DEFAULTED', true],
    ]);
    expect(steps[index + 1].state).toBe('todo');
  });

  it('keeps the overdue marker after the units came back, and marks a closed contract done', () => {
    const history = [move('RETURN_DUE', 'OVERDUE', '2026-11-26T00:00:00Z'), move('OVERDUE', 'RETURNED', '2026-11-27T00:00:00Z')];
    const returned = lifecycleOf({ ...base, planType: 'DAY', status: 'RETURNED' }, history);
    expect(returned.steps[3].exits.map((exit) => exit.status)).toEqual(['OVERDUE']);
    expect(returned.steps[4].state).toBe('current');
    expect(lifecycleOf({ ...base, status: 'CLOSED' }).steps.every((step) => step.state === 'done')).toBe(true);
  });

  it('names history entries in words, with the hold expiry spelled out', () => {
    expect(transitionLine(move('REQUESTED', 'APPROVED', '2026-11-01T00:00:00Z'))).toBe('Request approved');
    expect(transitionLine({ ...move('REQUESTED', 'CANCELLED', '2026-11-01T00:00:00Z'), reason: 'HOLD_EXPIRED' })).toBe(
      'Request cancelled, the unpaid hold expired',
    );
  });
});
