// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractDetail, ContractDevice } from '../../entities/contract/api';
import { formatDateTime } from '../../shared/lib/format';
import { DevicesTab } from './DevicesTab';

// The Devices tab of the contract home (chapter 06 §9, screen 5.2, D-092 rule 4, D-099). The open
// loss cases hook is the one boundary mocked; CollectionView, DeviceRef and VariantCard run for real,
// at the laptop width jsdom reports. ContractDetailPage.test covers Report lost, an open loss case,
// the State now column and the service credit through the page; this file covers the rest.
const loss = { cases: [] as { code: string; device: { id: string } }[], enabled: [] as boolean[] };
vi.mock('../../entities/loss-case/api', () => ({
  useOpenLossCases: (enabled: boolean) => {
    loss.enabled.push(enabled);
    return { data: enabled ? loss.cases : undefined };
  },
}));

const VARIANT = {
  id: 'v-3',
  code: 'treklink-v3',
  name: 'TrekLink v3',
  imageUrl: null,
  specSheet: null,
  firmwareBaseline: null,
};
const OUT = '2026-10-30T09:00:00Z';
const BACK = '2026-11-01T02:00:00Z';

const unit = (n: number, extra: Partial<ContractDevice> = {}): ContractDevice =>
  ({
    deviceId: `dev-${n}`,
    assetTag: `TL-004${n}`,
    holder: null,
    handedOverAt: OUT,
    checkedInAt: null,
    lostAt: null,
    hardwareVariant: VARIANT,
    ...extra,
  }) as unknown as ContractDevice;

const contract = (devices: ContractDevice[], extra: Partial<ContractDetail> = {}): ContractDetail =>
  ({
    id: 'c-1',
    code: 'RC-2026-0004',
    status: 'ACTIVE',
    quantity: devices.length,
    devices,
    ...extra,
  }) as unknown as ContractDetail;

const handlers = {
  onLabel: vi.fn(),
  onReportLost: vi.fn(),
  onRequestCredit: vi.fn(),
  onRelease: vi.fn(),
};
const show = (
  value: ContractDetail,
  props: Partial<React.ComponentProps<typeof DevicesTab>> = {},
) =>
  render(
    <MemoryRouter>
      <DevicesTab
        contract={value}
        scope="t"
        viewer="staff"
        canLabel={false}
        {...handlers}
        {...props}
      />
    </MemoryRouter>,
  );

const rowOf = (tag: string) =>
  screen.getByRole('button', { name: `Show details of ${tag}` }).closest('tr') as HTMLElement;
const cell = (tag: string, column: string) => {
  const headers = screen.getAllByRole('columnheader').map((th) => th.textContent?.trim() ?? '');
  const index = headers.findIndex((text) => text.startsWith(column));
  return rowOf(tag).children[index]?.textContent ?? null;
};
const actionsOf = (tag: string) =>
  within(rowOf(tag))
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? button.textContent);

beforeEach(() => {
  Object.values(handlers).forEach((handler) => handler.mockReset());
  loss.cases = [];
  loss.enabled = [];
});
afterEach(cleanup);

describe('DevicesTab', () => {
  describe('the list', () => {
    it('names the contract variant above the list with the unit count', () => {
      show(contract([unit(1), unit(2)]));
      expect(screen.getByRole('heading', { level: 2, name: 'TrekLink v3' })).toBeTruthy();
      expect(screen.getByText('2 units of this variant on RC-2026-0004')).toBeTruthy();
      cleanup();
      show(contract([unit(1)]));
      expect(screen.getByText('1 unit of this variant on RC-2026-0004')).toBeTruthy();
    });

    it('shows the holder, the handover and the return of each unit', () => {
      show(
        contract([
          unit(1, { holder: { name: 'Lan Nguyen', phone: null, emergencyContact: null } }),
          unit(2, { checkedInAt: BACK }),
          unit(3, { lostAt: BACK }),
          unit(4, { handedOverAt: null }),
        ]),
      );
      expect(cell('TL-0041', 'Holder')).toBe('Lan Nguyen');
      expect(cell('TL-0042', 'Holder')).toBe('No label');
      expect(cell('TL-0041', 'Handed over')).toBe(formatDateTime(OUT));
      expect(cell('TL-0044', 'Handed over')).toBe('Not yet');
      expect(cell('TL-0041', 'Back')).toBe('Not yet');
      expect(cell('TL-0042', 'Back')).toBe(formatDateTime(BACK));
      expect(cell('TL-0043', 'Back')).toBe('Lost');
    });

    it('links each unit to its device page, and a handed-over unit to its history, for TrekLink', () => {
      show(contract([unit(1), unit(2, { handedOverAt: null })]));
      const row = within(rowOf('TL-0041'));
      expect(row.getByRole('link', { name: 'TL-0041' }).getAttribute('href')).toBe(
        '/t/devices/dev-1',
      );
      expect(row.getByRole('link', { name: 'History' }).getAttribute('href')).toBe(
        '/t/devices/dev-1/telemetry',
      );
      expect(within(rowOf('TL-0042')).queryByRole('link', { name: 'History' })).toBeNull();
    });

    it('links the organization to the position history of a handed-over unit only', () => {
      show(contract([unit(1), unit(2, { handedOverAt: null })]), { scope: 'o', viewer: 'manager' });
      expect(
        within(rowOf('TL-0041')).getByRole('link', { name: 'TL-0041' }).getAttribute('href'),
      ).toBe('/o/devices/dev-1/telemetry');
      expect(within(rowOf('TL-0042')).queryByRole('link', { name: 'TL-0042' })).toBeNull();
      expect(screen.queryByRole('link', { name: 'History' })).toBeNull();
    });

    it('shows the channel key to TrekLink on an approved contract only', () => {
      const units = [
        unit(1, { handedOverAt: null, provisionedKeyVersion: 2 }),
        unit(2, { handedOverAt: null, provisionedKeyVersion: null }),
      ];
      show(contract(units, { status: 'APPROVED' }));
      expect(cell('TL-0041', 'Channel key')).toBe('Provisioned v2');
      expect(cell('TL-0042', 'Channel key')).toBe('Not provisioned yet');
      cleanup();
      show(contract(units, { status: 'APPROVED' }), { scope: 'o', viewer: 'manager' });
      expect(screen.queryByRole('columnheader', { name: /Channel key/ })).toBeNull();
      cleanup();
      show(contract(units, { status: 'ACTIVE' }));
      expect(screen.queryByRole('columnheader', { name: /Channel key/ })).toBeNull();
    });

    it('narrows the units from Show', () => {
      show(contract([unit(1), unit(2, { checkedInAt: BACK }), unit(3, { lostAt: BACK })]));
      const pick = (name: string) => {
        fireEvent.click(screen.getByRole('button', { name: /^Show: / }));
        fireEvent.click(screen.getByRole('menuitem', { name }));
      };
      const tags = () =>
        screen
          .getAllByRole('button', { name: /^Show details of / })
          .map((button) => button.getAttribute('aria-label')?.replace('Show details of ', ''));
      pick('Out now');
      expect(tags()).toEqual(['TL-0041']);
      pick('Checked in');
      expect(tags()).toEqual(['TL-0042']);
      pick('Lost');
      expect(tags()).toEqual(['TL-0043']);
    });

    it.each([
      ['REQUESTED', 'The held units appear here once the server lists them.'],
      ['APPROVED', 'The held units appear here once the server lists them.'],
      ['ACTIVE', 'This contract has no units.'],
    ] as const)('says why a %s contract lists no units', (status, description) => {
      show(contract([], { status }));
      expect(screen.getByText('No devices yet.')).toBeTruthy();
      expect(screen.getByText(description)).toBeTruthy();
      expect(screen.queryByRole('heading', { name: 'TrekLink v3' })).toBeNull();
    });
  });

  describe('details', () => {
    it('shows the holder phone and emergency contact, and opens the device page', () => {
      show(
        contract([
          unit(1, {
            holder: {
              name: 'Lan Nguyen',
              phone: '0901234567',
              emergencyContact: 'Minh, 0907654321',
            },
          }),
          unit(2),
        ]),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Show details of TL-0041' }));
      const pane = within(screen.getByRole('complementary', { name: 'TL-0041' }));
      expect(pane.getByText('Holder phone').nextElementSibling?.textContent).toBe('0901234567');
      expect(pane.getByText('Emergency contact').nextElementSibling?.textContent).toBe(
        'Minh, 0907654321',
      );
      expect(pane.getByRole('link', { name: 'Open the device page' }).getAttribute('href')).toBe(
        '/t/devices/dev-1',
      );
    });

    it('offers the organization the position history of a handed-over unit', () => {
      show(contract([unit(1), unit(2)]), { scope: 'o', viewer: 'manager' });
      fireEvent.click(screen.getByRole('button', { name: 'Show details of TL-0042' }));
      const pane = within(screen.getByRole('complementary', { name: 'TL-0042' }));
      expect(pane.queryByText('Holder phone')).toBeNull();
      expect(
        pane.getByRole('link', { name: 'Open the position history' }).getAttribute('href'),
      ).toBe('/o/devices/dev-2/telemetry');
    });
  });

  describe('Label', () => {
    it('labels a unit that is out, for a member who may label', () => {
      const out = unit(1);
      show(contract([out, unit(2, { checkedInAt: BACK })]), {
        scope: 'o',
        viewer: 'manager',
        canLabel: true,
      });
      fireEvent.click(screen.getByRole('button', { name: 'Label TL-0041' }));
      expect(handlers.onLabel).toHaveBeenCalledWith(out);
      expect(
        screen.getByRole('button', { name: 'Label TL-0042' }).getAttribute('aria-disabled'),
      ).toBe('true');
    });

    it('is absent for a reader who may not label', () => {
      show(contract([unit(1)]), { scope: 'o', viewer: 'operator', canLabel: false });
      expect(screen.queryByRole('button', { name: /^Label / })).toBeNull();
    });
  });

  describe('Report lost', () => {
    it('reads open loss cases only for a Manager with a unit out on an open contract', () => {
      show(contract([unit(1)]), { scope: 'o', viewer: 'manager' });
      expect(loss.enabled).toContain(true);
      cleanup();
      loss.enabled = [];
      show(contract([unit(1)], { status: 'CLOSED' }), { scope: 'o', viewer: 'manager' });
      expect(loss.enabled.every((enabled) => !enabled)).toBe(true);
      expect(screen.queryByRole('button', { name: /^Report lost/ })).toBeNull();
      cleanup();
      loss.enabled = [];
      show(contract([unit(1)]), { viewer: 'staff' });
      expect(loss.enabled.every((enabled) => !enabled)).toBe(true);
      expect(screen.queryByRole('button', { name: /^Report lost/ })).toBeNull();
    });

    it('passes the unit to onReportLost', () => {
      const out = unit(1);
      show(contract([out]), { scope: 'o', viewer: 'manager' });
      fireEvent.click(screen.getByRole('button', { name: 'Report lost TL-0041' }));
      expect(handlers.onReportLost).toHaveBeenCalledWith(out);
    });
  });

  describe('Request service credit', () => {
    it('passes a unit back with a FAILED inspection to onRequestCredit', () => {
      const failed = unit(1, {
        checkedInAt: BACK,
        contractDeviceId: 'cd-1',
        inspection: { id: 'in-1', result: 'FAILED', at: BACK },
      });
      show(contract([failed, unit(2)]));
      fireEvent.click(screen.getByRole('button', { name: 'Request service credit TL-0041' }));
      expect(handlers.onRequestCredit).toHaveBeenCalledWith(failed);
    });
  });

  describe('Release (D-099)', () => {
    it('lets Staff release a unit out on a running contract', () => {
      const first = unit(1);
      show(contract([first, unit(2), unit(3, { checkedInAt: BACK })]));
      fireEvent.click(screen.getByRole('button', { name: 'Release TL-0041' }));
      expect(handlers.onRelease).toHaveBeenCalledWith(first);
      expect(
        screen.getByRole('button', { name: 'Release TL-0043' }).getAttribute('aria-disabled'),
      ).toBe('true');
    });

    it.each(['ACTIVE', 'ENDING'] as const)('offers Release on an %s contract', (status) => {
      show(contract([unit(1), unit(2)], { status }));
      expect(actionsOf('TL-0041')).toContain('Release TL-0041');
    });

    it('lets Staff release a held unit before the handover', () => {
      show(
        contract([unit(1, { handedOverAt: null }), unit(2, { handedOverAt: null })], {
          status: 'APPROVED',
        }),
      );
      expect(
        screen.getByRole('button', { name: 'Release TL-0042' }).getAttribute('aria-disabled'),
      ).toBeNull();
    });

    it('is never offered to the organization, nor once the contract is past running', () => {
      show(contract([unit(1), unit(2)]), { scope: 'o', viewer: 'manager' });
      expect(screen.queryByRole('button', { name: /^Release / })).toBeNull();
      cleanup();
      show(contract([unit(1), unit(2)], { status: 'RETURN_DUE' }));
      expect(screen.queryByRole('button', { name: /^Release / })).toBeNull();
    });

    it('keeps Release on the last unit left out disabled, with End the contract instead', () => {
      show(contract([unit(1), unit(2, { checkedInAt: BACK })]));
      const release = screen.getByRole('button', { name: 'Release TL-0041' });
      expect(release.getAttribute('aria-disabled')).toBe('true');
      expect(
        document.getElementById(release.getAttribute('aria-describedby') ?? '')?.textContent,
      ).toBe('This is the last unit. End the contract now instead.');
      fireEvent.click(release);
      expect(handlers.onRelease).not.toHaveBeenCalled();
    });
  });
});
