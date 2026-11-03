import { describe, expect, it } from 'vitest';
import type { ContractDevice, ContractStatus } from '../../entities/contract/api';
import { homeActions, type HomeMode, type Viewer } from './policy';

const out: ContractDevice = {
  deviceId: 'd-1',
  assetTag: 'TL-0001',
  handedOverAt: '2026-11-10T02:00:00Z',
  checkedInAt: null,
  lostAt: null,
  holder: null,
};

const actionsOf = (
  status: ContractStatus,
  viewer: Viewer,
  options: { mode?: HomeMode; planType?: 'MONTHLY' | 'DAY'; openInvoiceId?: string | null; devices?: ContractDevice[] } = {},
) =>
  homeActions({
    contract: { status, planType: options.planType ?? 'MONTHLY', devices: options.devices ?? [] },
    viewer,
    mode: options.mode ?? null,
    openInvoiceId: options.openInvoiceId ?? null,
  });

describe('contract home actions (screen 5.2, rentals design §2)', () => {
  it.each<[ContractStatus, HomeMode, string | null]>([
    ['REQUESTED', null, 'Review request'],
    ['REQUESTED', 'review', 'Approve request'],
    ['APPROVED', null, 'Start handover'],
    ['APPROVED', 'handover', null],
    ['ACTIVE', null, null],
    ['RETURN_DUE', null, 'Record return'],
    ['OVERDUE', null, 'Record return'],
    ['RETURNED', null, 'Close contract'],
    ['CLOSED', null, null],
    ['REJECTED', null, null],
  ])('gives Staff one primary action on %s (mode %s): %s', (status, mode, primary) => {
    expect(actionsOf(status, 'staff', { mode }).primary?.label ?? null).toBe(primary);
  });

  it('puts the destructive actions of a request last', () => {
    expect(actionsOf('REQUESTED', 'staff', { mode: 'review' }).more.map((action) => action.label)).toEqual([
      'Leave review mode',
      'Reject request',
      'Cancel request',
    ]);
  });

  it('gives an unavailable Close contract its reason as text', () => {
    const due = actionsOf('RETURN_DUE', 'staff', { devices: [out, { ...out, deviceId: 'd-2' }] });
    expect(due.more).toEqual([{ key: 'close', label: 'Close contract', reason: '2 units are still out' }]);
  });

  it('gives the Org Manager Pay when an invoice is open, and Give notice otherwise on a monthly plan', () => {
    expect(actionsOf('REQUESTED', 'manager', { openInvoiceId: 'inv-1' }).primary).toEqual({
      key: 'pay',
      label: 'Pay deposit',
      reason: undefined,
    });
    expect(actionsOf('ACTIVE', 'manager', { openInvoiceId: 'inv-1' }).more.map((action) => action.label)).toEqual([
      'Give notice',
    ]);
    const nothingDue = actionsOf('ACTIVE', 'manager');
    expect(nothingDue.primary?.label).toBe('Give notice');
    expect(nothingDue.more).toEqual([{ key: 'pay', label: 'Pay invoice', reason: 'No invoice is due' }]);
    expect(actionsOf('ACTIVE', 'manager', { planType: 'DAY' }).primary).toBeNull();
  });

  it('never gives an Org Operator an action, nor the Org Manager a Staff one', () => {
    (['REQUESTED', 'APPROVED', 'ACTIVE', 'RETURNED'] as ContractStatus[]).forEach((status) => {
      expect(actionsOf(status, 'operator').primary).toBeNull();
      expect(actionsOf(status, 'operator').more).toEqual([]);
      const manager = [actionsOf(status, 'manager').primary, ...actionsOf(status, 'manager').more].map((action) => action?.key);
      expect(manager).not.toContain('approve');
      expect(manager).not.toContain('close');
      expect(manager).not.toContain('handover');
    });
  });
});
