// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Permission, Role } from '../../entities/role/api';
import { toggled, type Drafts } from '../../entities/role/model';
import { RoleGrid } from './RoleGrid';

const permission = (key: string, overrides: Partial<Permission> = {}): Permission => {
  const [subject, action, scope] = key.split('.');
  return {
    key,
    action,
    subject: subject.charAt(0).toUpperCase() + subject.slice(1),
    scope: scope === 'own' ? 'own' : 'any',
    accountType: 'ORGANIZATION',
    description: `Can ${action} ${subject}`,
    protected: false,
    ...overrides,
  };
};

const CATALOG = [
  permission('liveMap.read.own'),
  permission('role.manage', { accountType: 'TREKLINK', protected: true }),
  permission('account.manage', { accountType: 'TREKLINK' }),
];

const role = (id: string, key: string, accountType: Role['accountType'], keys: string[]): Role => ({
  id,
  key,
  accountType,
  isSystem: true,
  permissionKeys: keys,
});

const ADMIN = role('r-admin', 'ADMIN', 'TREKLINK', ['role.manage', 'account.manage']);
const STAFF = role('r-staff', 'STAFF', 'TREKLINK', []);
const MANAGER = role('r-mgr', 'ORG_MANAGER', 'ORGANIZATION', []);
const OPERATOR = role('r-op', 'ORG_OPERATOR', 'ORGANIZATION', ['liveMap.read.own']);
const ROLES = [ADMIN, STAFF, MANAGER, OPERATOR];

const renderGrid = (drafts: Drafts = {}, onToggle = vi.fn(), badKey: string | null = null) => {
  render(
    <RoleGrid
      roles={ROLES}
      catalog={CATALOG}
      drafts={drafts}
      badKey={badKey}
      onToggle={onToggle}
    />,
  );
  return onToggle;
};

const box = (name: RegExp) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

afterEach(cleanup);

describe('RoleGrid', () => {
  it('is a focusable scroll region around a captioned table', () => {
    renderGrid();
    const region = screen.getByRole('region', { name: 'Permissions by role' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.className).toContain('scroll-pt-');
    expect(within(region).getByRole('table', { name: 'Permissions by role' })).toBeTruthy();
  });

  it('puts a role column, a subject group and a permission row in the table', () => {
    renderGrid();
    expect(screen.getAllByRole('columnheader')).toHaveLength(5);
    const groups = screen
      .getAllByRole('rowheader')
      .filter((node) => node.getAttribute('scope') === 'rowgroup');
    expect(groups.map((node) => node.textContent)).toEqual(['Account', 'LiveMap', 'Role']);
  });

  it('shows "Not available" instead of a box for the other account type', () => {
    renderGrid();
    expect(screen.queryByRole('checkbox', { name: /^liveMap\.read\.own for ADMIN/ })).toBeNull();
    expect(screen.getAllByText('Not available')).toHaveLength(6);
  });

  it('names a locked and an inherited cell, ticked and read-only', () => {
    renderGrid();
    const locked = box(/^role\.manage for ADMIN, required for Admin$/);
    expect(locked.checked).toBe(true);
    expect(locked.disabled).toBe(true);
    const inherited = box(/^liveMap\.read\.own for ORG_MANAGER, inherited from ORG_OPERATOR/);
    expect(inherited.checked).toBe(true);
    expect(inherited.disabled).toBe(true);
  });

  it('carries the scope in the name of an own-scope cell, because the visible note is aria-hidden', () => {
    renderGrid();
    expect(box(/^liveMap\.read\.own for ORG_OPERATOR, own organization only$/)).toBeTruthy();
    expect(
      box(
        /^liveMap\.read\.own for ORG_MANAGER, inherited from ORG_OPERATOR, own organization only$/,
      ),
    ).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /^account\.manage for STAFF$/ })).toBeTruthy();
  });

  it('calls onToggle with the role and the permission of the cell', () => {
    const onToggle = renderGrid();
    fireEvent.click(box(/^account\.manage for STAFF/));
    expect(onToggle).toHaveBeenCalledWith(STAFF, CATALOG[2]);
  });

  it('marks a changed cell in its name and its note', () => {
    renderGrid(toggled(STAFF, 'account.manage', {}));
    expect(box(/^account\.manage for STAFF, changed$/).checked).toBe(true);
    expect(screen.getByText('Changed')).toBeTruthy();
  });

  it('still marks "Changed" on an inherited cell whose own draft differs', () => {
    // ADMIN untick account.manage, then STAFF tick it: the ADMIN cell turns inherited but its own grant changed.
    const drafts = toggled(STAFF, 'account.manage', toggled(ADMIN, 'account.manage', {}));
    renderGrid(drafts);
    const cell = box(/^account\.manage for ADMIN, inherited from STAFF, changed$/);
    expect(cell.disabled).toBe(true);
    expect(screen.getAllByText('Changed')).toHaveLength(2);
  });

  it('marks the row and the box of a permission the server no longer knows', () => {
    renderGrid({}, vi.fn(), 'liveMap.read.own');
    expect(screen.getByText(/This permission no longer exists\./)).toBeTruthy();
    expect(box(/^liveMap\.read\.own for ORG_OPERATOR/).getAttribute('aria-invalid')).toBe('true');
  });
});
