import { describe, expect, it } from 'vitest';
import type { ContractDevice, ContractStatus } from '../../entities/contract/api';
import { homeActions, nextStepOf, type HomeMode, type Viewer } from './policy';

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
    });
    expect(actionsOf('ACTIVE', 'manager', { openInvoiceId: 'inv-1' }).more.map((action) => action.label)).toEqual([
      'Give notice',
      'End contract now',
    ]);
    const nothingDue = actionsOf('ACTIVE', 'manager');
    expect(nothingDue.primary?.label).toBe('Give notice');
    // Nothing to pay: no disabled Pay either (review of treklink-web#350); End now stays in More actions.
    expect(nothingDue.more.map((action) => action.key)).toEqual(['end']);
    expect(actionsOf('ACTIVE', 'manager', { planType: 'DAY' }).primary).toBeNull();
  });

  it('offers the Org Manager no Pay while nothing is due now, as after a paid deposit', () => {
    const paid = homeActions({
      contract: { status: 'REQUESTED', planType: 'MONTHLY', devices: [] },
      viewer: 'manager',
      mode: null,
      openInvoiceId: 'inv-1',
      dueNowVnd: 0,
    });
    expect(paid.primary).toBeNull();
    expect(paid.idle).toBe('TrekLink Staff review the request');
    expect(paid.more.map((action) => action.label)).toEqual(['Cancel request']);
  });

  it('offers Pay deposit on a request whose deposit is unpaid, though nothing is due now (review of #350)', () => {
    const request = (depositUnpaidVnd: number) =>
      homeActions({
        contract: { status: 'REQUESTED', planType: 'MONTHLY', devices: [] },
        viewer: 'manager',
        mode: null,
        openInvoiceId: 'inv-1',
        // The deposit falls due at the hold expiry, so the balance shows nothing due now.
        dueNowVnd: 0,
        depositUnpaidVnd,
      });
    expect(request(1_575_000).primary).toEqual({ key: 'pay', label: 'Pay deposit' });
    expect(request(1_575_000).idle).toBeNull();
    // Paid: the rest of the invoice falls due at handover, so the request waits for Staff.
    expect(request(0).primary).toBeNull();
    expect(request(0).idle).toBe('TrekLink Staff review the request');
  });

  // D-097, rentals design §12: End contract now is in More actions, destructive and last, for Staff and
  // the Org Manager on ACTIVE and ENDING only, and never the primary action.
  it.each<[ContractStatus, Viewer]>([
    ['ACTIVE', 'staff'],
    ['ENDING', 'staff'],
    ['ACTIVE', 'manager'],
    ['ENDING', 'manager'],
  ])('offers End contract now last in More actions on %s to %s', (status, viewer) => {
    const actions = actionsOf(status, viewer);
    expect(actions.more.at(-1)).toEqual({ key: 'end', label: 'End contract now', destructive: true });
    expect(actions.primary?.key).not.toBe('end');
  });

  it('keeps End contract now on a day plan and behind Pay invoice', () => {
    expect(actionsOf('ACTIVE', 'manager', { planType: 'DAY' }).more.map((action) => action.key)).toEqual(['end']);
    const paying = actionsOf('ENDING', 'manager', { openInvoiceId: 'inv-1' });
    expect(paying.primary?.key).toBe('pay');
    expect(paying.more.map((action) => action.key)).toEqual(['end']);
  });

  it.each<ContractStatus>(['REQUESTED', 'APPROVED', 'RETURN_DUE', 'OVERDUE', 'DEFAULTED', 'RETURNED', 'CLOSED'])(
    'offers End contract now to nobody on %s, and never to an Org Operator',
    (status) => {
      (['staff', 'manager', 'operator'] as Viewer[]).forEach((viewer) => {
        const actions = actionsOf(status, viewer);
        expect([actions.primary, ...actions.more].map((action) => action?.key)).not.toContain('end');
      });
      expect(actionsOf('ACTIVE', 'operator').more).toEqual([]);
    },
  );

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

describe('contract home Next step (screen 5.2 lifecycle card)', () => {
  // The demo walk of 2026-11-05 read "The organization is suspended." on RC-2026-0003 while ORG-0001 was
  // ACTIVE: the contract detail carries no organization status, so the line must not claim one.
  it('tells Staff to recover a defaulted unit without claiming the organization is suspended', () => {
    const next = nextStepOf(
      {
        status: 'DEFAULTED',
        planType: 'MONTHLY',
        quantity: 1,
        holdExpiresAt: null,
        handoverAppointmentAt: null,
        currentTerm: null,
        endsAt: null,
        returnDueAt: '2026-10-05T05:55:00Z',
        devices: [out],
      },
      'staff',
    );
    expect(next).toEqual({ actor: 'TrekLink Staff', text: 'Recover the 1 unit still out or record them lost.' });
    expect(next.text).not.toMatch(/suspended/i);
  });
});
