// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrganizationRoles } from '../../entities/organization-role/api';
import { OrganizationRolesReadOnly } from './OrganizationRolesReadOnly';

// The read-only roles of one organization on /t/organizations/:id (organizations api-design 33,
// screen 3.7). The query hook and the media query are the boundaries; the grid and the cell rules run.
// Descriptions are null, as auth api-design 19 and organizations api-design 33 return them.

const query = vi.hoisted(() => ({
  current: {} as { data?: unknown; isPending: boolean; error: unknown; refetch: () => unknown },
}));
const media = vi.hoisted(() => ({ wide: true }));

vi.mock('../../entities/organization-role/api', () => ({
  useOrganizationRolesOf: vi.fn(() => query.current),
}));
vi.mock('../../shared/lib/useMediaQuery', () => ({ useMediaQuery: () => media.wide }));

const VIEW: OrganizationRoles = {
  roles: [
    {
      key: 'ORG_OPERATOR',
      version: 0,
      baselineKeys: ['incident.read.own'],
      effectiveKeys: ['incident.read.own'],
    },
    {
      key: 'ORG_MANAGER',
      version: 2,
      baselineKeys: ['incident.read.own'],
      effectiveKeys: ['incident.read.own', 'device.read.own'],
    },
  ],
  catalog: [
    {
      key: 'organizationRole.manage.own',
      action: 'manage',
      subject: 'OrganizationRole',
      scope: 'own',
      accountType: 'ORGANIZATION',
      description: null,
      protected: true,
    },
    {
      key: 'incident.read.own',
      action: 'read',
      subject: 'Incident',
      scope: 'own',
      accountType: 'ORGANIZATION',
      description: null,
      protected: false,
    },
    {
      key: 'device.read.own',
      action: 'read',
      subject: 'Device',
      scope: 'own',
      accountType: 'ORGANIZATION',
      description: null,
      protected: false,
    },
  ],
};

const loaded = () => ({ data: VIEW, isPending: false, error: null, refetch: vi.fn() });

beforeEach(() => {
  media.wide = true;
  query.current = loaded();
});
afterEach(cleanup);

describe('OrganizationRolesReadOnly', () => {
  it('shows a skeleton while the roles load', () => {
    query.current = { data: undefined, isPending: true, error: null, refetch: vi.fn() };
    const { container } = render(<OrganizationRolesReadOnly organizationId="org-1" />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.firstElementChild).not.toBeNull();
  });

  it('shows the error with a retry that refetches', () => {
    const refetch = vi.fn();
    query.current = {
      data: undefined,
      isPending: false,
      error: new Error('Network down'),
      refetch,
    };
    render(<OrganizationRolesReadOnly organizationId="org-1" />);
    const alert = screen.getByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  describe('from 768 px', () => {
    it('draws the role grid inside its own scroll frame, with the organization caption', () => {
      const { container } = render(<OrganizationRolesReadOnly organizationId="org-1" />);
      expect(container.querySelector('[data-roles-grid-frame]')).not.toBeNull();
      expect(
        screen.getByRole('table', { name: 'Permissions by role of this organization' }),
      ).toBeTruthy();
      expect(screen.queryByRole('combobox', { name: 'Role' })).toBeNull();
    });

    it('lists the Manager before the Operator, whatever order the API sends', () => {
      render(<OrganizationRolesReadOnly organizationId="org-1" />);
      const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent ?? '');
      const manager = headers.findIndex((text) => text.includes('ORG_MANAGER'));
      const operator = headers.findIndex((text) => text.includes('ORG_OPERATOR'));
      expect(manager).toBeGreaterThan(-1);
      expect(manager).toBeLessThan(operator);
    });

    it('applies the organization cell rules and lets no cell be changed', () => {
      render(<OrganizationRolesReadOnly organizationId="org-1" />);
      const table = screen.getByRole('table');
      expect(
        within(table).getByRole('checkbox', {
          name: /^organizationRole\.manage\.own for ORG_MANAGER, required for Manager/,
        }),
      ).toBeTruthy();
      expect(
        within(table).getByRole('checkbox', {
          name: /^incident\.read\.own for ORG_MANAGER, inherited from ORG_OPERATOR/,
        }),
      ).toBeTruthy();
      expect(
        within(table).getByRole('checkbox', {
          name: /^device\.read\.own for ORG_MANAGER.*customised/,
        }),
      ).toBeTruthy();
      expect(within(table).getAllByText('Not available')).toHaveLength(1);
      for (const box of within(table).getAllByRole('checkbox')) {
        expect((box as HTMLInputElement).disabled).toBe(true);
      }
    });
  });

  describe('below 768 px', () => {
    beforeEach(() => {
      media.wide = false;
    });

    it('shows one role at a time, the Manager first, picked in a select', () => {
      render(<OrganizationRolesReadOnly organizationId="org-1" />);
      const select = screen.getByRole('combobox', { name: 'Role' }) as HTMLSelectElement;
      expect([...select.options].map((option) => option.value)).toEqual([
        'ORG_MANAGER',
        'ORG_OPERATOR',
      ]);
      expect(select.value).toBe('ORG_MANAGER');
      expect(screen.getByRole('heading', { name: 'ORG_MANAGER' })).toBeTruthy();
      expect(screen.getByText(/Org Manager, Organization/)).toBeTruthy();
      expect(screen.queryByRole('table')).toBeNull();
    });

    it('groups permissions by subject and explains locked, inherited and customised boxes', () => {
      render(<OrganizationRolesReadOnly organizationId="org-1" />);
      expect(screen.getAllByRole('group').map((group) => group.firstChild?.textContent)).toEqual([
        'Device',
        'Incident',
        'OrganizationRole',
      ]);
      const locked = screen.getByRole('checkbox', { name: /organizationRole\.manage\.own/ });
      expect(locked.getAttribute('aria-describedby')).toBeTruthy();
      const described = (name: RegExp) => {
        const box = screen.getByRole('checkbox', { name });
        return document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent;
      };
      expect(described(/organizationRole\.manage\.own/)).toMatch(
        /^Own organization only\.\s+Required for Manager\.$/,
      );
      expect(described(/incident\.read\.own/)).toMatch(
        /^Own organization only\.\s+From ORG_OPERATOR\.$/,
      );
      expect(described(/device\.read\.own/)).toMatch(/^Own organization only\.\s+Customised\.$/);
      for (const box of screen.getAllByRole('checkbox')) {
        expect((box as HTMLInputElement).checked).toBe(true);
        expect((box as HTMLInputElement).disabled).toBe(true);
      }
    });

    it('switches to the Operator, hides the permission it can never hold and shows its unticked box', () => {
      render(<OrganizationRolesReadOnly organizationId="org-1" />);
      fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), {
        target: { value: 'ORG_OPERATOR' },
      });
      expect(screen.getByRole('heading', { name: 'ORG_OPERATOR' })).toBeTruthy();
      expect(screen.queryByRole('checkbox', { name: /organizationRole\.manage\.own/ })).toBeNull();
      const device = screen.getByRole('checkbox', {
        name: /device\.read\.own/,
      }) as HTMLInputElement;
      expect(device.checked).toBe(false);
      expect(device.disabled).toBe(true);
      const incident = screen.getByRole('checkbox', {
        name: /incident\.read\.own/,
      }) as HTMLInputElement;
      expect(incident.checked).toBe(true);
    });
  });
});
